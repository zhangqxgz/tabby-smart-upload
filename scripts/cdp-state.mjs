// 只读探针：查看 Tabby 当前标签页/连接状态线索（不重载、不断开）
const base = 'http://127.0.0.1:9223'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find(t => t.type === 'page' && t.url.includes('app.asar'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let nextId = 1
const pending = new Map()
ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const call = (method, params = {}) => new Promise(res => {
    const id = nextId++
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async expr => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.exceptionDetails ? 'ERR:' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : r.result?.result?.value
}
console.log('TAB_TEXT:', JSON.stringify(await evalJs(`[...document.querySelectorAll('.tab-bar .tab, .tab-body')].map(e => (e.className + ' :: ' + (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 80)))`), null, 1))
console.log('OVERLAY:', JSON.stringify(await evalJs(`(() => { const t = document.body.innerText || ''; return { disconnected: /Disconnected|Reconnect|disconnected/i.test(t), text: t.replace(/\\s+/g, ' ').slice(0, 300) } })()`), null, 1))
console.log('DIAG_COUNT:', await evalJs(`(window.__smartUploadDiag || []).length`))
ws.close()
process.exit(0)
