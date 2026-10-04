import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Pulling a patient's history out of a tree filed by surgeon ─────────────
// Dropbox's search matches anywhere in the path, and the path contains the
// surgeon's name, the month and the hospital as well as the patient's. A
// patient called Gupta would otherwise come back with every case Mr Gupta has
// ever done — which, in a history read before a revision, is worse than
// returning nothing at all.

const calls = []
const reply = body => ({
  ok: true, status: 200, text: async () => JSON.stringify(body)
})

beforeEach(() => {
  vi.resetModules()
  calls.length = 0
  process.env.DROPBOX_ACCESS_TOKEN = 'test-token'
  global.fetch = vi.fn(async (url, init) => {
    const endpoint = String(url).split('/2/')[1]
    calls.push({ endpoint, body: JSON.parse(init.body) })
    if (endpoint === 'files/search_v2') {
      return reply({
        matches: [
          // The patient's own case.
          { metadata: { metadata: { '.tag': 'folder', name: 'Gupta_04102026_Thani_ACDF_RHH', path_display: '/p/Gupta_04102026_Thani_ACDF_RHH' } } },
          // A case belonging to the surgeon of the same name.
          { metadata: { metadata: { '.tag': 'folder', name: 'Hollis_11032024_Gupta_PLIF_Calvary', path_display: '/p/Hollis_11032024_Gupta_PLIF_Calvary' } } }
        ]
      })
    }
    if (endpoint === 'files/list_folder') {
      return reply({ entries: [
        { '.tag': 'file', name: 'scan.pdf', path_lower: '/p/scan.pdf', size: 10, server_modified: null }
      ] })
    }
    return reply({})
  })
})
afterEach(() => { vi.restoreAllMocks(); delete process.env.DROPBOX_ACCESS_TOKEN })

describe('patientHistory', () => {
  it('keeps the patient and drops the surgeon of the same name', async () => {
    const { patientHistory } = await import('./_dropbox.js')
    const { cases } = await patientHistory('Gupta')
    expect(cases.map(c => c.patientSurname)).toEqual(['Gupta'])
    expect(cases[0].surgeonSurname).toBe('Thani')
  })

  it('lists each case\'s files rather than searching for them', async () => {
    // A search returns the folder and both files in it as three matches.
    // Listing the folder is certain where deduplicating matches is guesswork.
    const { patientHistory } = await import('./_dropbox.js')
    const { cases } = await patientHistory('Gupta')
    expect(cases[0].files).toHaveLength(1)
    expect(calls.filter(c => c.endpoint === 'files/list_folder')).toHaveLength(1)
  })

  it('searches inside the usage tree, not the whole account', async () => {
    const { patientHistory } = await import('./_dropbox.js')
    await patientHistory('Gupta')
    const search = calls.find(c => c.endpoint === 'files/search_v2')
    expect(search.body.options.path).toBe('/ALL SURGEON USAGE/SPINE')
  })

  it('does not go to Dropbox at all for one letter', async () => {
    const { patientHistory } = await import('./_dropbox.js')
    expect(await patientHistory('G')).toEqual({ cases: [], query: 'G' })
    expect(calls).toHaveLength(0)
  })

  it('puts the newest case first and the undated ones last', async () => {
    global.fetch = vi.fn(async (url, init) => {
      const endpoint = String(url).split('/2/')[1]
      calls.push({ endpoint, body: JSON.parse(init.body) })
      if (endpoint === 'files/search_v2') {
        return reply({ matches: [
          { metadata: { metadata: { '.tag': 'folder', name: 'Hollis old notes', path_display: '/p/old' } } },
          { metadata: { metadata: { '.tag': 'folder', name: 'Hollis_11032024_Thani_ACDF_RHH', path_display: '/p/a' } } },
          { metadata: { metadata: { '.tag': 'folder', name: 'Hollis_04102026_Garg_PLIF_RHH', path_display: '/p/b' } } }
        ] })
      }
      return reply({ entries: [] })
    })
    const { patientHistory } = await import('./_dropbox.js')
    const { cases } = await patientHistory('Hollis')
    expect(cases.map(c => c.date)).toEqual(['2026-10-04', '2024-03-11', ''])
  })

  it('keeps a case whose folder will not list', async () => {
    // A folder that errors is still a case that happened. Dropping it out of
    // a clinical history to avoid an empty file list is the wrong trade.
    global.fetch = vi.fn(async (url, init) => {
      const endpoint = String(url).split('/2/')[1]
      calls.push({ endpoint, body: JSON.parse(init.body) })
      if (endpoint === 'files/search_v2') {
        return reply({ matches: [
          { metadata: { metadata: { '.tag': 'folder', name: 'Hollis_04102026_Garg_PLIF_RHH', path_display: '/p/b' } } }
        ] })
      }
      return { ok: false, status: 500, text: async () => 'boom' }
    })
    const { patientHistory } = await import('./_dropbox.js')
    const { cases } = await patientHistory('Hollis')
    expect(cases).toHaveLength(1)
    expect(cases[0].files).toEqual([])
  })
})
