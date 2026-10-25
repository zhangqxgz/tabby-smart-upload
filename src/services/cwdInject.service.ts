/**
 * CWD 自动注入服务（模块 A 核心）
 *
 * 原理：Tabby 靠远端 shell 主动发送 OSC 1337 `CurrentDir=<路径>` 序列来跟踪当前目录
 * （tabby-terminal 的 OSCProcessor 解析）。官方要求手动改远端 dotfiles，本服务改为
 * 在 SSH 会话建立后自动向远端 shell 注入一段 hook（base64 + eval 单条命令，规避引号转义），
 * bash 走 PROMPT_COMMAND、zsh 走 precmd_functions、fish 走 fish_prompt 事件；
 * tmux 内自动改用 DCS 透传包裹（tmux ≥3.3 需 allow-passthrough on）。
 *
 * 注入后轮询 session.getWorkingDirectory() 验证（钩子在下一次提示符时生效）；
 * 失败则按主机记一次提示，不反复打扰。
 */
import { Injectable } from '@angular/core'
import { ConfigService, LogService, Logger, NotificationsService } from 'tabby-core'
import { I18nService } from '../i18n'

/** 结构化的 shell 会话能力声明（不依赖 tabby-ssh 未导出的 SSHShellSession 类型） */
export interface ShellSessionLike {
    getWorkingDirectory?: () => Promise<string | null>
    feedFromTerminal (data: Buffer): void
}

/** 生成远端 shell 钩子片段（三个 shell 通用） */
export function buildCwdSnippet (): string {
    return [
        '__tsu_cwd() {',
        '  if [ -n "$TMUX" ]; then',
        '    printf \'\\033Ptmux;\\033\\033]1337;CurrentDir=%s\\007\\033\\\\\' "$PWD"',
        '  else',
        '    printf \'\\033]1337;CurrentDir=%s\\007\' "$PWD"',
        '  fi',
        '}',
        'if [ -n "$BASH_VERSION" ]; then',
        '  case ";${PROMPT_COMMAND:-};" in',
        '    *";__tsu_cwd;"*) : ;;',
        '    *) PROMPT_COMMAND="__tsu_cwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;',
        '  esac',
        'elif [ -n "$ZSH_VERSION" ]; then',
        '  typeset -ga precmd_functions',
        '  precmd_functions+=__tsu_cwd',
        'elif [ -n "$FISH_VERSION" ]; then',
        '  function __tsu_fish_cwd --on-event fish_prompt',
        '    if set -q TMUX',
        '      printf \'\\033Ptmux;\\033\\033]1337;CurrentDir=%s\\007\\033\\\\\' $PWD',
        '    else',
        '      printf \'\\033]1337;CurrentDir=%s\\007\' $PWD',
        '    end',
        '  end',
        'end',
    ].join('\n')
}

const INJECT_DELAY_MS = 1200
const VERIFY_TIMEOUT_MS = 16000
const VERIFY_INTERVAL_MS = 400

@Injectable()
export class CwdInjectService {
    private logger: Logger
    private injected = new WeakSet<object>()
    private scheduled = new WeakSet<object>()

    constructor (
        private config: ConfigService,
        private notifications: NotificationsService,
        private i18n: I18nService,
        log: LogService,
    ) {
        this.logger = log.create('smart-upload')
    }

    /**
     * 会话建立后调度注入（延迟片刻等 shell 就绪；PTY 输入会缓冲到 shell 启动后执行，
     * 键盘交互认证发生在 shell 通道建立之前，因此此时写入是安全的）。
     */
    scheduleInject (session: ShellSessionLike, hostKey: string): void {
        if (!this.config.store.smartUpload?.autoInject) {
            return
        }
        if (this.injected.has(session) || this.scheduled.has(session)) {
            return
        }
        this.scheduled.add(session)
        setTimeout(() => {
            this.scheduled.delete(session)
            void this.inject(session, hostKey)
        }, INJECT_DELAY_MS)
    }

    /** 立即注入（标签页右键菜单「重试」入口） */
    async injectNow (session: ShellSessionLike, hostKey: string): Promise<boolean> {
        return this.inject(session, hostKey)
    }

    /**
     * 主动探测当前目录（按需调用）：
     * 向远端 shell 发一条 printf OSC 1337 的命令（该转义序列会被 Tabby 的 OSCProcessor
     * 拦截解析、不会污染终端），无需等待 PROMPT_COMMAND 钩子，也适用于钩子注入失败/
     * 刚连接/提示符尚未刷新的场景。命令会回显一行，属正常现象。
     */
    async probeCwd (session: ShellSessionLike, timeoutMs = 2500): Promise<string | null> {
        try {
            const known = await session.getWorkingDirectory?.()
            if (known) {
                return known
            }
            session.feedFromTerminal(Buffer.from(' printf \'\\033]1337;CurrentDir=%s\\007\' "$PWD"\n', 'utf-8'))
            const deadline = Date.now() + timeoutMs
            while (Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 150))
                const cwd = await session.getWorkingDirectory?.()
                if (cwd) {
                    return cwd
                }
            }
        } catch {
            // 会话可能已销毁
        }
        return null
    }

    private async inject (session: ShellSessionLike, hostKey: string): Promise<boolean> {
        if (this.injected.has(session)) {
            return true
        }
        try {
            const b64 = Buffer.from(buildCwdSnippet(), 'utf-8').toString('base64')
            const line = ' eval "$(printf %s \'' + b64 + '\' | base64 -d)" 2>/dev/null # tabby-smart-upload\n'
            session.feedFromTerminal(Buffer.from(line, 'utf-8'))
            this.logger.info('CWD hook injected, waiting for the shell to report...')
            const ok = await this.waitReported(session, VERIFY_TIMEOUT_MS)
            if (ok) {
                this.injected.add(session)
                this.logger.info('CWD reported for', hostKey)
                return true
            }
            this.warnOnce(hostKey)
            return false
        } catch (e) {
            this.logger.warn('CWD injection failed:', e)
            this.warnOnce(hostKey)
            return false
        }
    }

    private async waitReported (session: ShellSessionLike, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, VERIFY_INTERVAL_MS))
            try {
                if (await session.getWorkingDirectory?.()) {
                    return true
                }
            } catch {
                // 会话可能中途销毁，忽略
            }
        }
        return false
    }

    private warnOnce (hostKey: string): void {
        const cfg = this.config.store.smartUpload
        if (!cfg?.notifyInjectFailure) {
            return
        }
        const failed: string[] = cfg.failedHosts ?? []
        if (failed.includes(hostKey)) {
            return
        }
        cfg.failedHosts = [...failed, hostKey]
        void this.config.save()
        this.notifications.error(this.i18n.t('notify.cwdFail'))
    }
}
