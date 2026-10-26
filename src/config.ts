import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

/** 同名文件冲突策略：overwrite=覆盖（与内置一致）/ skip=跳过 / rename=自动改名 */
export type ConflictPolicy = 'overwrite' | 'skip' | 'rename'

export interface SmartUploadConfig {
    /** SSH 会话建立后自动注入 CWD 上报 */
    autoInject: boolean
    /** 通过 SFTP 静默写入远端 shell 配置（连接零回显；失败才回退为终端注入） */
    silentSetup: boolean
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
    /** 同名文件冲突策略 */
    conflictPolicy: ConflictPolicy
    /** 默认下载目录（留空 = ~/Downloads） */
    downloadDir: string
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
            'smart-upload-folder-to-cwd': [],
            'smart-upload-transfers': ['Ctrl-Shift-Y'],
        },
        smartUpload: {
            autoInject: true,
            silentSetup: true,
            notifyInjectFailure: true,
            autoOpenTransferCenter: false,
            notifyOnComplete: true,
            reorderBuiltinTransfers: true,
            rememberPathPerHost: true,
            uploadConcurrency: 2,
            conflictPolicy: 'overwrite' as ConflictPolicy,
            downloadDir: '',
            fallbackPath: '/',
            pathMemory: {},
            failedHosts: [],
        } as SmartUploadConfig,
    }
}
