/**
 * 工具栏按钮 / 快捷键 / 标签页右键菜单 / 设置页 四个扩展点
 */
import { Injectable } from '@angular/core'
import {
    BaseTabComponent,
    HotkeyProvider,
    MenuItemOptions,
    TabContextMenuItemProvider,
    ToolbarButton,
    ToolbarButtonProvider,
} from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { I18nService } from './i18n'
import { ICON_TRANSFERS, ICON_UPLOAD } from './icons'
import { CwdInjectService, ShellSessionLike } from './services/cwdInject.service'
import { TransferCenterService } from './services/transferCenter.service'
import { asSSHTab, hostKeyOf, UploadService } from './services/upload.service'
import { SettingsTabComponent } from './components/settingsTab.component'

@Injectable()
export class SmartUploadToolbarProvider extends ToolbarButtonProvider {
    constructor (
        private upload: UploadService,
        private transferCenter: TransferCenterService,
        private i18n: I18nService,
    ) {
        super()
    }

    provide (): ToolbarButton[] {
        return [
            {
                icon: ICON_UPLOAD,
                title: this.i18n.t('toolbar.upload'),
                weight: 50,
                click: () => { void this.upload.uploadToCwd() },
            },
            {
                icon: ICON_TRANSFERS,
                title: this.i18n.t('toolbar.transfers'),
                weight: 51,
                click: () => this.transferCenter.requestOpen(),
            },
        ]
    }
}

@Injectable()
export class SmartUploadHotkeyProvider extends HotkeyProvider {
    constructor (private i18n: I18nService) {
        super()
    }

    async provide (): Promise<Array<{ id: string, name: string }>> {
        return [
            { id: 'smart-upload-to-cwd', name: this.i18n.t('hotkey.uploadToCwd') },
            { id: 'smart-upload-transfers', name: this.i18n.t('hotkey.transferCenter') },
        ]
    }
}

@Injectable()
export class SmartUploadContextMenuProvider extends TabContextMenuItemProvider {
    constructor (
        private upload: UploadService,
        private transferCenter: TransferCenterService,
        private cwdInject: CwdInjectService,
        private i18n: I18nService,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent): Promise<MenuItemOptions[]> {
        const sshTab = asSSHTab(tab)
        if (!sshTab) {
            return []
        }
        const items: MenuItemOptions[] = [
            { label: this.i18n.t('ctx.uploadToCwd'), click: () => { void this.upload.uploadToCwd() } },
            { label: this.i18n.t('ctx.transferCenter'), click: () => this.transferCenter.requestOpen() },
        ]
        if (sshTab.session) {
            items.push({
                label: this.i18n.t('ctx.retryCwd'),
                click: () => { void this.cwdInject.injectNow(sshTab.session as ShellSessionLike, hostKeyOf(sshTab)) },
            })
        }
        return items
    }
}

@Injectable()
export class SmartUploadSettingsTabProvider extends SettingsTabProvider {
    id = 'smart-upload'
    icon = ICON_UPLOAD
    title = 'Smart Upload'

    constructor (private i18n: I18nService) {
        super()
        this.title = this.i18n.t('settings.title')
    }

    getComponentType (): any {
        return SettingsTabComponent
    }
}
