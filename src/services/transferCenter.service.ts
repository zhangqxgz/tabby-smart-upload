/**
 * 传输中心服务（模块 B 核心）
 *
 * 订阅 Tabby 的 platform.fileTransferStarted$（tabby-core 公开 API），
 * 把内置 SFTP 面板、拖拽、以及本插件自己发起的全部传输汇聚成带
 * 状态机 / 速度 / ETA 的列表，供传输中心模态框展示。
 *
 * 注意：本文件刻意不 import 模态框组件（组件反过来依赖本服务做 DI，
 * 双向引用在打包后会产生 TDZ 运行时错误），打开模态框通过
 * openRequested$ 由 transferCenterModal.component.ts 里的 bridgeTransferCenterUi 桥接。
 */
import { ApplicationRef, Injectable } from '@angular/core'
import { Subject } from 'rxjs'
import { ConfigService, FileDownload, FileTransfer, HotkeysService, NotificationsService, PlatformService } from 'tabby-core'
import { I18nService } from '../i18n'

export type TransferStatus = 'active' | 'done' | 'error' | 'cancelled'

export interface TransferItem {
    id: number
    transfer: FileTransfer
    name: string
    size: number
    isDownload: boolean
    status: TransferStatus
    startedAt: number
    finishedAt: number | null
    bytes: number
    /** 平滑后的速度（B/s） */
    speed: number
    etaMs: number | null
    /** 失败原因等备注 */
    note: string
}

const MAX_ITEMS = 300
const SAMPLE_INTERVAL_MS = 500

let seq = 0

@Injectable()
export class TransferCenterService {
    items: TransferItem[] = []
    /** 请求打开传输中心模态框（由 UI 桥接层订阅并执行真正的打开） */
    openRequested$ = new Subject<void>()

    constructor (
        private platform: PlatformService,
        private config: ConfigService,
        private notifications: NotificationsService,
        private hotkeys: HotkeysService,
        private i18n: I18nService,
        private appRef: ApplicationRef,
    ) {
        this.platform.fileTransferStarted$.subscribe(t => this.add(t))
        setInterval(() => this.sample(), SAMPLE_INTERVAL_MS)
        this.hotkeys.hotkey$.subscribe(h => {
            if (h === 'smart-upload-transfers') {
                this.requestOpen()
            }
        })
    }

    get activeCount (): number {
        return this.items.filter(x => x.status === 'active').length
    }

    get totalSpeed (): number {
        return this.items.filter(x => x.status === 'active').reduce((a, x) => a + x.speed, 0)
    }

    /** 传输列表：最新在前（startedAt 降序，id 兜底） */
    get sortedItems (): TransferItem[] {
        return [...this.items].sort((a, b) => b.startedAt - a.startedAt || b.id - a.id)
    }

    /** 请求打开传输中心模态框 */
    requestOpen (): void {
        this.openRequested$.next()
    }

    cancel (item: TransferItem): void {
        if (item.status !== 'active') {
            return
        }
        try {
            item.transfer.cancel()
        } catch {
            // ignore
        }
    }

    clearFinished (): void {
        this.items = this.items.filter(x => x.status === 'active')
    }

    private add (transfer: FileTransfer): void {
        const item: TransferItem = {
            id: ++seq,
            transfer,
            name: this.safeName(transfer),
            size: Math.max(0, transfer.getSize()),
            isDownload: transfer instanceof FileDownload,
            status: 'active',
            startedAt: Date.now(),
            finishedAt: null,
            bytes: 0,
            speed: 0,
            etaMs: null,
            note: '',
        }
        this.items.unshift(item)
        while (this.items.length > MAX_ITEMS) {
            const idx = this.items.map(x => x.status !== 'active').lastIndexOf(true)
            if (idx === -1) {
                break
            }
            this.items.splice(idx, 1)
        }
        if (this.config.store.smartUpload?.autoOpenTransferCenter) {
            this.requestOpen()
        }
        // Tabby 自带的传输下拉把新传输追加在末尾（最新在最下面），
        // 这里在下一轮事件循环把它的数组原地重排为最新在前。
        setTimeout(() => this.reorderBuiltinTransfers(), 0)
    }

    /**
     * 重排 Tabby 自带传输下拉（AppRoot 的 activeTransfers 数组）。
     * 内置模板按数组顺序渲染，直接原地 splice 后触发一次变更检测即可；
     * 若未来内置结构变化（属性不存在），静默跳过，不影响插件自身功能。
     */
    private reorderBuiltinTransfers (): void {
        try {
            if (!this.config.store.smartUpload?.reorderBuiltinTransfers) {
                return
            }
            const root: any = (this.appRef as any).components?.[0]
            const arr: any[] | undefined = root?.activeTransfers
            if (!Array.isArray(arr) || arr.length < 2) {
                return
            }
            const startedAt = new Map<FileTransfer, number>()
            for (const item of this.items) {
                startedAt.set(item.transfer, item.startedAt)
            }
            const sorted = [...arr].sort((a, b) => (startedAt.get(b) ?? 0) - (startedAt.get(a) ?? 0))
            arr.splice(0, arr.length, ...sorted)
            this.appRef.tick()
        } catch {
            // 内置结构变化则静默跳过
        }
    }

    private sample (): void {
        const cfg = this.config.store.smartUpload
        for (const item of this.items) {
            if (item.status !== 'active') {
                continue
            }
            const t = item.transfer
            let bytes = 0
            try {
                bytes = t.getCompletedBytes()
            } catch {
                continue
            }
            const instantBps = Math.max(0, bytes - item.bytes) * (1000 / SAMPLE_INTERVAL_MS)
            item.speed = Math.round(item.speed * 0.6 + instantBps * 0.4)
            item.bytes = bytes

            // 新版宿主才有 getStatus（发布类型声明滞后，运行时防御式调用）
            const st: string = (t as any).getStatus?.() ?? ''
            if (this.safeComplete(t)) {
                item.status = 'done'
                item.bytes = item.size
                item.speed = 0
                item.etaMs = null
                item.finishedAt = Date.now()
                if (cfg?.notifyOnComplete) {
                    this.notifications.notice(this.i18n.t('notify.transferDone', { name: item.name }))
                }
            } else if (t.isCancelled()) {
                item.finishedAt = Date.now()
                item.speed = 0
                item.etaMs = null
                if (st) {
                    item.status = 'error'
                    item.note = st
                    if (cfg?.notifyOnComplete) {
                        this.notifications.error(this.i18n.t('notify.transferError', { name: item.name, error: st }))
                    }
                } else {
                    item.status = 'cancelled'
                }
            } else {
                item.etaMs = item.speed > 0
                    ? Math.max(0, item.size - item.bytes) / item.speed * 1000
                    : null
            }
        }
    }

    private safeName (t: FileTransfer): string {
        try {
            return t.getName()
        } catch {
            return '?'
        }
    }

    private safeComplete (t: FileTransfer): boolean {
        try {
            return t.isComplete()
        } catch {
            return false
        }
    }
}
