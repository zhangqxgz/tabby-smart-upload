/**
 * 诊断埋点：记录到全局数组 + console，便于通过调试协议（CDP）事后查看
 * 用法：diag('tag', data)；读取：window.__smartUploadDiag
 */
const g: any = globalThis
g.__smartUploadDiag = g.__smartUploadDiag ?? []

function safe (v: any): any {
    if (v === undefined || v === null) {
        return v
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        return v
    }
    try {
        return JSON.parse(JSON.stringify(v))
    } catch {
        return String(v)
    }
}

export function diag (tag: string, data?: any): void {
    try {
        const entry = { t: Date.now(), tag, data: safe(data) }
        g.__smartUploadDiag.push(entry)
        if (g.__smartUploadDiag.length > 300) {
            g.__smartUploadDiag.shift()
        }
        // eslint-disable-next-line no-console
        console.log('[smart-upload][diag]', tag, entry.data ?? '')
    } catch {
        // 诊断永不抛错
    }
}
