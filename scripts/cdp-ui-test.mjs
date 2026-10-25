// CDP 深度诊断：点击传输中心按钮后全面检查 DOM / 异常 / 按钮绑定
const base = 'http://127.0.0.1:9223'
const list = await (await fetch(base + '/json/list')).json()
const page = list.find(t => t.type === 'page' && t.url.includes('app.asar'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let nextId = 1
const pending = new Map()
const events = []
ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    else if (m.method === 'Runtime.consoleAPICalled') {
        events.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300))
    } else if (m.method === 'Runtime.exceptionThrown') {
        events.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text ?? '').slice(0, 400))
    }
}
const call = (method, params = {}) => new Promise(res => {
    const id = nextId++
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async expr => {
    const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) return 'EVAL_ERROR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)
    return r.result?.result?.value
}
await call('Runtime.enable')
await evalJs(`window.__errs = []; window.addEventListener('error', e => window.__errs.push(String(e.error && e.error.stack || e.message).slice(0,500))); window.addEventListener('unhandledrejection', e => window.__errs.push('REJECTION: ' + String(e.reason && e.reason.stack || e.reason).slice(0,500))); 'hooks set'`)
const clicked = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')]
    const target = btns.find(b => (b.innerHTML || '').includes('x2=\"3.01\"'))
    if (!target) return 'BUTTON_NOT_FOUND'
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    return 'CLICKED'
})()`)
console.log('CLICK:', clicked)
await new Promise(r => setTimeout(r, 2000))
console.log('DOM:', JSON.stringify(await evalJs(`(() => ({
    suTransferCenter: !!document.querySelector('su-transfer-center'),
    suUploadPath: !!document.querySelector('su-upload-path'),
    ngbModalWindow: document.querySelectorAll('ngb-modal-window').length,
    modalContent: document.querySelectorAll('.modal-content').length,
    bodyTail: document.body.innerHTML.slice(-400),
}))()`), null, 1))
console.log('WINDOW_ERRORS:', JSON.stringify(await evalJs('window.__errs'), null, 1))
console.log('CDP_EVENTS:', JSON.stringify(events.slice(0, 12), null, 1))
ws.close()
process.exit(0)
