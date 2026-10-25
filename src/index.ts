/**
 * tabby-smart-upload 插件入口
 * 注册：TerminalDecorator（CWD 注入）+ 工具栏按钮 + 快捷键 + 标签页右键菜单
 *       + 设置页 + ConfigProvider；模块构造函数注入各服务使其立即实例化。
 */
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgModule, Optional } from '@angular/core'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, {
    ConfigProvider,
    HotkeyProvider,
    LogService,
    TabContextMenuItemProvider,
    ToolbarButtonProvider,
} from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { TerminalDecorator } from 'tabby-terminal'

import { SmartUploadConfigProvider } from './config'
import { SmartUploadDecorator } from './decorator'
import { I18nService } from './i18n'
import {
    SmartUploadContextMenuProvider,
    SmartUploadHotkeyProvider,
    SmartUploadSettingsTabProvider,
    SmartUploadToolbarProvider,
} from './providers'
import { CwdInjectService } from './services/cwdInject.service'
import { TransferCenterService } from './services/transferCenter.service'
import { UploadService } from './services/upload.service'
import { SettingsTabComponent } from './components/settingsTab.component'
import { TransferCenterModalComponent } from './components/transferCenterModal.component'
import { UploadPathModalComponent } from './components/uploadPathModal.component'

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        TabbyCoreModule,
    ],
    declarations: [
        SettingsTabComponent,
        TransferCenterModalComponent,
        UploadPathModalComponent,
    ],
    providers: [
        I18nService,
        CwdInjectService,
        TransferCenterService,
        UploadService,
        { provide: ConfigProvider, useClass: SmartUploadConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: SmartUploadSettingsTabProvider, multi: true },
        { provide: HotkeyProvider, useClass: SmartUploadHotkeyProvider, multi: true },
        { provide: ToolbarButtonProvider, useClass: SmartUploadToolbarProvider, multi: true },
        { provide: TabContextMenuItemProvider, useClass: SmartUploadContextMenuProvider, multi: true },
        { provide: TerminalDecorator, useClass: SmartUploadDecorator, multi: true },
    ],
})
export default class SmartUploadModule {
    constructor (
        @Optional() log: LogService,
        _upload: UploadService,
        _transfers: TransferCenterService,
        _cwdInject: CwdInjectService,
    ) {
        log?.create('smart-upload').info('module loaded')
    }
}
