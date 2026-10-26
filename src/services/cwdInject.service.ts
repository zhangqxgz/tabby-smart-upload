/**
 * CWD 自动配置服务（模块 A 核心）
 *
 * 原理：Tabby 靠远端 shell 主动发送 OSC 1337 `CurrentDir=<路径>` 序列来跟踪当前目录
 * （tabby-terminal 的 OSCProcessor 解析）。官方要求手动改远端 dotfiles，本服务自动完成：
 *
 * 1) 首选「静默安装」：通过 SFTP 在远端 ~/.bashrc / ~/.zshrc 追加受管片段（带标记 + 备份），
 *    全程不往终端写任何字符 → 连接零回显；下一个 shell 起自动生效。
 *    —— 第一段会话本身没有钩子，靠点击上传时的 probeCwd 兜底。
 * 2) 回退「终端注入」：SFTP 不可用/写失败时，向当前 shell 写一段紧凑单行钩子（会回显一行）。
 * 3) 远端 dotfiles 里已有我们标记（或已自行上报）→ 直接跳过，什么都不做。
 *
 * 其它真机经验：
 * - SSHShellSession.write 在 shell 通道未就绪时【静默丢弃】，sessionChanged$ 早于认证完成 →
 *   终端注入必须重试；
 * - shell 会先完整解析整段代码再执行分支 → 片段必须 bash+zsh 互相可解析（fish 单独手动配置）。
 */
import { Injectable } from '@angular/core'
import { ConfigService, FileDownload, FileUpload, LogService, Logger, NotificationsService } from 'tabby-core'
import { SFTPSession } from 'tabby-ssh'
import { I18nService } from '../i18n'
import { diag } from '../diag'
import { SSHTabLike, ShellSessionLike } from '../types'

export type { ShellSessionLike } from '../types'

export const HOOK_MARKER_BEGIN = '# >>> tabby-smart-upload >>>'
export const HOOK_MARKER_END = '# <<< tabby-smart-upload <<<'

/**
 * 生成远端 shell 钩子片段（bash + zsh 通用）。
 *
 * 关键坑：
 * 1) shell 会先完整解析整段代码再执行分支——fish 的 `function xx --on-event`
 *    / `end` 在 bash 中是语法错误，混在一起会让整个 eval 失败（bash 分支也不执行）。
 *    因此自动注入只包含 bash+zsh（两者互相可解析）；fish 用 buildFishSnippet() 手动配置。
 * 2) bash 在非交互的 ssh 远程命令里也会 source ~/.bashrc（历史行为）——必须用
 *    `case $- in *i*)` 交互式守卫，避免把 OSC 字节混进 `ssh host cmd` 的输出。
 * 3) 末尾立即调用一次上报函数，不依赖"下一次提示符"。
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
        'case $- in',
        '  *i*)',
        '    if [ -n "$BASH_VERSION" ]; then',
        '      case ";${PROMPT_COMMAND:-};" in',
        '        *";__tsu_cwd;"*) : ;;',
        '        *) PROMPT_COMMAND="__tsu_cwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;',
        '      esac',
        '    elif [ -n "$ZSH_VERSION" ]; then',
        '      typeset -ga precmd_functions',
        '      precmd_functions+=__tsu_cwd',
        '    fi',
        '    __tsu_cwd',
        '    ;;',
        'esac',
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

/** 受管块（写入远端 dotfiles 的内容） */
export function buildManagedBlock (): string {
    return [HOOK_MARKER_BEGIN, buildCwdSnippet(), HOOK_MARKER_END, ''].join('\n')
}

/** 首次注入延迟（等 shell 有可能就绪；未就绪由重试兜底） */
const INJECT_INITIAL_DELAY_MS = 800
/** 注入最大尝试次数（每次尝试内含 2s 验证窗口 → 覆盖约 20s 的慢登录场景） */
const INJECT_ATTEMPTS = 8
/** 单次注入后的验证窗口 */
const VERIFY_WINDOW_MS = 2000
/** 验证轮询间隔 */
const POLL_INTERVAL_MS = 120
/** 静默安装前等待"远端已自行上报"的窗口（覆盖慢登录） */
const ALREADY_REPORTED_WINDOW_MS = 3500

/**
 * 自动注入用的紧凑单行命令（无 base64：命令直接写入 PTY，引号原样传递）。
 * 兼容 bash / zsh；tmux 内走 DCS 透传；带幂等守卫，重复注入不会被叠加。
 * 屏幕上只会回显这一行（shell 行编辑器自己回显输入，客户端无法隐藏）。
 */
