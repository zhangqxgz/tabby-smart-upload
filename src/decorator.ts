/**
 * 终端装饰器：发现 SSH 标签页、跟踪其 shell 会话生命周期，调度 CWD 注入
 */
import { Injectable } from '@angular/core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { asSSHTab, hostKeyOf } from './types'
import { CwdInjectService } from './services/cwdInject.service'

@Injectable()
export class SmartUploadDecorator extends TerminalDecorator {
    constructor (private cwdInject: CwdInjectService) {
        super()
    }

    attach (terminal: BaseTerminalTabComponent<any>): void {
        const tab = asSSHTab(terminal)
        if (!tab) {
            return
        }
        const sessionChanged$ = (terminal as any).sessionChanged$
        if (sessionChanged$?.subscribe) {
            this.subscribeUntilDetached(terminal, sessionChanged$.subscribe(() => {
                if (tab.session) {
                    this.cwdInject.scheduleSetup(tab, hostKeyOf(tab))
                }
            }))
        }
        if (tab.session) {
            this.cwdInject.scheduleSetup(tab, hostKeyOf(tab))
        }
    }
}
