// 通过 CDP 验证插件是否被 Tabby 加载（需先用 --remote-debugging-port=9223 启动 Tabby，Windows 侧 node 运行）
const base = 'http://127.0.0.1:9223'
const list = await (await fetch(base + '/json/list')).json()
const pages = list.filter(t => t.type === 'page' && t.url.includes('app.asar'))
if (!pages.length) { console.log('NO_PAGE'); process.exit(1) }

for (const page of pages) {
    console.log('== PAGE', page.url)
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
    await call('Runtime.enable')
    await call('Page.enable')
    await call('Page.reload', { ignoreCache: false })
    await new Promise(r => setTimeout(r, 9000))

    const r1 = await call('Runtime.evaluate', { expression: "document.body.innerHTML.includes('M21 15v4a2 2')", returnByValue: true })
    const r2 = await call('Runtime.evaluate', { expression: "document.body.innerHTML.includes('17 8 12 3 7 8')", returnByValue: true })
    console.log('UPLOAD_ICON_IN_DOM:', r1.result?.result?.value)
    console.log('TRANSFERS_ICON_IN_DOM:', r2.result?.result?.value)
    const relevant = consoleMsgs.filter(t => /smart-upload|Could not load/i.test(t))
    console.log('RELEVANT_CONSOLE:', JSON.stringify(relevant.slice(0, 20), null, 1))
    const errors = consoleMsgs.filter(t => /EXCEPTION|error:/i.test(t))
    console.log('ERRORS:', JSON.stringify(errors.slice(0, 10), null, 1))
    ws.close()
}
process.exit(0)
