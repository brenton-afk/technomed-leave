import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Errors must not carry the patient ───────────────────────────────────────
// Every path in the usage tree has a surname in it:
//   /ALL SURGEON USAGE/SPINE/THANI/OCTOBER 2026/BARR_04102026_Thani_ACDF_RHH
//
// These messages do not stay in the function. agent.js logs err.message to
// Vercel, which retains it and shows it to anyone with dashboard access, and
// returns the same string to the browser. A message built around the path
// would put surnames into an operations log on Dropbox's first bad afternoon.
//
// The standing rule for this app is that no patient data goes into a log or an
// error. This is the check for it, because the leak is invisible until the day
// something fails — and by then it has already been written down.

const source = readFileSync(join(__dirname, '_dropbox.js'), 'utf8')

describe('Dropbox errors name the fault, not the patient', () => {
  const throws = [...source.matchAll(/throw (?:new Error\(|dropboxFault\()([^\n]*)/g)]
    .map(m => m[1])

  it('has throw sites to check', () => {
    expect(throws.length).toBeGreaterThan(4)
  })

  it('never interpolates a path, a name or a query into a message', () => {
    // The five that did: create, upload, list, open and search.
    const leaky = throws.filter(line =>
      /\$\{[^}]*\b(path|name|query|folderName|current|surname)\b/i.test(line))
    expect(leaky, 'these would write a surname into Vercel logs').toEqual([])
  })

  it('does not fall back to the raw response body either', () => {
    // Dropbox's error_summary is a tag — "path/not_found/." — and carries
    // nothing of ours. The raw body is whatever came back, so it is not used.
    const raw = throws.filter(line => /\$\{[^}]*\btext\b/.test(line))
    expect(raw).toEqual([])
  })
})

describe('what a failure actually says', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.DROPBOX_ACCESS_TOKEN = 'test-token'
  })
  afterEach(() => { vi.restoreAllMocks(); delete process.env.DROPBOX_ACCESS_TOKEN })

  it('keeps the surname out of a failed search', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 503, text: async () => JSON.stringify({ error_summary: 'too_many_requests/..' })
    }))
    const { searchUsage } = await import('./_dropbox.js')
    const err = await searchUsage('Bayly').catch(e => e)
    expect(err.message).not.toContain('Bayly')
    // Still diagnosable: the operation, the status, and Dropbox's own tag.
    expect(err.message).toContain('503')
    expect(err.message).toContain('too_many_requests')
  })

  it('keeps the whole path out of a failed listing', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 401, text: async () => JSON.stringify({ error_summary: 'invalid_access_token/' })
    }))
    const { listFolder } = await import('./_dropbox.js')
    const path = '/ALL SURGEON USAGE/SPINE/THANI/OCTOBER 2026/BAYLY_09102026_Thani_ACDF_RHH'
    const err = await listFolder(path).catch(e => e)
    expect(err.message).not.toMatch(/BAYLY/i)
    expect(err.message).not.toContain('THANI')
    expect(err.message).toContain('invalid_access_token')
  })

  it('keeps the filename out of a failed upload', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 507, text: async () => JSON.stringify({ error_summary: 'insufficient_space/..' })
    }))
    const { uploadFile } = await import('./_dropbox.js')
    const err = await uploadFile('/x/BAYLY_09102026_Thani_ACDF_RHH_Scan.pdf', Buffer.from('a'))
      .catch(e => e)
    expect(err.message).not.toMatch(/BAYLY/i)
    expect(err.message).toContain('507')
  })
})
