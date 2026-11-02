import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Connecting Dropbox, and keeping the usage folders shut until the redaction
// is finished. Made-up tokens only.

const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key, value) => {
    if (cmd === 'get') return store.get(key) ?? null
    if (cmd === 'set') { store.set(key, value); return 'OK' }
    if (cmd === 'del') { store.delete(key); return 1 }
    return null
  })
}))

beforeEach(() => { store.clear(); vi.resetModules() })
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of ['DROPBOX_ACCESS_TOKEN', 'DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_USAGE_READS']) delete process.env[k]
})

describe('the usage folders', () => {
  it('are locked for reading by default — "unless under explicit instruction"', async () => {
    process.env.DROPBOX_ACCESS_TOKEN = 'test-token'
    global.fetch = vi.fn()
    const { listFolder, searchUsage, patientHistory, temporaryLink } = await import('./_dropbox.js')
    await expect(listFolder('/ALL SURGEON USAGE/SPINE')).rejects.toMatchObject({ code: 'locked' })
    await expect(temporaryLink('/ALL SURGEON USAGE/SPINE/x.pdf')).rejects.toMatchObject({ code: 'locked' })
    await expect(searchUsage('Testa')).rejects.toMatchObject({ code: 'locked' })
    await expect(patientHistory('Testa')).rejects.toMatchObject({ code: 'locked' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('leave everything else readable', async () => {
    process.env.DROPBOX_ACCESS_TOKEN = 'test-token'
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ entries: [], has_more: false }) }))
    const { listFolder } = await import('./_dropbox.js')
    await expect(listFolder('/RESOURCES')).resolves.toBeTruthy()
  })
})

describe('staying connected', () => {
  it('mints a fresh access token from the stored refresh token, and uses the team folder as root', async () => {
    process.env.DROPBOX_APP_KEY = 'k'; process.env.DROPBOX_APP_SECRET = 's'
    store.set('dropbox_rt', 'refresh-1'); store.set('dropbox_root', '7838332544')
    const calls = []
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url, init })
      if (String(url).includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 'fresh', expires_in: 14400 }) }
      return { ok: true, status: 200, text: async () => JSON.stringify({ entries: [], has_more: false }) }
    })
    const { listFolder } = await import('./_dropbox.js')
    await listFolder('/Tray Lists')
    const api = calls.find(c => String(c.url).includes('list_folder'))
    expect(api.init.headers.Authorization).toBe('Bearer fresh')
    expect(JSON.parse(api.init.headers['Dropbox-API-Path-Root'])).toEqual({ '.tag': 'namespace_id', namespace_id: '7838332544' })
    expect(store.get('dropbox_at')).toBe('fresh')
  })

  it('says to connect it, rather than failing obscurely, before anybody has', async () => {
    process.env.DROPBOX_APP_KEY = 'k'; process.env.DROPBOX_APP_SECRET = 's'
    global.fetch = vi.fn()
    const { listFolder } = await import('./_dropbox.js')
    await expect(listFolder('/Tray Lists')).rejects.toThrow(/Connect Dropbox/)
  })
})
