import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'

// ─── Task 7: the service worker opens the app on a weak signal ──────────────
// The real public/sw.js, run in a fake worker scope. Three things are checked
// harder than the rest, because each is a way this goes wrong for good:
//   · online, the page always comes from the network (no pinned old build);
//   · nothing under /api/ is ever intercepted (no patient data cached);
//   · only content-hashed files are served cache-first.

const SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')

class FakeCache {
  constructor() { this.map = new Map() }
  key(r) { return typeof r === 'string' ? r : new URL(r.url).pathname }
  async match(r) { return this.map.get(this.key(r))?.clone() }
  async put(r, res) { this.map.set(this.key(r), res) }
  async keys() { return [...this.map.keys()].map(k => ({ url: `https://leave.test${k}` })) }
  async delete(r) { return this.map.delete(this.key(r)) }
}

let listeners, stores, network

function boot() {
  listeners = {}
  stores = new Map()
  const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name, new FakeCache()); return stores.get(name) },
    async keys() { return [...stores.keys()] },
    async delete(name) { return stores.delete(name) }
  }
  const self = {
    location: { origin: 'https://leave.test' },
    addEventListener: (type, fn) => { listeners[type] = fn },
    skipWaiting: () => {}, clients: { claim: async () => {} }, registration: {}
  }
  vm.runInNewContext(SOURCE, {
    self, caches, fetch: (...a) => network(...a), Response, URL, Promise,
    setTimeout: (...a) => globalThis.setTimeout(...a), clearTimeout: (...a) => globalThis.clearTimeout(...a)
  })
}

/** Dispatches a fetch; returns the response the worker gave, or null if it let it through. */
async function request(path, { mode = 'no-cors', method = 'GET' } = {}) {
  let answer = null
  listeners.fetch({
    request: { url: `https://leave.test${path}`, mode, method },
    respondWith: p => { answer = p }
  })
  return answer ? await answer : null
}

const html = body => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } })

beforeEach(() => boot())
afterEach(() => vi.useRealTimers())

describe('the page', () => {
  it('comes from the network when there is one, every time', async () => {
    network = async () => html('build-2')
    stores.set('tm-shell-v1', new FakeCache())
    await stores.get('tm-shell-v1').put('/', html('build-1'))
    const res = await request('/', { mode: 'navigate' })
    expect(await res.text()).toBe('build-2')
  })

  it('opens from the saved copy when the network fails', async () => {
    network = async () => html('build-1')
    await request('/', { mode: 'navigate' })
    network = async () => { throw new TypeError('offline') }
    const res = await request('/cases', { mode: 'navigate' })
    expect(await res.text()).toBe('build-1')
  })

  it('opens from the saved copy when the network stalls', async () => {
    network = async () => html('build-1')
    await request('/', { mode: 'navigate' })
    vi.useFakeTimers()
    network = () => new Promise(() => {}) // one bar of signal: no answer, no error
    const pending = request('/', { mode: 'navigate' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(await (await pending).text()).toBe('build-1')
  })

  it('says "No signal" with a retry, rather than a blank screen, before anything is saved', async () => {
    network = async () => { throw new TypeError('offline') }
    const res = await request('/', { mode: 'navigate' })
    expect(res.status).toBe(503)
    expect(await res.text()).toMatch(/No signal[\s\S]*Try again/)
  })

  it('never saves an error page as the app', async () => {
    network = async () => new Response('down', { status: 500, headers: { 'Content-Type': 'text/html' } })
    await request('/', { mode: 'navigate' })
    expect(await stores.get('tm-shell-v1').match('/')).toBeUndefined()
  })
})

describe('what it will not touch', () => {
  it('lets every /api/ request through untouched', async () => {
    network = vi.fn(async () => new Response('{}'))
    expect(await request('/api/calendar/today?action=week')).toBeNull()
    expect(await request('/api/calendar/today?action=booking&id=x', { mode: 'navigate' })).toBeNull()
  })

  it('ignores anything that is not a GET', async () => {
    expect(await request('/assets/index-abc.js', { method: 'POST' })).toBeNull()
  })

  it('leaves the scanner engine to the HTTP cache', async () => {
    expect(await request('/vendor/opencv-4.13.0.js')).toBeNull()
  })
})

describe('built files', () => {
  it('serves a content-hashed file from the cache once it has one', async () => {
    network = vi.fn(async () => new Response('code'))
    await request('/assets/index-abc.js')
    network = async () => { throw new TypeError('offline') }
    expect(await (await request('/assets/index-abc.js')).text()).toBe('code')
  })

  it('fetches the manifest fresh when online, even with a saved copy', async () => {
    network = async () => new Response('v1')
    await request('/manifest.json')
    network = async () => new Response('v2')
    expect(await (await request('/manifest.json')).text()).toBe('v2')
  })
})
