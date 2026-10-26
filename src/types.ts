/**
 * 公共结构化类型与工具（放独立文件避免 service 间循环依赖 → 打包 TDZ 坑）
 */
import { SFTPSession } from 'tabby-ssh'

/** 结构化的 shell 会话能力声明（不依赖 tabby-ssh 未导出的 SSHShellSession 类型） */
export interface ShellSessionLike {
    getWorkingDirectory?: () => Promise<string | null>
    feedFromTerminal (data: Buffer): void
}

/** 结构化的 SSH 标签页能力声明 */
export interface SSHTabLike {
    title?: string
    profile?: any
    session?: ShellSessionLike | null
    sshSession?: { openSFTP (): Promise<SFTPSession> } | null
}

/** 鸭式判断：SSH 标签页一定有 sshSession 属性 */
export function asSSHTab (tab: any): SSHTabLike | null {
    if (tab && typeof tab === 'object' && 'sshSession' in tab) {
        return tab as SSHTabLike
    }
    return null
}

/**
 * 从 activeTab 解析出真正的终端标签页：
 * 分屏（SplitTabComponent）时 activeTab 是外壳，需要取当前聚焦的子标签页。
 */
export function resolveFocusedTab (tab: any): any {
    if (!tab || typeof tab !== 'object') {
        return null
    }
    if (typeof tab.getFocusedTab === 'function') {
        return tab.getFocusedTab() ?? null
    }
    return tab
}

/** 主机键：user@host:port（用于按主机记忆/失败记录） */
export function hostKeyOf (tab: SSHTabLike): string {
    const o: any = tab.profile?.options ?? {}
    if (o.host) {
        return `${o.user ?? ''}@${o.host}:${o.port ?? 22}`
    }
    return tab.title ?? 'unknown'
}
