// The back button's one race that jsdom cannot see (Brent, 20 Nov 2026: Move
// in a kit "nothing happens"). In a real browser `history.back()` is queued
// and a `pushState` made before it runs does not cancel it — so a layer that
// closed by its ✕ and a layer that opened in the same tap ended with the new
// one popped and closed. jsdom cancels the queued traversal on pushState, so
// the vitest suite passed while the phone failed. This runs src/backButton.js
// in Chromium and fails (exit 1) on any scenario that goes wrong.
//
//   node scripts/back-button-race.mjs        (npm run check:back)

import http from 'node:http'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

// Playwright is installed with the machine's Chromium, not as a dependency;
// require() finds it where an ES import would not.
const { chromium } = createRequire(import.meta.url)('playwright')

const entry = `
import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { startBackButton, pushPage, useBackLayer } from './src/backButton.js'

function Layer({ name, onClose }) {
  useBackLayer(true, onClose)
  return React.createElement('div', { 'data-layer': name }, name)
}

let api = {}
function App() {
  const [a, setA] = useState(false)
  const [b, setB] = useState(false)
  api = { setA, setB }
  return React.createElement('div', null,
    a && React.createElement(Layer, { name: 'A', onClose: () => setA(false) }),
    b && React.createElement(Layer, { name: 'B', onClose: () => setB(false) }))
}

startBackButton({ tab: 'kit', sub: null }, p => { window.pages.push(p) })
window.pages = []
pushPage({ tab: 'kit', sub: 'kitroom' })
const root = createRoot(document.getElementById('root'))
flushSync(() => root.render(React.createElement(App)))
window.t = {
  open: n => flushSync(() => api['set' + n](true)),
  close: n => flushSync(() => api['set' + n](false)),
  // One tap: close A, open B — one React commit.
  swap: () => flushSync(() => { api.setA(false); api.setB(true) }),
  // Close A now, open B a moment later (an await in between).
  swapLater: ms => { flushSync(() => api.setA(false)); setTimeout(() => flushSync(() => api.setB(true)), ms) },
  go: nav => pushPage(nav),
  shown: () => [...document.querySelectorAll('[data-layer]')].map(e => e.dataset.layer).join(''),
  seq: () => history.state && history.state.tmSeq,
  layer: () => !!(history.state && history.state.tmLayer),
}
`

const out = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' },
  bundle: true, format: 'iife', write: false, logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const js = out.outputFiles[0].text
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/app.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(js) }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch()
const failures = []
const wait = (page, ms = 150) => page.waitForTimeout(ms)

async function scenario(name, fn) {
  const page = await browser.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.t)
  try {
    await fn(page)
    console.log(`  ok   ${name}`)
  } catch (e) {
    failures.push(name)
    console.log(`  FAIL ${name}\n       ${e.message}`)
  } finally {
    await page.close()
  }
}
const expectEq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
}

await scenario('closing A and opening B in one tap leaves B open', async page => {
  await page.evaluate(() => t.open('A'))
  await page.evaluate(() => t.swap())
  await wait(page)
  expectEq(await page.evaluate(() => t.shown()), 'B', 'layers shown')
  expectEq(await page.evaluate(() => t.layer()), true, 'top entry is a layer')
})

await scenario('then back closes B, and back again leaves the kit room', async page => {
  await page.evaluate(() => t.open('A'))
  await page.evaluate(() => t.swap())
  await wait(page)
  await page.goBack({ waitUntil: 'commit' }).catch(() => {})
  await wait(page)
  expectEq(await page.evaluate(() => t.shown()), '', 'layers shown after back')
  expectEq(await page.evaluate(() => window.pages.length), 0, 'page changes after first back')
  await page.evaluate(() => history.back())
  await wait(page)
  expectEq(await page.evaluate(() => JSON.stringify(window.pages.at(-1))), '{"tab":"kit","sub":null}', 'page after second back')
})

await scenario('closing B by its ✕ after the swap takes its step off', async page => {
  const before = await page.evaluate(() => t.seq())
  await page.evaluate(() => t.open('A'))
  await page.evaluate(() => t.swap())
  await wait(page)
  await page.evaluate(() => t.close('B'))
  await wait(page)
  expectEq(await page.evaluate(() => t.seq()), before, 'entry after closing B')
  expectEq(await page.evaluate(() => t.layer()), false, 'top entry is a layer')
})

for (const ms of [0, 1, 5]) {
  await scenario(`closing A, then opening B ${ms}ms later (while the back may be on its way)`, async page => {
    await page.evaluate(() => t.open('A'))
    await page.evaluate(ms => t.swapLater(ms), ms)
    await wait(page, 300)
    expectEq(await page.evaluate(() => t.shown()), 'B', 'layers shown')
    await page.evaluate(() => history.back())
    await wait(page)
    expectEq(await page.evaluate(() => t.shown()), '', 'layers shown after back')
    expectEq(await page.evaluate(() => window.pages.length), 0, 'page changes after back')
  })
}

await scenario('closing A, then going to another page straight after', async page => {
  await page.evaluate(() => t.open('A'))
  await page.evaluate(() => { t.close('A'); setTimeout(() => t.go({ tab: 'me', sub: null }), 0) })
  await wait(page, 300)
  expectEq(await page.evaluate(() => JSON.stringify(window.pages)), '[]', 'pages set by back')
  expectEq(await page.evaluate(() => history.state.tmNav.tab), 'me', 'step on top')
  await page.evaluate(() => history.back())
  await wait(page)
  expectEq(await page.evaluate(() => JSON.stringify(window.pages.at(-1))), '{"tab":"kit","sub":"kitroom"}', 'page after back')
})

await scenario('a plain ✕ still takes its step off', async page => {
  const before = await page.evaluate(() => t.seq())
  await page.evaluate(() => t.open('A'))
  await page.evaluate(() => t.close('A'))
  await wait(page)
  expectEq(await page.evaluate(() => t.seq()), before, 'entry after ✕')
})

await scenario('back closes a layer, then leaves the page', async page => {
  await page.evaluate(() => t.open('A'))
  await page.evaluate(() => history.back())
  await wait(page)
  expectEq(await page.evaluate(() => t.shown()), '', 'layers shown')
  await page.evaluate(() => history.back())
  await wait(page)
  expectEq(await page.evaluate(() => JSON.stringify(window.pages.at(-1))), '{"tab":"kit","sub":null}', 'page')
})

await browser.close()
server.close()
if (failures.length) {
  console.log(`\n${failures.length} failed`)
  process.exit(1)
}
console.log('\nall passed')
