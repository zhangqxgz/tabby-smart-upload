/**
 * tabby-smart-upload 插件入口
 * 注册：TerminalDecorator（CWD 注入）+ 工具栏按钮 + 快捷键 + 标签页右键菜单
 *       + 设置页 + ConfigProvider；模块构造函数注入各服务使其立即实例化。
 */
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgModule, Optional } from '@angular/core'
import { NgbModal, NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, {
    AppService,
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
import { DropZoneService } from './services/dropZone.service'
import { TransferCenterService } from './services/transferCenter.service'
import { asSSHTab, hostKeyOf, resolveFocusedTab, UploadService } from './services/upload.service'
import { diag } from './diag'
import { SettingsTabComponent } from './components/settingsTab.component'
import { TransferCenterModalComponent, bridgeTransferCenterUi } from './components/transferCenterModal.component'
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
        DropZoneService,
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
        modal: NgbModal,
        transfers: TransferCenterService,
        _upload: UploadService,
        cwdInject: CwdInjectService,
        dropZone: DropZoneService,
        app: AppService,
    ) {
        bridgeTransferCenterUi(transfers, modal)
        dropZone.init()

        // 诊断入口：通过 CDP / DevTools 现场排查用（不参与正常功能）
        ;(globalThis as any).__smartUpload = {
            diag: () => (globalThis as any).__smartUploadDiag ?? [],
            clearDiag: () => { (globalThis as any).__smartUploadDiag = [] },
            probeActive: async () => {
                const focused = resolveFocusedTab(app.activeTab)
                const tab = asSSHTab(focused)
                if (!tab) {
                    return { ok: false, error: 'active tab is not SSH', activeTab: (app.activeTab as any)?.constructor?.name }
                }
                if (!tab.session) {
                    return { ok: false, error: 'no shell session' }
                }
                const before = await tab.session.getWorkingDirectory?.() ?? null
                const cwd = before ?? await cwdInject.probeCwd(tab.session)
                return { ok: !!cwd, title: tab.title, hostKey: hostKeyOf(tab), before, cwd }
            },
            probeAll: async () => {
                const results: any[] = []
                const visit = (t: any): void => {
                    if (!t) {
                        return
                    }
                    if (typeof t.getAllTabs === 'function') {
                        for (const child of t.getAllTabs()) {
                            visit(child)
                        }
                        return
                    }
                    const ssh = asSSHTab(t)
                    if (!ssh) {
                        return
                    }
                    results.push((async () => {
                        if (!ssh.session) {
                            return { title: ssh.title, hostKey: hostKeyOf(ssh), ok: false, error: 'no shell session' }
                        }
                        const before = await ssh.session.getWorkingDirectory?.() ?? null
                        const cwd = before ?? await cwdInject.probeCwd(ssh.session)
                        return { title: ssh.title, hostKey: hostKeyOf(ssh), ok: !!cwd, before, cwd }
                    })())
                }
                for (const t of app.tabs) {
                    visit(t)
                }
                return Promise.all(results)
            },
            reconnectAll: async () => {
                const reconnected: string[] = []
                const visit = (t: any): void => {
                    if (!t) {
                        return
                    }
                    if (typeof t.getAllTabs === 'function') {
                        for (const child of t.getAllTabs()) {
                            visit(child)
                        }
                        return
                    }
                    const ssh = asSSHTab(t)
                    if (!ssh || ssh.session) {
                        return
                    }
                    if (typeof t.reconnect === 'function') {
                        reconnected.push(String(ssh.title))
                        try {
                            t.reconnect()
                        } catch {
                            // ignore
                        }
                    }
                }
                for (const t of app.tabs) {
                    visit(t)
                }
                return reconnected
            },
        }

        log?.create('smart-upload').info('module loaded')
    }
}
