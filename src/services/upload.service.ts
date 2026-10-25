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
import { AppService, ConfigService, DirectoryUpload, FileUpload, HotkeysService, NotificationsService, PlatformService } from 'tabby-core'
import { SFTPSession } from 'tabby-ssh'
import { I18nService } from '../i18n'
import { CwdInjectService } from './cwdInject.service'
import { UploadPathModalComponent } from '../components/uploadPathModal.component'
import { diag } from '../diag'

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
        private cwdInject: CwdInjectService,
    ) {
        this.hotkeys.hotkey$.subscribe(h => {
            if (h === 'smart-upload-to-cwd') {
                void this.uploadToCwd()
            }
        })
    }

    async uploadToCwd (): Promise<void> {
        const active: any = this.app.activeTab
        const focused = resolveFocusedTab(active)
        const tab = asSSHTab(focused)
        diag('upload:start', {
            activeTab: active?.constructor?.name,
            focusedTab: focused?.constructor?.name,
            isSSH: !!tab,
            hasSession: !!tab?.session,
            hasSshSession: !!tab?.sshSession,
        })
        if (!tab) {
            // 普通提示即可，避免在非 SSH 标签页被误读成"插件报错"
            this.notifications.notice(this.i18n.t('notify.notSSH'))
            return
        }
        if (!tab.sshSession || !tab.session) {
            this.notifications.error(this.i18n.t('notify.notReady'))
            return
        }

        const target = await this.resolveTargetFor(tab)
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
            const dest = this.joinPosix(target, name)
            diag('upload:file-start', { dest })
            try {
                const sftp = await tab.sshSession!.openSFTP()
                await sftp.upload(dest, t)
                ok++
                diag('upload:file-ok', { dest })
            } catch (e) {
                fail++
                diag('upload:file-fail', { dest, error: String(e) })
            }
        })

        if (fail === 0) {
            this.notifications.notice(this.i18n.t('notify.uploadSummaryDone', { ok }))
        } else {
            this.notifications.error(this.i18n.t('notify.uploadSummaryError', { ok, fail }))
        }
    }

    /**
     * 拖拽上传入口：把拖入的文件/文件夹树上传到当前目录。
     * HTMLFileUpload 不会自动进入 fileTransferStarted$，这里手动登记，
     * 让传输中心能跟踪拖拽上传的进度与取消。
     */
    async uploadDrop (tab: SSHTabLike, event: DragEvent): Promise<void> {
        if (!tab.sshSession || !tab.session) {
            this.notifications.error(this.i18n.t('notify.notReady'))
            return
        }
        let dropped: DirectoryUpload
        try {
            dropped = await this.platform.startUploadFromDragEvent(event, true)
        } catch {
            return
        }
        if (!dropped.getChildrens().length) {
            return
        }
        const target = await this.resolveTargetFor(tab)
        if (!target) {
            return
        }
        this.rememberPath(tab, target)
        const result = { ok: 0, fail: 0 }
        try {
            const sftp = await tab.sshSession.openSFTP()
            await this.uploadTree(sftp, target, dropped, result)
        } catch (e) {
            diag('drop:error', { error: String(e) })
        }
        diag('drop:done', { target, ...result })
        if (result.fail === 0 && result.ok > 0) {
            this.notifications.notice(this.i18n.t('notify.dropSummaryDone', { ok: result.ok }))
        } else if (result.fail > 0) {
            this.notifications.error(this.i18n.t('notify.dropSummaryError', { ok: result.ok, fail: result.fail }))
        }
    }

    private async uploadTree (
        sftp: SFTPSession,
        base: string,
        dir: DirectoryUpload,
        result: { ok: number, fail: number },
    ): Promise<void> {
        for (const child of dir.getChildrens()) {
            const name = this.baseName(this.safeName(child as any))
            const dest = this.joinPosix(base, name)
            if (child instanceof DirectoryUpload) {
                try {
                    await sftp.mkdir(dest)
                } catch {
                    // 目录已存在，继续
                }
                await this.uploadTree(sftp, dest, child, result)
            } else {
                try {
                    ;(this.platform as any)._registerFileTransfer?.(child)
                    await sftp.upload(dest, child as FileUpload)
                    result.ok++
                    diag('drop:file-ok', { dest })
                } catch (e) {
                    result.fail++
                    diag('drop:file-fail', { dest, error: String(e) })
                }
            }
        }
    }

    private async resolveTargetFor (tab: SSHTabLike): Promise<string | null> {
        const cfg = this.config.store.smartUpload
        const hostKey = hostKeyOf(tab)

        let target: string | null = null
        try {
            target = await tab.session!.getWorkingDirectory?.() ?? null
        } catch {
            target = null
        }
        // 钩子未生效/刚连接时，主动探测一次，避免误弹路径询问框
        if (!target) {
            target = await this.cwdInject.probeCwd(tab.session!)
        }
        if (!target && cfg?.rememberPathPerHost) {
            target = cfg.pathMemory?.[hostKey] ?? null
        }
        if (!target) {
            const fallback = tab.profile?.options?.cwd || cfg?.fallbackPath || '/'
            diag('target:prompt-modal', { fallback, hostKey })
            target = await this.askPath(String(fallback))
            if (!target) {
                diag('target:modal-cancelled')
                return null
            }
        }
        diag('target:resolved', { target })

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
