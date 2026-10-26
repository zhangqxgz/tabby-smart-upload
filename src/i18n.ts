/**
 * 轻量 i18n：跟随 Tabby 界面语言（config.store.language），zh* → 中文，其余 → 英文。
 * Tabby 的 ngx-translate 缺失键会回显 key 本身，插件不走它的 .po 体系，自带词典即可。
 */
import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'

type Dict = Record<string, string>

const zhCN: Dict = {
    'toolbar.upload': '上传到当前目录',
    'toolbar.transfers': '传输中心',
    'ctx.uploadToCwd': '上传到当前目录',
    'ctx.transferCenter': '打开传输中心',
    'ctx.retryCwd': '重试 CWD 目录检测注入',
    'hotkey.uploadToCwd': '智能上传：上传到当前目录',
    'hotkey.transferCenter': '智能上传：打开传输中心',

    'settings.title': '智能上传',
    'settings.injectGroup': '目录自动感知（CWD）',
    'settings.autoInject': 'SSH 会话建立后自动注入目录上报',
    'settings.autoInjectHint': '向远端 shell 自动注入 OSC 1337 钩子（支持 bash / zsh；fish 请手动配置），之后 SFTP 面板与「上传到当前目录」都能自动定位到当前目录；只影响当前会话，不修改远端配置文件。若远端已通过 dotfiles 配置过上报，会自动跳过注入（零回显）。注入时终端会回显一行命令，属正常现象。tmux ≥3.3 需在 tmux.conf 中设置 allow-passthrough on。',
    'settings.notifyInjectFailure': '注入失败时提示',
    'settings.clearFailed': '清除失败记录',
    'settings.cleared': '已清除',
    'settings.snippetsTitle': '远端 shell 手动配置（自动注入失败时使用）',
    'settings.snippetsHint': '把对应片段加入远端 shell 的配置文件后重新登录即可：',
    'settings.snippetBashZsh': 'bash / zsh（通用，与自动注入使用的片段相同，可加入 ~/.bashrc 或 ~/.zshrc）：',
    'settings.snippetFish': 'fish（自动注入不支持 fish 语法，需手动加入 ~/.config/fish/config.fish）：',
    'settings.copy': '复制',
    'settings.copied': '已复制到剪贴板',
    'settings.tcGroup': '传输中心',
    'settings.autoOpen': '传输开始时自动打开传输中心',
    'settings.notifyDone': '传输完成 / 失败时弹出通知',
    'settings.reorderBuiltin': 'Tabby 自带的传输列表也按「最新在前」排序',
    'settings.reorderBuiltinHint': 'Tabby 内置的传输下拉默认把新传输排在末尾（最新在最下面），开启后由插件就地重排为最新在前；用我们的「传输中心」不受此开关影响（本来就是最新在前）。',
    'settings.upGroup': '上传',
    'settings.concurrency': '上传并发数（1-8）',
    'settings.rememberPath': '按主机记忆上传目录',
    'settings.fallbackPath': '目录未知时的默认路径（须为绝对路径）',

    'tc.title': '传输中心',
    'tc.active': '{n} 项进行中',
    'tc.totalSpeed': '总速度',
    'tc.empty': '暂无传输记录',
    'tc.clearFinished': '清除已完成',
    'tc.close': '关闭',
    'tc.cancel': '取消传输',
    'tc.eta': '剩余 {t}',
    'tc.status.active': '传输中',
    'tc.status.done': '已完成',
    'tc.status.error': '失败',
    'tc.status.cancelled': '已取消',

    'up.title': '选择上传目标目录',
    'up.label': '远端路径',
    'up.hint': '未能自动获取当前目录（远端 shell 未上报 CWD）。请输入目标绝对路径，例如 /home/user/logs',
    'up.cancel': '取消',
    'up.ok': '选择文件并上传',

    'notify.notSSH': '请先切换到 SSH 标签页，再使用「上传到当前目录」',
    'notify.notReady': 'SSH 会话尚未就绪',
    'notify.cwdFail': '目录自动检测注入失败：远端 shell 未上报 CWD。可在「设置 → 智能上传」查看手动配置方法，或在标签页右键菜单重试。',
    'notify.badPath': '远端目录不存在或不可访问：{path}',
    'notify.transferDone': '{name} 传输完成',
    'notify.transferError': '{name} 传输失败：{error}',
    'notify.uploadSummaryDone': '上传完成：成功 {ok} 个文件',
    'notify.uploadSummaryError': '上传结束：成功 {ok} 个，失败 {fail} 个（详见传输中心）',
    'notify.dropSummaryDone': '拖拽上传完成：成功 {ok} 个文件',
    'notify.dropSummaryError': '拖拽上传结束：成功 {ok} 个，失败 {fail} 个（详见传输中心）',
    'drop.hint': '松手上传到当前目录',
}

