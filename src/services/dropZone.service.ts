/**
 * 拖拽上传：把文件/文件夹拖到 SSH 终端区域 → 上传到当前目录。
 *
 * 实现方式：document 捕获阶段监听（一次性绑定），命中检测 div.terminal，
 * 排除 SFTP 面板（自带 dropZone）等区域；通过 hostView.rootNodes 把 DOM
 * 反查到具体标签页（分屏下也能定位到拖入的那个 SSH 面板）。
 */
import { Injectable } from '@angular/core'
import { AppService } from 'tabby-core'
import { I18nService } from '../i18n'
import { asSSHTab, resolveFocusedTab, SSHTabLike, UploadService } from './upload.service'
import { diag } from '../diag'

const HINT_STYLE = `
.su-drop-banner {
    position: fixed;
    left: 50%;
    bottom: 48px;
    transform: translateX(-50%);
    z-index: 2147483000;
    pointer-events: none;
    background: rgba(13, 110, 253, .92);
    color: #fff;
    padding: 8px 18px;
    border-radius: 20px;
    font-size: 13px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
    opacity: 0;
    transition: opacity .15s ease;
}
.su-drop-banner.visible { opacity: 1; }
`

/** 取标签页的宿主 DOM 元素（Angular hostView.rootNodes） */
export function resolveHostElement (tab: any): HTMLElement | null {
    try {
        const nodes = tab?.hostView?.rootNodes
        if (Array.isArray(nodes)) {
            for (const n of nodes) {
                if (n instanceof HTMLElement) {
                    return n
                }
            }
        }
    } catch {
        // ignore
    }
    return null
}

@Injectable()
export class DropZoneService {
    private bound = false
    private banner: HTMLElement | null = null
    private hideTimer: any = null

    constructor (
        private app: AppService,
        private upload: UploadService,
        private i18n: I18nService,
    ) { }

    init (): void {
        if (this.bound) {
            return
        }
        this.bound = true
        const style = document.createElement('style')
        style.textContent = HINT_STYLE
        document.head.appendChild(style)
        this.banner = document.createElement('div')
        this.banner.className = 'su-drop-banner'
        this.banner.textContent = this.i18n.t('drop.hint')
        document.body.appendChild(this.banner)

        document.addEventListener('dragover', e => this.onDragOver(e as DragEvent), true)
        document.addEventListener('drop', e => this.onDrop(e as DragEvent), true)
    }

    private hasFiles (e: DragEvent): boolean {
        return !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files')
    }

    /** 命中检测：拖到终端区域且不是 SFTP 面板等自带拖放区 */
    private hitTerminal (e: DragEvent): HTMLElement | null {
        const el = e.target as HTMLElement | null
        if (!el || typeof el.closest !== 'function') {
            return null
        }
        if (el.closest('sftp-panel, [dropzone]')) {
            return null
        }
        return el.closest('.terminal') as HTMLElement | null
    }

    /** 反查 drop 目标所属的 SSH 标签页（分屏下精确到面板） */
    private findTabForElement (el: HTMLElement): SSHTabLike | null {
        const visit = (t: any): SSHTabLike | null => {
            if (!t) {
                return null
            }
            if (typeof t.getAllTabs === 'function') {
                for (const child of t.getAllTabs()) {
                    const r = visit(child)
                    if (r) {
                        return r
                    }
                }
                return null
            }
            const host = resolveHostElement(t)
            if (host && (host === el || host.contains(el))) {
                return asSSHTab(t)
            }
            return null
        }
        for (const t of this.app.tabs) {
            const r = visit(t)
            if (r) {
                return r
            }
        }
        return asSSHTab(resolveFocusedTab(this.app.activeTab))
    }

    private showBanner (): void {
        if (this.banner) {
            this.banner.classList.add('visible')
        }
        if (this.hideTimer) {
            clearTimeout(this.hideTimer)
        }
        this.hideTimer = setTimeout(() => this.hideBanner(), 400)
    }

    private hideBanner (): void {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer)
            this.hideTimer = null
        }
        this.banner?.classList.remove('visible')
    }

    private onDragOver (e: DragEvent): void {
        if (!this.hasFiles(e)) {
            return
        }
        const terminal = this.hitTerminal(e)
        if (!terminal) {
            this.hideBanner()
            return
        }
        const tab = this.findTabForElement(terminal)
        if (!tab) {
            this.hideBanner()
            return
        }
        // 允许放下
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy'
        }
        this.showBanner()
    }

    private onDrop (e: DragEvent): void {
        if (!this.hasFiles(e)) {
            return
        }
        const terminal = this.hitTerminal(e)
        if (!terminal) {
            return
        }
        const tab = this.findTabForElement(terminal)
        if (!tab) {
            return
        }
        e.preventDefault()
        e.stopPropagation()
        this.hideBanner()
        diag('drop:start', { title: tab.title })
        void this.upload.uploadDrop(tab, e)
    }
}
