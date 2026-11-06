import { describe, it, expect, vi, beforeEach } from 'vitest'

// A usage goes to each distributor once (review, 6 Nov 2026). A re-save from a
// phone holding an older copy used to wipe the record of what had been sent,
// and the next Send went to everybody again — the double-up Device cannot tell
// from a second usage. Invented case only.

const records = new Map()
const claims = new Set()
vi.mock('./_redis.js', () => ({
  getUsageRecord: vi.fn(async id => (records.has(id) ? structuredClone(records.get(id)) : null)),
  saveUsageRecord: vi.fn(async r => { records.set(r.id, structuredClone(r)) }),
  getUsageHistory: vi.fn(async () => [...records.values()].filter(r => !r.removed)),
  claimUsageSend: vi.fn(async (id, key) => { const k = `${id}:${key}`; if (claims.has(k)) return false; claims.add(k); return true }),
  releaseUsageSend: vi.fn(async (id, key) => { claims.delete(`${id}:${key}`) }),
  setUsageReviewed: vi.fn(), getUsageReviews: vi.fn(), claimResupply: vi.fn(), saveResupply: vi.fn(),
  getResupply: vi.fn(), getCaseResupplies: vi.fn(), removeUsageRecord: vi.fn()
}))
vi.mock('./_auth.js', () => ({ requireSession: vi.fn(async () => ({ email: 'rep@example.test', name: 'Rep Example' })) }))
const sends = []
vi.mock('./_email.js', () => ({ sendUsageEmail: vi.fn(async m => { sends.push(m.distributorLabel); return { from: 'rep@example.test' } }) }))
vi.mock('./_usageExcel.js', () => ({ buildUsageWorkbook: vi.fn(async () => Buffer.from('x')) }))
vi.mock('./_usagePdf.js', () => ({ buildScanPdf: vi.fn(async () => Buffer.from('p')) }))
vi.mock('./_googleCalendar.js', () => ({ markAttendance: vi.fn(async () => ({ updated: false })) }))
vi.mock('./_anthropic.js', () => ({ streamClaude: vi.fn() }))
vi.mock('./_dropbox.js', () => ({
  caseFolderPath: vi.fn(() => '/x'), saveUsageFiles: vi.fn(async () => ({ saved: [] })), dropboxConfigured: () => false,
  listFolder: vi.fn(), temporaryLink: vi.fn(), resourcesRoot: vi.fn(), usageRoot: vi.fn(), patientHistory: vi.fn(),
  uploadFile: vi.fn(), caseFoldersOnDay: vi.fn(async () => [])
}))

const { default: handler } = await import('./usage/agent.js')

function call(action, body) {
  return new Promise(resolve => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(d) { resolve({ status: this.statusCode, data: d }) } }
    handler({ method: 'POST', query: { action }, body, headers: {} }, res)
  })
}

const CASE = {
  id: 'case-1', patientSurname: 'Testcase', date: '2026-11-06', surgeonSurname: 'Sample', hospital: 'CLV',
  folderName: 'Testcase_06112026_Sample_PLIF_CLV', createdAt: '2026-11-06T01:00:00Z', createdByEmail: 'rep@example.test',
  items: [{ id: 'i1', referenceCode: 'AB-1', productName: 'Boost allograft', distributorKey: 'device_boost', quantity: 1 }]
}

beforeEach(() => { records.clear(); claims.clear(); sends.length = 0 })

describe('sending a usage', () => {
  it('goes to a distributor once; a second Send is held', async () => {
    records.set(CASE.id, CASE)
    const first = await call('email', { usageId: CASE.id })
    expect(first.data.results[0].ok).toBe(true)
    const again = await call('email', { usageId: CASE.id })
    expect(again.data.results[0]).toMatchObject({ ok: false, held: true })
    expect(sends).toHaveLength(1)
    // …and holding it does not erase the record that it went.
    expect(records.get(CASE.id).emailsSent[0].ok).toBe(true)
  })

  it('goes again only when the rep says so', async () => {
    records.set(CASE.id, CASE)
    await call('email', { usageId: CASE.id })
    await call('email', { usageId: CASE.id, confirmRepeat: true })
    expect(sends).toHaveLength(2)
  })

  it('is not sent twice by a double tap', async () => {
    records.set(CASE.id, CASE)
    const [a, b] = await Promise.all([call('email', { usageId: CASE.id }), call('email', { usageId: CASE.id })])
    expect(sends).toHaveLength(1)
    expect([a, b].flatMap(r => r.data.results).filter(r => r.held)).toHaveLength(1)
  })

  it('a re-save from a phone with an old copy keeps the record of what was sent', async () => {
    records.set(CASE.id, CASE)
    await call('email', { usageId: CASE.id })
    const stale = { ...CASE, emailsSent: [], createdAt: '2030-01-01T00:00:00Z', createdByEmail: 'someone@example.test', folderName: 'Renamed_06112026_Sample_PLIF_CLV' }
    const saved = await call('save', { case: stale, pages: [{ mediaType: 'image/jpeg', data: 'A'.repeat(40) }] })
    expect(saved.status).toBe(200)
    const kept = records.get(CASE.id)
    expect(kept.emailsSent.filter(e => e.ok)).toHaveLength(1)
    expect(kept.createdAt).toBe(CASE.createdAt)
    expect(kept.createdByEmail).toBe(CASE.createdByEmail)
    // The distributor's email was titled with the old name; the case keeps it.
    expect(kept.folderName).toBe(CASE.folderName)
    await call('email', { usageId: CASE.id })
    expect(sends).toHaveLength(1)
  })

  it('a scan removed as a duplicate is neither saved nor sent again', async () => {
    records.set(CASE.id, { ...CASE, removed: { by: 'Admin', at: '2026-11-06' } })
    expect((await call('email', { usageId: CASE.id })).status).toBe(410)
    expect((await call('save', { case: CASE, pages: [{ mediaType: 'image/jpeg', data: 'A'.repeat(40) }] })).status).toBe(410)
    expect(sends).toHaveLength(0)
  })
})