const enUS: Dict = {
    'toolbar.upload': 'Upload to current directory',
    'toolbar.transfers': 'Transfer center',
    'ctx.uploadToCwd': 'Upload to current directory',
    'ctx.transferCenter': 'Open transfer center',
    'ctx.retryCwd': 'Retry CWD detection injection',
    'hotkey.uploadToCwd': 'Smart upload: upload to current directory',
    'hotkey.transferCenter': 'Smart upload: open transfer center',

    'settings.title': 'Smart Upload',
    'settings.injectGroup': 'Automatic directory detection (CWD)',
    'settings.autoInject': 'Auto-inject directory reporting after SSH session starts',
    'settings.autoInjectHint': 'Injects an OSC 1337 hook into the remote shell (bash / zsh; configure fish manually) so the SFTP panel and "Upload to current directory" can locate the current directory. Session-only, does not modify remote config files. If the remote already reports CWD via dotfiles, injection is skipped (zero echo). One command line will be echoed when injecting, which is normal. For tmux ≥3.3, set allow-passthrough on in tmux.conf.',
    'settings.notifyInjectFailure': 'Notify when injection fails',
    'settings.clearFailed': 'Clear failure records',
    'settings.cleared': 'Cleared',
    'settings.snippetsTitle': 'Manual remote shell configuration (when auto injection fails)',
    'settings.snippetsHint': 'Add the matching snippet to the remote shell config file and re-login:',
    'settings.snippetBashZsh': 'bash / zsh (universal, same snippet used by auto-injection; add to ~/.bashrc or ~/.zshrc):',
    'settings.snippetFish': 'fish (auto-injection does not support fish syntax; add to ~/.config/fish/config.fish):',
    'settings.copy': 'Copy',
    'settings.copied': 'Copied to clipboard',
    'settings.tcGroup': 'Transfer center',
    'settings.autoOpen': 'Open transfer center when a transfer starts',
    'settings.notifyDone': 'Notify on transfer completion / failure',
    'settings.reorderBuiltin': 'Also sort Tabby\'s built-in transfer list newest-first',
    'settings.reorderBuiltinHint': 'Tabby\'s built-in transfer dropdown appends new transfers at the bottom. When enabled, the plugin reorders it in place so the newest is on top. Our own Transfer Center is always newest-first regardless of this switch.',
    'settings.upGroup': 'Upload',
    'settings.concurrency': 'Upload concurrency (1-8)',
    'settings.rememberPath': 'Remember upload directory per host',
    'settings.fallbackPath': 'Default path when directory is unknown (must be absolute)',

    'tc.title': 'Transfer Center',
    'tc.active': '{n} active',
    'tc.totalSpeed': 'Total speed',
    'tc.empty': 'No transfers yet',
    'tc.clearFinished': 'Clear finished',
    'tc.close': 'Close',
    'tc.cancel': 'Cancel transfer',
    'tc.eta': 'ETA {t}',
    'tc.status.active': 'Active',
    'tc.status.done': 'Done',
    'tc.status.error': 'Failed',
    'tc.status.cancelled': 'Cancelled',

    'up.title': 'Choose upload target directory',
    'up.label': 'Remote path',
    'up.hint': 'Could not detect the current directory (remote shell does not report CWD). Enter the target absolute path, e.g. /home/user/logs',
    'up.cancel': 'Cancel',
    'up.ok': 'Pick files and upload',

    'notify.notSSH': 'Switch to an SSH tab first to use "Upload to current directory"',
    'notify.notReady': 'SSH session is not ready yet',
    'notify.cwdFail': 'CWD auto-injection failed: the remote shell did not report CWD. See Settings → Smart Upload for manual setup, or retry from the tab context menu.',
    'notify.badPath': 'Remote directory does not exist or is not accessible: {path}',
    'notify.transferDone': '{name} transfer complete',
    'notify.transferError': '{name} transfer failed: {error}',
    'notify.uploadSummaryDone': 'Upload complete: {ok} files succeeded',
    'notify.uploadSummaryError': 'Upload finished: {ok} succeeded, {fail} failed (see Transfer Center)',
    'notify.dropSummaryDone': 'Drop upload complete: {ok} files',
    'notify.dropSummaryError': 'Drop upload finished: {ok} succeeded, {fail} failed (see Transfer Center)',
    'drop.hint': 'Drop to upload to the current directory',
}

@Injectable()
export class I18nService {
    private lang = 'en-US'

    constructor (private config: ConfigService) {
        this.update()
        this.config.changed$.subscribe(() => this.update())
        this.config.ready$.subscribe(() => this.update())
    }

    private update (): void {
        const l: unknown = (this.config.store as any)?.language
        if (typeof l === 'string' && l) {
            this.lang = l
        }
    }

    t (key: string, params?: Record<string, unknown>): string {
        let s = (this.lang.startsWith('zh') ? zhCN : enUS)[key] ?? enUS[key] ?? key
        if (params) {
            for (const k of Object.keys(params)) {
                s = s.split('{' + k + '}').join(String(params[k]))
            }
        }
        return s
    }
}
