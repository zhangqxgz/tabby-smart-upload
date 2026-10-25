/**
 * 传输中心模态框：总览 + 逐文件进度 / 速度 / ETA / 状态 / 取消
 */
import { Component, ViewEncapsulation } from '@angular/core'
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { I18nService } from '../i18n'
import { TransferCenterService, TransferItem } from '../services/transferCenter.service'

/**
 * UI 桥接：把服务的 openRequested$ 接到模态框打开动作上。
 * 放在组件文件里是为了避免 service ↔ component 循环依赖（TDZ 坑）。
 */
export function bridgeTransferCenterUi (service: TransferCenterService, modal: NgbModal): void {
    let openCount = 0
    service.openRequested$.subscribe(() => {
        if (openCount > 0) {
            return
        }
        openCount++
        const ref = modal.open(TransferCenterModalComponent, { size: 'lg', centered: true })
        ref.result.catch(() => null).finally(() => {
            openCount--
        })
    })
}

@Component({
    selector: 'su-transfer-center',
    encapsulation: ViewEncapsulation.None,
    template: `
<div class="modal-header">
    <h5 class="modal-title">{{i18n.t('tc.title')}}</h5>
    <span class="su-tc-summary text-muted small ms-3" *ngIf="tc.activeCount > 0">
        {{i18n.t('tc.active', {n: tc.activeCount})}} · {{i18n.t('tc.totalSpeed')}} {{fmtBytes(tc.totalSpeed)}}/s
    </span>
    <button type="button" class="btn-close" (click)="activeModal.dismiss()"></button>
</div>
<div class="modal-body su-tc-body">
    <div class="text-muted text-center py-4" *ngIf="tc.items.length === 0">{{i18n.t('tc.empty')}}</div>
    <div class="su-tc-row" *ngFor="let item of tc.items" [ngClass]="'st-' + item.status">
        <span class="su-tc-dir" [title]="item.isDownload ? 'download' : 'upload'">{{item.isDownload ? '↓' : '↑'}}</span>
        <div class="su-tc-main">
            <div class="su-tc-name" [title]="item.name">
                {{item.name}}
                <span class="text-danger small" *ngIf="item.note">({{item.note}})</span>
            </div>
            <div class="su-tc-bar">
                <div class="su-tc-fill" [ngClass]="item.status" [style.width.%]="progress(item)"></div>
            </div>
            <div class="su-tc-meta">
                <span>{{fmtBytes(item.bytes)}} / {{fmtBytes(item.size)}}</span>
                <span *ngIf="item.status === 'active' && item.speed > 0">{{fmtBytes(item.speed)}}/s</span>
                <span *ngIf="item.status === 'active' && item.etaMs != null">{{i18n.t('tc.eta', {t: fmtEta(item.etaMs)})}}</span>
                <span class="su-tc-badge" [ngClass]="item.status">{{statusLabel(item.status)}}</span>
            </div>
        </div>
        <button class="btn btn-link btn-sm su-tc-cancel" *ngIf="item.status === 'active'"
            (click)="tc.cancel(item)" [title]="i18n.t('tc.cancel')">✕</button>
    </div>
</div>
<div class="modal-footer">
    <button class="btn btn-sm btn-secondary" (click)="tc.clearFinished()">{{i18n.t('tc.clearFinished')}}</button>
    <button class="btn btn-sm btn-primary" (click)="activeModal.close()">{{i18n.t('tc.close')}}</button>
</div>`,
    styles: [`
.su-tc-body { max-height: 55vh; overflow-y: auto; }
.su-tc-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 4px; border-bottom: 1px solid rgba(128,128,128,.15); }
.su-tc-row.st-done { opacity: .65; }
.su-tc-dir { flex: 0 0 auto; width: 18px; text-align: center; font-weight: 700; margin-top: 2px; }
.su-tc-main { flex: 1 1 auto; min-width: 0; }
.su-tc-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
.su-tc-bar { height: 4px; border-radius: 2px; background: rgba(128,128,128,.25); overflow: hidden; margin-bottom: 4px; }
.su-tc-fill { height: 100%; border-radius: 2px; background: #0d6efd; transition: width .4s linear; }
.su-tc-fill.done { background: #198754; }
.su-tc-fill.error, .su-tc-fill.cancelled { background: #dc3545; }
.su-tc-meta { display: flex; gap: 12px; align-items: center; font-size: 12px; color: #888; }
.su-tc-badge { margin-left: auto; font-size: 11px; padding: 1px 6px; border-radius: 8px; border: 1px solid rgba(128,128,128,.4); }
.su-tc-badge.active { color: #0d6efd; border-color: #0d6efd; }
.su-tc-badge.done { color: #198754; border-color: #198754; }
.su-tc-badge.error { color: #dc3545; border-color: #dc3545; }
.su-tc-badge.cancelled { color: #888; }
.su-tc-cancel { flex: 0 0 auto; text-decoration: none; padding: 0 6px; }
`],
})
export class TransferCenterModalComponent {
    constructor (
        public activeModal: NgbActiveModal,
        public tc: TransferCenterService,
        public i18n: I18nService,
    ) { }

    progress (item: TransferItem): number {
        if (item.size > 0) {
            return Math.min(100, Math.round(item.bytes / item.size * 100))
        }
        return item.status === 'done' ? 100 : 0
    }

    statusLabel (s: string): string {
        return this.i18n.t('tc.status.' + s)
    }

    fmtBytes (n: number): string {
        if (!isFinite(n) || n < 0) {
            return '-'
        }
        if (n < 1024) {
            return n + ' B'
        }
        const units = ['KB', 'MB', 'GB', 'TB']
        let v = n / 1024
        let i = 0
        while (v >= 1024 && i < units.length - 1) {
            v /= 1024
            i++
        }
        return v.toFixed(1) + ' ' + units[i]
    }

    fmtEta (ms: number): string {
        const s = Math.ceil(ms / 1000)
        if (s < 60) {
            return s + 's'
        }
        const m = Math.floor(s / 60)
        return m + 'm' + (s % 60 ? (s % 60) + 's' : '')
    }
}