export function buildInjectCommand (): string {
    return ' ' + [
        '__tsu_cwd(){ if [ -n "$TMUX" ];then printf \'\\033Ptmux;\\033\\033]1337;CurrentDir=%s\\007\\033\\\\\' "$PWD";else printf \'\\033]1337;CurrentDir=%s\\007\' "$PWD";fi;};',
        'if [ -n "$BASH_VERSION" ];then case ";$PROMPT_COMMAND;" in *__tsu_cwd*) ;; *) PROMPT_COMMAND="__tsu_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}";; esac;',
        'elif [ -n "$ZSH_VERSION" ];then case "${PROMPT_COMMAND[*]}" in *__tsu_cwd*) ;; *) PROMPT_COMMAND+=(__tsu_cwd);; esac;',
        'fi;__tsu_cwd',
    ].join('') + '\n'
}

function sleep (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/** 把 Buffer 当上传源（配合 SFTPSession.upload 的临时文件 + rename 语义） */
class BufferUpload extends FileUpload {
    private offset = 0

    constructor (private readonly buf: Buffer, private readonly fileName: string) {
        super()
    }

    getName (): string {
        return this.fileName
    }

    getMode (): number {
        return 0o644
    }

    getSize (): number {
        return this.buf.length
    }

    async read (): Promise<Uint8Array> {
        const chunk = this.buf.subarray(this.offset, this.offset + 64 * 1024)
        this.offset += chunk.length
        return new Uint8Array(chunk)
    }

    close (): void {
        // nothing to release
    }
}

/** 把下载内容收集到内存（配合 SFTPSession.download） */
class BufferDownload extends FileDownload {
    chunks: Buffer[] = []

    getName (): string {
        return 'buffer'
    }

    getMode (): number {
        return 0o644
    }

    getSize (): number {
        return 0
    }

    async write (chunk: Uint8Array): Promise<void> {
        this.chunks.push(Buffer.from(chunk))
    }

    close (): void {
        // nothing to release
    }
}

@Injectable()
export class CwdInjectService {
    private logger: Logger
    private handled = new WeakSet<object>()
    private scheduled = new WeakSet<object>()

    constructor (
        private config: ConfigService,
        private notifications: NotificationsService,
        private i18n: I18nService,
        log: LogService,
    ) {
        this.logger = log.create('smart-upload')
    }

    /** 会话建立后调度 CWD 配置（静默优先，注入兜底） */
    scheduleSetup (tab: SSHTabLike, hostKey: string): void {
        const session = tab.session
        if (!session || !this.config.store.smartUpload?.autoInject) {
            return
        }
        if (this.handled.has(session) || this.scheduled.has(session)) {
            return
        }
        this.scheduled.add(session)
        setTimeout(() => {
            this.scheduled.delete(session)
            void this.setup(tab, hostKey)
        }, INJECT_INITIAL_DELAY_MS)
    }

    private async setup (tab: SSHTabLike, hostKey: string): Promise<void> {
        const session = tab.session
        if (!session || this.handled.has(session)) {
            return
        }
        try {
            // 1) 远端已自行上报（dotfiles 已配置）→ 什么都不做
            const reported = await this.waitReported(session, ALREADY_REPORTED_WINDOW_MS)
            if (reported) {
                this.handled.add(session)
                this.logger.info('CWD already reported for', hostKey, '->', reported, '- nothing to do')
                diag('setup:already-reported', { hostKey, cwd: reported })
                return
            }

            // 2) 静默安装（SFTP，零回显）
            if (this.config.store.smartUpload?.silentSetup && tab.sshSession) {
                const installed = await this.installRemoteHook(tab)
                if (installed) {
                    this.handled.add(session)
                    this.logger.info('CWD hook installed silently for', hostKey)
                    diag('setup:silent-installed', { hostKey })
                    return
                }
            }

            // 3) 回退：终端注入（会回显一行，需重试）
            const ok = await this.inject(session, hostKey)
            if (ok) {
                this.handled.add(session)
            }
        } catch (e) {
            diag('setup:error', { hostKey, error: String(e) })
            this.warnOnce(hostKey)
        }
    }

    /**
     * 通过 SFTP 把受管片段写入远端 ~/.bashrc / ~/.zshrc（存在才写；都不存在则创建 ~/.bashrc）。
     * 返回 true 表示远端已具备（本次写入或此前已写过）。
     */
    private async installRemoteHook (tab: SSHTabLike): Promise<boolean> {
        let sftp: SFTPSession
        try {
            sftp = await tab.sshSession!.openSFTP()
        } catch (e) {
            diag('silent:no-sftp', { error: String(e) })
            return false
        }

        const user = String((tab.profile as any)?.options?.user || '')
        const home = await this.resolveHome(sftp, user)
        if (!home) {
            return false
        }

        const block = buildManagedBlock()
        const candidates = [`${home}/.bashrc`, `${home}/.zshrc`]
        let anyFile = false
        let ready = false
        let installedNow = false

        for (const path of candidates) {
            const current = await this.readRemoteFile(sftp, path)
            if (current === null) {
                continue
            }
            anyFile = true
            if (current.includes(HOOK_MARKER_BEGIN)) {
                ready = true
                continue
            }
            const next = (current.length === 0 || current.endsWith('\n') ? current : current + '\n') + '\n' + block
            if (await this.writeRemoteFile(sftp, path, next, current)) {
                installedNow = true
                ready = true
            }
        }

        if (!anyFile) {
            // 两个 rc 都不存在 → 创建 ~/.bashrc（绝大多数 Linux 默认 shell 为 bash）
            const path = `${home}/.bashrc`
            if (await this.writeRemoteFile(sftp, path, block, null)) {
                installedNow = true
                ready = true
            }
        }

        if (installedNow) {
            this.notifications.notice(this.i18n.t('notify.silentInstalled'))
        }
        return ready
    }

    /** 从 /etc/passwd 解析远端用户 home（免去在终端里 echo $HOME 的回显） */
    private async resolveHome (sftp: SFTPSession, user: string): Promise<string | null> {
        try {
            const text = await this.readRemoteFile(sftp, '/etc/passwd')
            if (text) {
                for (const line of text.split('\n')) {
                    const parts = line.split(':')
                    if (parts.length >= 6 && parts[0] === user && parts[5].startsWith('/')) {
                        return parts[5]
                    }
                }
            }
        } catch {
            // ignore
        }
        diag('silent:home-not-found', { user })
        return null
    }

    private async readRemoteFile (sftp: SFTPSession, path: string): Promise<string | null> {
        try {
            const dl = new BufferDownload()
            await sftp.download(path, dl)
            return Buffer.concat(dl.chunks).toString('utf8')
        } catch {
            return null
        }
    }

    private async writeRemoteFile (sftp: SFTPSession, path: string, content: string, pristine: string | null): Promise<boolean> {
        try {
            // 首次修改前留备份（备份已存在则不覆盖，保留最原始版本）
            if (pristine !== null) {
                const backupPath = `${path}.tabby-smart-upload.bak`
                let hasBackup = false
                try {
                    await sftp.stat(backupPath)
                    hasBackup = true
                } catch {
                    hasBackup = false
                }
                if (!hasBackup) {
                    await sftp.upload(backupPath, new BufferUpload(Buffer.from(pristine, 'utf8'), backupPath.split('/').pop() || 'backup'))
                }
            }
            let mode: number | null = null
            try {
                const st = await sftp.stat(path)
                mode = st.mode
            } catch {
                mode = null
            }
            await sftp.upload(path, new BufferUpload(Buffer.from(content, 'utf8'), path.split('/').pop() || 'rc'))
            if (mode !== null && (mode & 0o777)) {
                try {
                    await sftp.chmod(path, mode & 0o777)
                } catch {
                    // ignore
                }
            }
            diag('silent:write-ok', { path })
            return true
        } catch (e) {
            diag('silent:write-fail', { path, error: String(e) })
            return false
        }
    }

    /** 立即注入（标签页右键菜单「重试」入口；会回显一行） */
    async injectNow (session: ShellSessionLike, hostKey: string): Promise<boolean> {
        return this.inject(session, hostKey)
    }

    private async inject (session: ShellSessionLike, hostKey: string): Promise<boolean> {
        if (this.handled.has(session)) {
            return true
        }
        try {
            const line = buildInjectCommand()
            for (let attempt = 1; attempt <= INJECT_ATTEMPTS; attempt++) {
                const pre = await this.waitReported(session, attempt === 1 ? 1200 : 700)
                if (pre) {
                    this.logger.info('CWD already reported for', hostKey, '->', pre, '- skip injection')
                    diag('inject:skip', { hostKey, attempt, cwd: pre })
                    return true
                }
                session.feedFromTerminal(Buffer.from(line, 'utf-8'))
                diag('inject:attempt', { attempt })
                const cwd = await this.waitReported(session, VERIFY_WINDOW_MS)
                if (cwd) {
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
