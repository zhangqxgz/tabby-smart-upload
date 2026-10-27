/**
 * 上传服务：上传到当前目录（文件 / 文件夹 / 拖拽）
 *
 * 能力：
 * - 目录解析：终端上报 → 按需探测 → 按主机记忆 → 弹窗询问
 * - 同名冲突策略：覆盖 / 跳过 / 自动改名
 * - 受限并发；失败项可在传输中心重试（需要本地路径，来自 ElectronFileUpload.filePath）
 * - 传输中心跟踪：内置 startUpload / 拖拽已在 1.0.238 自动登记，文件夹选择器的
 *   ElectronFileUpload 不会，这里按需补登记（hasTransfer 判重，避免一条文件两条记录）
 */
import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { AppService, ConfigService, DirectoryUpload, FileUpload, HotkeysService, NotificationsService, PlatformService } from 'tabby-core'
import { SFTPSession } from 'tabby-ssh'
import { I18nService } from '../i18n'
import { CwdInjectService } from './cwdInject.service'
import { TransferCenterService } from './transferCenter.service'
import { UploadPathModalComponent } from '../components/uploadPathModal.component'
import { diag } from '../diag'
import { asSSHTab, hostKeyOf, resolveFocusedTab, SSHTabLike } from '../types'

export { asSSHTab, hostKeyOf, resolveFocusedTab } from '../types'
export type { ShellSessionLike, SSHTabLike } from '../types'

