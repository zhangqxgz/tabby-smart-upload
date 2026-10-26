/**
 * 下载服务：扩展内置 SFTP 面板右键菜单，提供"下载到本地文件夹（免弹窗）"能力。
 *
 * 关键点：
 * - platform.startDownload(name, mode, size, filePath) 传第 4 个参数可跳过保存对话框，
 *   直接写到指定本地路径（ElectronFileDownload，自动进 fileTransferStarted$ → 传输中心可跟踪）
 * - 文件夹：递归 readdir + 本地 mkdir + 逐文件 startDownload + sftp.download（每个文件独立进度）
 * - 同名冲突策略复用设置里的 conflictPolicy（本地文件）；目录冲突则合并
 * - Windows 文件名非法字符（<>:"/\|?*）会清洗为 _
 */
import { Injectable } from '@angular/core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ConfigService, NotificationsService, PlatformService } from 'tabby-core'
import { SFTPFile, SFTPSession } from 'tabby-ssh'
import { I18nService } from '../i18n'
import { diag } from '../diag'

interface DownloadStats {
    ok: number
    fail: number
    skip: number
}

const INVALID_WIN_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

@Injectable()
export class DownloadService {
    constructor (
        private platform: PlatformService,
        private config: ConfigService,
        private notifications: NotificationsService,
        private i18n: I18nService,
    ) { }

    /** 默认下载目录（配置为空时用 ~/Downloads） */
    defaultDownloadDir (): string {
        const configured = String(this.config.store.smartUpload?.downloadDir ?? '').trim()
        if (configured) {
            return configured
        }
        return path.join(os.homedir(), 'Downloads')
    }

    /** 下载单个文件 / 文件夹到默认下载目录 */
    async downloadItem (sftp: SFTPSession, item: SFTPFile, remoteDir: string): Promise<void> {
        const base = this.defaultDownloadDir()
        const stats: DownloadStats = { ok: 0, fail: 0, skip: 0 }
        try {
            if (item.isDirectory) {
                const localRoot = path.join(base, this.sanitizeName(item.name))
                fs.mkdirSync(localRoot, { recursive: true })
                await this.downloadTree(sftp, remoteDir, localRoot, stats)
            } else {
                await this.downloadOneFile(sftp, item.fullPath, item.name, item.size, base, stats)
            }
        } catch (e) {
            diag('download:error', { error: String(e) })
            stats.fail++
        }
        diag('download:done', { base, ...stats })
        this.notifySummary(stats)
    }

    private async downloadTree (sftp: SFTPSession, remoteDir: string, localDir: string, stats: DownloadStats): Promise<void> {
        let entries: SFTPFile[]
        try {
            entries = await sftp.readdir(remoteDir)
        } catch (e) {
            stats.fail++
            diag('download:readdir-fail', { remoteDir, error: String(e) })
            return
        }
        for (const entry of entries) {
            if (entry.isDirectory) {
                const sub = path.join(localDir, this.sanitizeName(entry.name))
                fs.mkdirSync(sub, { recursive: true })
                await this.downloadTree(sftp, entry.fullPath, sub, stats)
            } else {
                await this.downloadOneFile(sftp, entry.fullPath, entry.name, entry.size, localDir, stats)
            }
        }
    }

    private async downloadOneFile (sftp: SFTPSession, remotePath: string, name: string, size: number, localDir: string, stats: DownloadStats): Promise<void> {
        const resolved = this.resolveLocalPath(localDir, name)
        if (resolved.skip) {
            stats.skip++
            diag('download:skip', { dest: resolved.path })
            return
        }
        try {
            fs.mkdirSync(path.dirname(resolved.path), { recursive: true })
            // 第 4 个参数 filePath：跳过保存对话框（运行时支持，类型声明未暴露）
            const transfer = await (this.platform as any).startDownload(name, 0o644, size, resolved.path)
            if (!transfer) {
                stats.skip++
                return
            }
            try {
                await sftp.download(remotePath, transfer)
                stats.ok++
                diag('download:file-ok', { dest: resolved.path })
            } catch (e) {
                stats.fail++
                diag('download:file-fail', { dest: resolved.path, error: String(e) })
            }
        } catch (e) {
            stats.fail++
            diag('download:open-fail', { dest: resolved.path, error: String(e) })
        }
    }

    /** 本地同名冲突策略（目录由调用方合并处理） */
    private resolveLocalPath (dir: string, name: string): { path: string, skip: boolean } {
        const safeName = this.sanitizeName(name)
        const policy = this.config.store.smartUpload?.conflictPolicy ?? 'overwrite'
        let dest = path.join(dir, safeName)
        if (!fs.existsSync(dest)) {
            return { path: dest, skip: false }
        }
        if (policy === 'skip') {
            return { path: dest, skip: true }
        }
        if (policy === 'rename') {
            const dot = safeName.lastIndexOf('.')
            const stem = dot > 0 ? safeName.slice(0, dot) : safeName
            const ext = dot > 0 ? safeName.slice(dot) : ''
            for (let i = 1; i < 1000; i++) {
                dest = path.join(dir, `${stem} (${i})${ext}`)
                if (!fs.existsSync(dest)) {
                    return { path: dest, skip: false }
                }
            }
            return { path: dest, skip: true }
        }
        // overwrite
        return { path: dest, skip: false }
    }

    private sanitizeName (name: string): string {
        const cleaned = name.replace(INVALID_WIN_CHARS, '_').replace(/[. ]+$/, '')
        return cleaned || 'unnamed'
    }

    private notifySummary (stats: DownloadStats): void {
        if (stats.ok === 0 && stats.fail === 0 && stats.skip === 0) {
            return
        }
        let msg = this.i18n.t(stats.fail > 0 ? 'notify.downloadSummaryError' : 'notify.downloadSummaryDone', {
            ok: stats.ok,
            fail: stats.fail,
        })
        if (stats.skip > 0) {
            msg += this.i18n.t('notify.uploadSkipped', { skip: stats.skip })
        }
        if (stats.fail > 0) {
            this.notifications.error(msg)
        } else {
            this.notifications.notice(msg)
        }
    }
}
