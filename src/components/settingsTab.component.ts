/**
 * 设置页
 */
import { Component } from '@angular/core'
import { ConfigService, NotificationsService, PlatformService } from 'tabby-core'
import { buildCwdSnippet, buildFishSnippet } from '../services/cwdInject.service'
import { I18nService } from '../i18n'

@Component({
    selector: 'smart-upload-settings',
    template: `
<div class="smart-upload-settings">
    <h4>{{i18n.t('settings.title')}}</h4>

    <h6 class="mt-4">{{i18n.t('settings.injectGroup')}}</h6>
    <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="suAutoInject" [(ngModel)]="c.autoInject" (ngModelChange)="save()">
        <label class="form-check-label" for="suAutoInject">{{i18n.t('settings.autoInject')}}</label>
    </div>
    <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="suSilentSetup" [(ngModel)]="c.silentSetup" (ngModelChange)="save()">
        <label class="form-check-label" for="suSilentSetup">{{i18n.t('settings.silentSetup')}}</label>
    </div>
    <div class="text-muted small mb-2">{{i18n.t('settings.silentSetupHint')}}</div>
    <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="suNotifyFail" [(ngModel)]="c.notifyInjectFailure" (ngModelChange)="save()">
        <label class="form-check-label" for="suNotifyFail">{{i18n.t('settings.notifyInjectFailure')}}</label>
    </div>
    <button class="btn btn-sm btn-outline-secondary mt-2" (click)="clearFailed()">{{i18n.t('settings.clearFailed')}}</button>

    <h6 class="mt-4">{{i18n.t('settings.snippetsTitle')}}</h6>
    <div class="text-muted small">{{i18n.t('settings.snippetsHint')}}</div>
    <div class="text-muted small mt-2">{{i18n.t('settings.snippetBashZsh')}}</div>
    <pre class="border rounded p-2 mt-1 small" style="white-space: pre-wrap;">{{snippet}}</pre>
    <button class="btn btn-sm btn-outline-secondary" (click)="copySnippet(snippet)">{{i18n.t('settings.copy')}}</button>
    <div class="text-muted small mt-3">{{i18n.t('settings.snippetFish')}}</div>
    <pre class="border rounded p-2 mt-1 small" style="white-space: pre-wrap;">{{fishSnippet}}</pre>
    <button class="btn btn-sm btn-outline-secondary" (click)="copySnippet(fishSnippet)">{{i18n.t('settings.copy')}}</button>

    <h6 class="mt-4">{{i18n.t('settings.tcGroup')}}</h6>
    <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="suAutoOpen" [(ngModel)]="c.autoOpenTransferCenter" (ngModelChange)="save()">
        <label class="form-check-label" for="suAutoOpen">{{i18n.t('settings.autoOpen')}}</label>
    </div>
    <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="suNotifyDone" [(ngModel)]="c.notifyOnComplete" (ngModelChange)="save()">
        <label class="form-check-label" for="suNotifyDone">{{i18n.t('settings.notifyDone')}}</label>
    </div>
    <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="suReorderBuiltin" [(ngModel)]="c.reorderBuiltinTransfers" (ngModelChange)="save()">
        <label class="form-check-label" for="suReorderBuiltin">{{i18n.t('settings.reorderBuiltin')}}</label>
    </div>
    <div class="text-muted small">{{i18n.t('settings.reorderBuiltinHint')}}</div>

    <h6 class="mt-4">{{i18n.t('settings.upGroup')}}</h6>
    <label class="form-label">{{i18n.t('settings.concurrency')}}</label>
    <input type="number" class="form-control w-auto" min="1" max="8"
        [(ngModel)]="c.uploadConcurrency" (ngModelChange)="onConcurrencyChange()">
    <label class="form-label mt-2">{{i18n.t('settings.conflictPolicy')}}</label>
    <select class="form-select w-auto" [(ngModel)]="c.conflictPolicy" (ngModelChange)="save()">
        <option value="overwrite">{{i18n.t('settings.conflictOverwrite')}}</option>
        <option value="skip">{{i18n.t('settings.conflictSkip')}}</option>
        <option value="rename">{{i18n.t('settings.conflictRename')}}</option>
    </select>
    <div class="form-check form-switch mt-2">
        <input class="form-check-input" type="checkbox" id="suRemember" [(ngModel)]="c.rememberPathPerHost" (ngModelChange)="save()">
        <label class="form-check-label" for="suRemember">{{i18n.t('settings.rememberPath')}}</label>
    </div>
    <label class="form-label mt-2">{{i18n.t('settings.fallbackPath')}}</label>
    <input type="text" class="form-control w-auto" [(ngModel)]="c.fallbackPath" (ngModelChange)="save()">

    <h6 class="mt-4">{{i18n.t('settings.downloadGroup')}}</h6>
    <label class="form-label">{{i18n.t('settings.downloadDir')}}</label>
    <input type="text" class="form-control w-auto" [(ngModel)]="c.downloadDir" (ngModelChange)="save()">
    <div class="text-muted small">{{i18n.t('settings.downloadDirHint')}}</div>
</div>`,
})
export class SettingsTabComponent {
    snippet = buildCwdSnippet()
    fishSnippet = buildFishSnippet()

    constructor (
        public config: ConfigService,
        private notifications: NotificationsService,
        private platform: PlatformService,
        public i18n: I18nService,
    ) { }

    get c () {
        return this.config.store.smartUpload
    }

    save (): void {
        void this.config.save()
    }

    onConcurrencyChange (): void {
        let v = Number(this.c.uploadConcurrency)
        if (!isFinite(v)) {
            v = 2
        }
        this.c.uploadConcurrency = Math.min(8, Math.max(1, Math.round(v)))
        this.save()
    }

    clearFailed (): void {
        this.c.failedHosts = []
        this.save()
        this.notifications.notice(this.i18n.t('settings.cleared'))
    }

    copySnippet (text: string): void {
        this.platform.setClipboard({ text })
        this.notifications.notice(this.i18n.t('settings.copied'))
    }
}