interface UploadStats {
    ok: number
    fail: number
    skip: number
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
        private transferCenter: TransferCenterService,
    ) {
        this.hotkeys.hotkey$.subscribe(h => {
            if (h === 'smart-upload-to-cwd') {
                void this.uploadToCwd()
            } else if (h === 'smart-upload-folder-to-cwd') {
                void this.uploadFolderToCwd()
            }
        })
    }

    /** 上传文件（可多选）到当前目录 */
    async uploadToCwd (): Promise<void> {
        const tab = this.activeSSHTab()
        if (!tab) {
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

        const stats: UploadStats = { ok: 0, fail: 0, skip: 0 }
        const concurrency = Math.min(8, Math.max(1, Number(this.config.store.smartUpload?.uploadConcurrency) || 2))
        const sftp = await tab.sshSession.openSFTP()
        await this.mapWithConcurrency(transfers, concurrency, async (t: FileUpload) => {
            await this.uploadOneFile(tab!, sftp, target, t, stats)
        })
        this.notifySummary('notify.uploadSummaryDone', 'notify.uploadSummaryError', stats)
    }

    /** 上传文件夹到当前目录（保留目录结构） */
    async uploadFolderToCwd (): Promise<void> {
        const tab = this.activeSSHTab()
        if (!tab) {
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

        let picked: DirectoryUpload
        try {
            picked = await this.platform.startUploadDirectory()
        } catch {
            return
        }
        if (!picked.getChildrens().length) {
            return
        }
        this.rememberPath(tab, target)

        const stats: UploadStats = { ok: 0, fail: 0, skip: 0 }
        try {
            const sftp = await tab.sshSession.openSFTP()
            await this.uploadTree(tab, sftp, target, picked, stats)
        } catch (e) {
            diag('folder:error', { error: String(e) })
        }
        this.notifySummary('notify.uploadSummaryDone', 'notify.uploadSummaryError', stats)
    }

    /**
     * 拖拽上传入口：把拖入的文件/文件夹树上传到当前目录。
     * 1.0.238 起内置 startUploadFromDragEvent 会自动登记 fileTransferStarted$，
     * 这里不再重复登记（此前重复登记导致一条文件出现两条记录）。
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
        const stats: UploadStats = { ok: 0, fail: 0, skip: 0 }
        try {
            const sftp = await tab.sshSession.openSFTP()
            await this.uploadTree(tab, sftp, target, dropped, stats)
        } catch (e) {
            diag('drop:error', { error: String(e) })
        }
        diag('drop:done', { target, ...stats })
        this.notifySummary('notify.dropSummaryDone', 'notify.dropSummaryError', stats)
    }

    /** 单个文件上传（含冲突策略 / 补登记 / 重试挂载） */
    private async uploadOneFile (tab: SSHTabLike, sftp: SFTPSession, dir: string, t: FileUpload, stats: UploadStats): Promise<void> {
        const name = this.baseName(this.safeName(t))
        const { dest, skip } = await this.resolveDestination(sftp, dir, name)
        if (skip) {
            stats.skip++
            diag('upload:skip', { dest })
            return
        }
        this.ensureTransferRegistered(t)
        this.attachRetry(tab, t, dest)
        diag('upload:file-start', { dest })
        try {
            await sftp.upload(dest, t)
            stats.ok++
            diag('upload:file-ok', { dest })
        } catch (e) {
            stats.fail++
            diag('upload:file-fail', { dest, error: String(e) })
        }
    }

    /** 目录树递归上传 */
    private async uploadTree (tab: SSHTabLike, sftp: SFTPSession, base: string, dir: DirectoryUpload, stats: UploadStats): Promise<void> {
        for (const child of dir.getChildrens()) {
            const name = this.baseName(this.safeName(child as any))
            if (child instanceof DirectoryUpload) {
                const dest = this.joinPosix(base, name)
                try {
                    await sftp.mkdir(dest)
                } catch {
                    // 目录已存在 → 合并
                }
                await this.uploadTree(tab, sftp, dest, child, stats)
            } else {
                await this.uploadOneFile(tab, sftp, base, child as FileUpload, stats)
            }
        }
    }

    /** 同名冲突策略 */
    private async resolveDestination (sftp: SFTPSession, base: string, name: string): Promise<{ dest: string, skip: boolean }> {
        const policy = this.config.store.smartUpload?.conflictPolicy ?? 'overwrite'
        const dest = this.joinPosix(base, name)
        if (policy === 'overwrite') {
            return { dest, skip: false }
        }
        if (!(await this.remoteExists(sftp, dest))) {
            return { dest, skip: false }
        }
        if (policy === 'skip') {
            return { dest, skip: true }
        }
        // rename
        const dot = name.lastIndexOf('.')
        const stem = dot > 0 ? name.slice(0, dot) : name
        const ext = dot > 0 ? name.slice(dot) : ''
        for (let i = 1; i < 1000; i++) {
            const candidate = this.joinPosix(base, `${stem} (${i})${ext}`)
            if (!(await this.remoteExists(sftp, candidate))) {
                return { dest: candidate, skip: false }
            }
        }
        return { dest, skip: true }
    }

    private async remoteExists (sftp: SFTPSession, path: string): Promise<boolean> {
        try {
            await sftp.stat(path)
            return true
        } catch {
            return false
        }
    }

    /**
     * 内置的 startUpload（文件选择）/ startUploadFromDragEvent（拖拽，1.0.238 起）会自动登记
     * fileTransferStarted$；文件夹选择器走 startUploadDirectory → getAllFiles，不会登记。
     * 这里按需补登记，避免一条文件两条记录。
     */
    private ensureTransferRegistered (t: FileUpload): void {
        if (this.transferCenter.hasTransfer(t)) {
            return
        }
        try {
            ;(this.platform as any)._registerFileTransfer?.(t)
        } catch {
            // ignore
        }
    }

    /** 失败重试挂载（仅限有本地路径的 ElectronFileUpload） */
    private attachRetry (tab: SSHTabLike, t: FileUpload, dest: string): void {
        const localPath = (t as any).filePath
        if (!localPath) {
            return
        }
        this.transferCenter.attachRetry(t, async () => {
            let retryTransfer: FileUpload | undefined
            try {
                const list = await this.platform.startUpload({ paths: [localPath], multiple: true } as any)
                retryTransfer = list[0]
            } catch {
                return
            }
            if (!retryTransfer || !tab.sshSession) {
                return
            }
            const sftp = await tab.sshSession.openSFTP()
            try {
                await sftp.upload(dest, retryTransfer)
            } catch {
                // 失败会在传输中心显示
            }
        })
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
        } catch (e) {
            // 终端目录已上报但 SFTP（登录用户）访问不了：多半是 su/sudo 切换了用户或目录无权限
            const reportedCwdExists = !!(await tab.session!.getWorkingDirectory?.().catch(() => null))
            const loginUser = String((tab.profile as any)?.options?.user || '')
            diag('target:stat-fail', { target, loginUser, reportedCwdExists, error: String(e) })
            if (reportedCwdExists) {
                // 明确提示原因，并允许改选一个登录用户可写的目录继续，而不是直接中断
                this.notifications.error(this.i18n.t('notify.pathForbidden', { user: loginUser || '?', path: target }))
                const suggested = (tab.profile as any)?.options?.cwd
                    || (loginUser && loginUser !== 'root' ? `/home/${loginUser}` : null)
                    || cfg?.fallbackPath
                    || '/'
                const picked = await this.askPath(String(suggested))
                if (picked && picked !== target) {
                    try {
                        const sftp2 = await tab.sshSession!.openSFTP()
                        const st2 = await sftp2.stat(picked)
                        if (st2.isDirectory) {
                            diag('target:repicked', { picked })
                            return this.normalizeDir(picked)
                        }
                    } catch {
                        // 落到下面的 badPath 提示
                    }
                    this.notifications.error(this.i18n.t('notify.badPath', { path: picked }))
                }
            } else {
                this.notifications.error(this.i18n.t('notify.badPath', { path: target }))
            }
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

    private activeSSHTab (): SSHTabLike | null {
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
        return tab
    }

    private notifySummary (doneKey: string, errorKey: string, stats: UploadStats): void {
        if (stats.ok === 0 && stats.fail === 0 && stats.skip === 0) {
            return
        }
        let msg = this.i18n.t(stats.fail > 0 ? errorKey : doneKey, { ok: stats.ok, fail: stats.fail })
        if (stats.skip > 0) {
            msg += this.i18n.t('notify.uploadSkipped', { skip: stats.skip })
        }
        if (stats.fail > 0) {
            this.notifications.error(msg)
        } else {
            this.notifications.notice(msg)
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

    private safeName (t: FileUpload | DirectoryUpload): string {
        try {
            return t.getName()
        } catch {
            return 'file'
        }
    }
}
