import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

export interface SmartUploadConfig {
    /** SSH 会话建立后自动注入 CWD 上报 */
    autoInject: boolean
    /** 注入失败时是否提示 */
    notifyInjectFailure: boolean
    /** 传输开始时自动打开传输中心 */
    autoOpenTransferCenter: boolean
    /** 传输完成/失败时弹出通知 */
    notifyOnComplete: boolean
    /** Tabby 自带传输下拉也按最新在前排序 */
    reorderBuiltinTransfers: boolean
    /** 按主机记忆上传目录 */
    rememberPathPerHost: boolean
    /** 上传并发数 1-8 */
    uploadConcurrency: number
    /** 目录未知时的默认路径（须绝对路径） */
    fallbackPath: string
    /** 主机 → 上次成功使用的上传目录 */
    pathMemory: Record<string, string>
    /** 注入失败过提示过的主机（避免重复打扰） */
    failedHosts: string[]
}

declare module 'tabby-core' {
    export interface Config {
        smartUpload: SmartUploadConfig
    }
}

@Injectable()
export class SmartUploadConfigProvider extends ConfigProvider {
    defaults = {
        hotkeys: {
            'smart-upload-to-cwd': ['Ctrl-Shift-U'],
            'smart-upload-transfers': ['Ctrl-Shift-Y'],
        },
        smartUpload: {
            autoInject: true,
            notifyInjectFailure: true,
            autoOpenTransferCenter: false,
            notifyOnComplete: true,
            reorderBuiltinTransfers: true,
            rememberPathPerHost: true,
            uploadConcurrency: 2,
            fallbackPath: '/',
            pathMemory: {},
            failedHosts: [],
        } as SmartUploadConfig,
    }
}
