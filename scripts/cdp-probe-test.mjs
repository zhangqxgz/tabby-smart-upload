// CDP：重载 → 重连全部 SSH 会话 → 等待 → 探测 CWD → 输出诊断
const base = 'http://127.0.0.1:9223'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find(t => t.type === 'page' && t.url.includes('app.asar'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let nextId = 1
const pending = new Map()
const logs = []
ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    else if (m.method === 'Runtime.consoleAPICalled') {
        const t = m.params.args.map(a => a.value ?? a.description ?? '').join(' ')
        if (/smart-upload|CWD/i.test(t)) logs.push(t.slice(0, 300))
    }
}
const call = (method, params = {}) => new Promise(res => {
    const id = nextId++
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async expr => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.exceptionDetails ? 'EVAL_ERROR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400) : r.result?.result?.value
}
await call('Runtime.enable')
await call('Page.enable')
await call('Page.reload')
await new Promise(r => setTimeout(r, 10000))
console.log('API:', await evalJs(`typeof window.__smartUpload`))
console.log('RECONNECT:', JSON.stringify(await evalJs(`window.__smartUpload.reconnectAll()`)))
await new Promise(r => setTimeout(r, 9000))
console.log('PROBE_ALL:', JSON.stringify(await evalJs(`window.__smartUpload.probeAll()`), null, 1))
await new Promise(r => setTimeout(r, 1500))
console.log('DIAG_TAIL:', JSON.stringify(await evalJs(`(window.__smartUploadDiag||[]).slice(-30)`), null, 1))
console.log('CONSOLE:', JSON.stringify(logs.slice(-20), null, 1))
ws.close()
process.exit(0)
