// 通过 CDP 验证插件是否被 Tabby 加载（非破坏性：默认不重载页面，避免断开用户会话）
// 前置：Tabby.exe --remote-debugging-port=9223 启动；Windows 侧 node 运行
// 需要强制重载时：set RELOAD=1 再运行（会断开并重连所有会话，谨慎）
const base = 'http://127.0.0.1:9223'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find(t => t.type === 'page' && t.url.includes('app.asar'))
if (!page) { console.log('NO_PAGE'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let nextId = 1
const pending = new Map()
const consoleMsgs = []
ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    else if (m.method === 'Runtime.consoleAPICalled') {
        consoleMsgs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '))
    } else if (m.method === 'Runtime.exceptionThrown') {
        consoleMsgs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text ?? ''))
    }
}
const call = (method, params = {}) => new Promise(res => {
    const id = nextId++
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async expr => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.exceptionDetails ? 'EVAL_ERROR' : r.result?.result?.value
}
await call('Runtime.enable')
if (process.env.RELOAD === '1') {
    await call('Page.enable')
    await call('Page.reload')
    await new Promise(r => setTimeout(r, 9000))
}
console.log('MODULE_API:', await evalJs(`typeof window.__smartUpload`))
console.log('UPLOAD_ICON_IN_DOM:', await evalJs(`document.body.innerHTML.includes('M21 15v4a2 2')`))
console.log('TRANSFERS_ICON_IN_DOM:', await evalJs(`document.body.innerHTML.includes('x2="3.01"')`))
await new Promise(r => setTimeout(r, 800))
const relevant = consoleMsgs.filter(t => /smart-upload|Could not load/i.test(t))
console.log('RELEVANT_CONSOLE:', JSON.stringify(relevant.slice(0, 12), null, 1))
ws.close()
process.exit(0)
