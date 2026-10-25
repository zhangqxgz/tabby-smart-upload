/**
 * CWD 自动注入服务（模块 A 核心）
 *
 * 原理：Tabby 靠远端 shell 主动发送 OSC 1337 `CurrentDir=<路径>` 序列来跟踪当前目录
 * （tabby-terminal 的 OSCProcessor 解析）。官方要求手动改远端 dotfiles，本服务改为
 * 在 SSH 会话建立后自动向远端 shell 注入一段 hook（base64 + eval 单条命令，规避引号转义），
 * bash 走 PROMPT_COMMAND、zsh 走 precmd_functions、fish 走 fish_prompt 事件；
 * tmux 内自动改用 DCS 透传包裹（tmux ≥3.3 需 allow-passthrough on）。
 *
 * 关键时序坑：SSHShellSession.write() 在 shell 通道未就绪时【静默丢弃】，
 * 而 sessionChanged$ 在认证+shell 建立之前就触发 → 必须重试注入，不能只发一次。
 * 同时注入片段末尾会立即调用一次上报函数，验证不依赖"下一次提示符"。
 */
import { Injectable } from '@angular/core'
import { ConfigService, LogService, Logger, NotificationsService } from 'tabby-core'
import { I18nService } from '../i18n'
import { diag } from '../diag'

/** 结构化的 shell 会话能力声明（不依赖 tabby-ssh 未导出的 SSHShellSession 类型） */
export interface ShellSessionLike {
    getWorkingDirectory?: () => Promise<string | null>
    feedFromTerminal (data: Buffer): void
}

/**
 * 生成远端 shell 钩子片段（bash + zsh 通用）。
 *
 * 关键坑：shell 会先完整解析整段代码再执行分支——fish 的 `function xx --on-event`
 * / `end` 在 bash 中是语法错误，混在一起会让整个 eval 失败（bash 分支也不执行）。
 * 因此自动注入只包含 bash+zsh（两者互相可解析）；fish 用 buildFishSnippet() 手动配置。
 * 末尾立即调用一次上报函数，不依赖"下一次提示符"。
 */
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
        '  __tsu_cwd',
        'elif [ -n "$ZSH_VERSION" ]; then',
        '  typeset -ga precmd_functions',
        '  precmd_functions+=__tsu_cwd',
        '  __tsu_cwd',
        'fi',
    ].join('\n')
}

/** fish 手动配置片段（自动注入不适用：fish 语法与 POSIX shell 不兼容） */
export function buildFishSnippet (): string {
    return [
        'function __tsu_cwd --on-event fish_prompt',
        '    if set -q TMUX',
        '        printf \'\\033Ptmux;\\033\\033]1337;CurrentDir=%s\\007\\033\\\\\' $PWD',
        '    else',
        '        printf \'\\033]1337;CurrentDir=%s\\007\' $PWD',
        '    end',
        'end',
        '__tsu_cwd',
    ].join('\n')
}

/** 首次注入延迟（等 shell 有可能就绪；未就绪由重试兜底） */
const INJECT_INITIAL_DELAY_MS = 800
/** 注入最大尝试次数（每次尝试内含 2s 验证窗口 → 覆盖约 20s 的慢登录场景） */
const INJECT_ATTEMPTS = 8
/** 单次注入后的验证窗口 */
const VERIFY_WINDOW_MS = 2000
/** 验证轮询间隔 */
const POLL_INTERVAL_MS = 120

function sleep (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

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

    /** 会话建立后调度注入（重试逻辑在 inject 内部，覆盖 shell 通道未就绪的静默丢弃） */
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
        }, INJECT_INITIAL_DELAY_MS)
    }

    /** 立即注入（标签页右键菜单「重试」入口） */
    async injectNow (session: ShellSessionLike, hostKey: string): Promise<boolean> {
        return this.inject(session, hostKey)
    }

    private async inject (session: ShellSessionLike, hostKey: string): Promise<boolean> {
        if (this.injected.has(session)) {
            return true
        }
        try {
            const b64 = Buffer.from(buildCwdSnippet(), 'utf-8').toString('base64')
            const line = ' eval "$(printf %s \'' + b64 + '\' | base64 -d)" 2>/dev/null # tabby-smart-upload\n'
            for (let attempt = 1; attempt <= INJECT_ATTEMPTS; attempt++) {
                session.feedFromTerminal(Buffer.from(line, 'utf-8'))
                diag('inject:attempt', { attempt })
                const cwd = await this.waitReported(session, VERIFY_WINDOW_MS)
                if (cwd) {
                    this.injected.add(session)
                    this.logger.info('CWD reported for', hostKey, '->', cwd)
                    diag('inject:ok', { attempt, hostKey, cwd })
                    return true
                }
            }
            this.logger.warn('CWD injection failed after', INJECT_ATTEMPTS, 'attempts for', hostKey)
            diag('inject:fail', { attempts: INJECT_ATTEMPTS, hostKey })
            this.warnOnce(hostKey)
            return false
        } catch (e) {
            this.logger.warn('CWD injection error:', e)
            diag('inject:error', { error: String(e) })
            this.warnOnce(hostKey)
            return false
        }
    }

    private async waitReported (session: ShellSessionLike, timeoutMs: number): Promise<string | null> {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
            await sleep(POLL_INTERVAL_MS)
            try {
                const cwd = await session.getWorkingDirectory?.()
                if (cwd) {
                    return cwd
                }
            } catch {
                // 会话可能中途销毁，忽略
            }
        }
        return null
    }

    /**
     * 主动探测当前目录（按需调用）：
     * 向远端 shell 发一条 printf OSC 1337 的命令（该转义序列会被 Tabby 的 OSCProcessor
     * 拦截解析、不会污染终端），无需等待 PROMPT_COMMAND 钩子，也适用于钩子注入失败/
     * 刚连接/提示符尚未刷新的场景。命令会回显一行，属正常现象；写入可能被静默丢弃，
     * 因此带重发。
     */
    async probeCwd (session: ShellSessionLike, timeoutMs = 3000): Promise<string | null> {
        try {
            const known = await session.getWorkingDirectory?.()
            if (known) {
                diag('probe:known', { cwd: known })
                return known
            }
            const cmd = Buffer.from(' printf \'\\033]1337;CurrentDir=%s\\007\' "$PWD"\n', 'utf-8')
            const deadline = Date.now() + timeoutMs
            let sends = 0
            while (Date.now() < deadline) {
                session.feedFromTerminal(cmd)
                sends++
                diag('probe:send', { sends })
                const until = Date.now() + 750
                while (Date.now() < until) {
                    await sleep(POLL_INTERVAL_MS)
                    const cwd = await session.getWorkingDirectory?.()
                    if (cwd) {
                        diag('probe:hit', { cwd, sends })
                        return cwd
                    }
                }
            }
            diag('probe:timeout', {
                sends,
                hasGetWorkingDirectory: typeof session.getWorkingDirectory,
            })
        } catch (e) {
            diag('probe:error', { error: String(e) })
        }
        return null
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
