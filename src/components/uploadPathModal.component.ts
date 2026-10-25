/**
 * 上传目标目录询问模态框（仅当 CWD 未知且本机无记忆路径时弹出）
 */
import { Component, ViewEncapsulation } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { I18nService } from '../i18n'

@Component({
    selector: 'su-upload-path',
    encapsulation: ViewEncapsulation.None,
    template: `
<div class="modal-header">
    <h5 class="modal-title">{{i18n.t('up.title')}}</h5>
    <button type="button" class="btn-close" (click)="activeModal.dismiss()"></button>
</div>
<div class="modal-body">
    <label class="form-label">{{i18n.t('up.label')}}</label>
    <input class="form-control" type="text" [(ngModel)]="path" (keydown.enter)="confirm()" autofocus>
    <div class="form-text text-muted mt-2">{{i18n.t('up.hint')}}</div>
</div>
<div class="modal-footer">
    <button class="btn btn-secondary" (click)="activeModal.dismiss()">{{i18n.t('up.cancel')}}</button>
    <button class="btn btn-primary" (click)="confirm()">{{i18n.t('up.ok')}}</button>
</div>`,
})
export class UploadPathModalComponent {
    path = '/'

    constructor (
        public activeModal: NgbActiveModal,
        public i18n: I18nService,
    ) { }

    confirm (): void {
        this.activeModal.close(this.path)
    }
}
