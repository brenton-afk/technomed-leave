import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 9 Nov 2026: "We will scan the boost form separately …
// That form can then go to Boost email. And the standard usage goes to device
// just for boost resupply." Invented case.

const records = new Map()
vi.mock('./_redis.js', () => ({
  getUsageRecord: vi.fn(async id => (records.has(id) ? structuredClone(records.get(id)) : null)),
  saveUsageRecord: vi.fn(async r => { records.set(r.id, structuredClone(r)) }),
  getUsageHistory: vi.fn(async () => []),
  claimUsageSend: vi.fn(async () => true), releaseUsageSend: vi.fn(async () => {}),
  setUsageReviewed: vi.fn(), getUsageReviews: vi.fn(), claimResupply: vi.fn(), saveResupply: vi.fn(),
  getResupply: vi.fn(), getCaseResupplies: vi.fn(), removeUsageRecord: vi.fn()
}))
vi.mock('./_auth.js', () => ({ requireSession: vi.fn(async () => ({ email: 'rep@example.test', name: 'Rep Example' })), requireAdmin: vi.fn() }))
const usage = []
const tracking = []
vi.mock('./_email.js', () => ({
  sendUsageEmail: vi.fn(async m => { usage.push(m); return {} }),
  sendBoostTrackingEmail: vi.fn(async m => { tracking.push(m); return {} })
}))
vi.mock('./_usageExcel.js', () => ({ buildUsageWorkbook: vi.fn(async () => Buffer.from('x')) }))
vi.mock('./_usagePdf.js', () => ({ buildScanPdf: vi.fn(async pages => Buffer.from(`${pages.length} pages`)) }))
vi.mock('./_googleCalendar.js', () => ({ markAttendance: vi.fn() }))
vi.mock('./_anthropic.js', () => ({ streamClaude: vi.fn() }))
const uploads = []
vi.mock('./_dropbox.js', () => ({
  caseFolderPath: vi.fn(), saveUsageFiles: vi.fn(), dropboxConfigured: () => true, listFolder: vi.fn(), temporaryLink: vi.fn(),
  resourcesRoot: vi.fn(), usageRoot: vi.fn(), patientHistory: vi.fn(), caseFoldersOnDay: vi.fn(async () => []),
  uploadFile: vi.fn(async (path, buf, opts) => { uploads.push({ path, opts }) })
}))

const { default: handler } = await import('./usage/agent.js')
const call = (action, body) => new Promise(resolve => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(d) { resolve({ status: this.statusCode, data: d }) } }
  handler({ method: 'POST', query: { action }, body, headers: {} }, res)
})
const page = { mediaType: 'image/jpeg', data: 'x'.repeat(40) }
const CASE = {
  id: 'c1', patientSurname: 'Testcase', date: '2026-11-09', surgeonSurname: 'Thani', hospital: 'CLV',
  folderName: 'Testcase_09112026_Thani_ALIF+Boost-UF_CLV', createdAt: '2026-11-09T01:00:00Z',
  dropboxPath: '/ALL SURGEON USAGE/SPINE/Thani/November 2026/Testcase_09112026_Thani_ALIF+Boost-UF_CLV',
  items: [{ id: 'i1', referenceCode: 'B-1', productName: 'Boost DBM Allograft', distributorKey: 'device_boost', quantity: 1 }]
}

beforeEach(() => { records.clear(); usage.length = 0; tracking.length = 0; uploads.length = 0 })

describe('the Boost usage', () => {
  it('goes to Device\'s spine/ortho desk for resupply — not to boost@', async () => {
    records.set(CASE.id, CASE)
    await call('email', { usageId: CASE.id, pages: [page] })
    expect(usage).toHaveLength(1)
    expect(usage[0].to).toEqual(['dl_spine_marketing@device.com.au', 'ortho@device.com.au'])
    expect(tracking).toHaveLength(0)
  })
})

describe('the Boost tracking form, scanned on its own', () => {
  it('goes to boost@ only, copied to admin@, and is filed beside the usage', async () => {
    records.set(CASE.id, CASE)
    const { status, data } = await call('boost-form', { usageId: CASE.id, pages: [page] })
    expect(status).toBe(200)
    expect(tracking[0]).toMatchObject({ to: ['boost@device.com.au'], cc: ['admin@technomed.com.au'] })
    expect(tracking[0].pdfFilename).toMatch(/_Boost_Tracking_Form\.pdf$/)
    expect(uploads[0]).toMatchObject({ path: `${CASE.dropboxPath}/${CASE.folderName}_Boost_Tracking_Form.pdf`, opts: { keep: true } })
    expect(data).toMatchObject({ ok: true, filed: `${CASE.folderName}_Boost_Tracking_Form.pdf` })
    expect(records.get(CASE.id).emailsSent).toEqual([expect.objectContaining({ key: 'boost_tracking', ok: true })])
  })

  it('goes once, unless the rep says send again', async () => {
    records.set(CASE.id, CASE)
    await call('boost-form', { usageId: CASE.id, pages: [page] })
    const again = await call('boost-form', { usageId: CASE.id, pages: [page] })
    expect(again.status).toBe(409)
    expect(tracking).toHaveLength(1)
    await call('boost-form', { usageId: CASE.id, pages: [page], confirmRepeat: true })
    expect(tracking).toHaveLength(2)
  })

  it('a test goes to the rep only and is not recorded or filed', async () => {
    records.set(CASE.id, CASE)
    await call('boost-form', { usageId: CASE.id, pages: [page], testOnly: true })
    expect(tracking[0]).toMatchObject({ to: ['rep@example.test'], cc: [] })
    expect(uploads).toHaveLength(0)
    expect(records.get(CASE.id).emailsSent).toBeUndefined()
  })

  it('needs pages', async () => {
    records.set(CASE.id, CASE)
    expect((await call('boost-form', { usageId: CASE.id, pages: [] })).status).toBe(400)
  })
})
