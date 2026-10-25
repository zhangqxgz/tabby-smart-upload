/**
 * 上传到当前目录服务（模块 B 上传链路）
 *
 * 流程：解析目标目录（getWorkingDirectory → 按主机记忆 → 弹窗询问）→
 *       系统文件选择器 → 受限并发地通过 SFTPSession.upload 上传
 *       （复用内置的 .tabby-upload 临时文件 + rename 安全语义，进度与
 *       取消经由 FileTransfer 状态机被传输中心自动跟踪）。
 *
 * 说明：npm 版 tabby-ssh 类型声明未导出 SSHTabComponent（部分旧版运行时
 * 同样不导出），因此这里用结构化类型 + 鸭式判断（存在 sshSession 即 SSH
 * 标签页），不依赖该符号的导出。
 */
import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { AppService, ConfigService, FileUpload, HotkeysService, NotificationsService, PlatformService } from 'tabby-core'
import { SFTPSession } from 'tabby-ssh'
import { I18nService } from '../i18n'
import { UploadPathModalComponent } from '../components/uploadPathModal.component'

/** 结构化的 SSH 标签页能力声明 */
export interface ShellSessionLike {
    getWorkingDirectory?: () => Promise<string | null>
    feedFromTerminal (data: Buffer): void
}

export interface SSHTabLike {
    title?: string
    profile?: any
    session?: ShellSessionLike | null
    sshSession?: { openSFTP (): Promise<SFTPSession> } | null
}

/** 鸭式判断：SSH 标签页一定有 sshSession 属性 */
export function asSSHTab (tab: any): SSHTabLike | null {
    if (tab && typeof tab === 'object' && 'sshSession' in tab) {
        return tab as SSHTabLike
    }
    return null
}

/**
 * 从 activeTab 解析出真正的终端标签页：
 * 分屏（SplitTabComponent）时 activeTab 是外壳，需要取当前聚焦的子标签页。
 */
export function resolveFocusedTab (tab: any): any {
    if (!tab || typeof tab !== 'object') {
        return null
    }
    if (typeof tab.getFocusedTab === 'function') {
        return tab.getFocusedTab() ?? null
    }
    return tab
}

export function hostKeyOf (tab: SSHTabLike): string {
    const o: any = tab.profile?.options ?? {}
    if (o.host) {
        return `${o.user ?? ''}@${o.host}:${o.port ?? 22}`
    }
    return tab.title ?? 'unknown'
}

@Injectable()
export class UploadService {
    constructor (
        private app: AppService,
        private platform: PlatformService,
        private config: ConfigService,
        private notifications: NotificationsService,
        private hotkeys: HotkeysService,
        private modal: NgbModal,
        private i18n: I18nService,
    ) {
        this.hotkeys.hotkey$.subscribe(h => {
            if (h === 'smart-upload-to-cwd') {
                void this.uploadToCwd()
            }
        })
    }

    async uploadToCwd (): Promise<void> {
        const tab = asSSHTab(resolveFocusedTab(this.app.activeTab))
        if (!tab) {
            // 普通提示即可，避免在非 SSH 标签页被误读成"插件报错"
            this.notifications.notice(this.i18n.t('notify.notSSH'))
            return
        }
        if (!tab.sshSession || !tab.session) {
            this.notifications.error(this.i18n.t('notify.notReady'))
            return
        }

        const target = await this.resolveTarget(tab)
        if (!target) {
            return
        }

        let transfers: FileUpload[] = []
        try {
            transfers = await this.platform.startUpload({ multiple: true })
        } catch {
            return
        }
        if (!transfers.length) {
            return
        }
        this.rememberPath(tab, target)

        const concurrency = Math.min(8, Math.max(1, Number(this.config.store.smartUpload?.uploadConcurrency) || 2))
        let ok = 0
        let fail = 0
        await this.mapWithConcurrency(transfers, concurrency, async t => {
            const name = this.baseName(this.safeName(t))
            try {
                const sftp = await tab.sshSession!.openSFTP()
                await sftp.upload(this.joinPosix(target, name), t)
                ok++
            } catch {
                // sftp.upload 内部已设置状态并清理临时文件；失败明细见传输中心
                fail++
            }
        })

        if (fail === 0) {
            this.notifications.notice(this.i18n.t('notify.uploadSummaryDone', { ok }))
        } else {
            this.notifications.error(this.i18n.t('notify.uploadSummaryError', { ok, fail }))
        }
    }

    private async resolveTarget (tab: SSHTabLike): Promise<string | null> {
        const cfg = this.config.store.smartUpload
        const hostKey = hostKeyOf(tab)

        let target: string | null = null
        try {
            target = await tab.session!.getWorkingDirectory?.() ?? null
        } catch {
            target = null
        }
        if (!target && cfg?.rememberPathPerHost) {
            target = cfg.pathMemory?.[hostKey] ?? null
        }
        if (!target) {
            const fallback = tab.profile?.options?.cwd || cfg?.fallbackPath || '/'
            target = await this.askPath(String(fallback))
            if (!target) {
                return null
            }
        }

        if (target.startsWith('~')) {
            this.notifications.error(this.i18n.t('notify.badPath', { path: target }))
            return null
        }
        try {
            const sftp = await tab.sshSession!.openSFTP()
            const st = await sftp.stat(target)
            if (!st.isDirectory) {
                throw new Error('not a directory')
            }
            return this.normalizeDir(target)
        } catch {
            this.notifications.error(this.i18n.t('notify.badPath', { path: target }))
            return null
        }
    }

    private rememberPath (tab: SSHTabLike, target: string): void {
        const cfg = this.config.store.smartUpload
        if (!cfg?.rememberPathPerHost) {
            return
        }
        cfg.pathMemory = { ...(cfg.pathMemory ?? {}), [hostKeyOf(tab)]: target }
        void this.config.save()
    }

    private async askPath (defaultPath: string): Promise<string | null> {
        const ref = this.modal.open(UploadPathModalComponent, { centered: true })
        ref.componentInstance.path = defaultPath
        try {
            const result = await ref.result
            return typeof result === 'string' && result.trim() ? result.trim() : null
        } catch {
            return null
        }
    }

    private async mapWithConcurrency<T> (items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
        const queue = [...items]
        const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
            let item: T | undefined
            while ((item = queue.shift()) !== undefined) {
                try {
                    await fn(item)
                } catch {
                    // 单项失败不影响队列
                }
            }
        })
        await Promise.all(workers)
    }

    private joinPosix (dir: string, name: string): string {
        return dir.replace(/\/+$/, '') + '/' + name
    }

    private normalizeDir (p: string): string {
        return '/' + p.split('/').filter(Boolean).join('/')
    }

    private baseName (p: string): string {
        const parts = p.split(/[\\/]/)
        return parts[parts.length - 1] || p
    }

    private safeName (t: FileUpload): string {
        try {
            return t.getName()
        } catch {
            return 'file'
        }
    }
}
