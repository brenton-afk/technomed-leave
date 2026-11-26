import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 26 Nov 2026: the DTBV allograft form goes to Ben Reynolds, allograft@,
// DTBV utilisation@ and admin@ only — never with anyone else's usage.
// Invented case.

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
const formOnly = []
vi.mock('./_email.js', () => ({
  sendUsageEmail: vi.fn(async m => { usage.push(m); return {} }),
  sendBoostTrackingEmail: vi.fn(async m => { tracking.push(m); return {} }),
  sendDtbvFormEmail: vi.fn(async m => { formOnly.push(m); return {} })
}))
vi.mock('./_usageExcel.js', () => ({ buildUsageWorkbook: vi.fn(async () => Buffer.from('x')) }))
vi.mock('./_usagePdf.js', () => ({ buildScanPdf: vi.fn(async pages => Buffer.from(`${pages.length} pages`)) }))
vi.mock('./_googleCalendar.js', () => ({ markAttendance: vi.fn() }))
vi.mock('./_anthropic.js', () => ({ streamClaude: vi.fn() }))
const uploads = []
const savedFiles = []
vi.mock('./_dropbox.js', () => ({
  caseFolderPath: vi.fn(() => '/ALL SURGEON USAGE/SPINE/Thani/November 2026/Case'),
  saveUsageFiles: vi.fn(async ({ scanPdf, usageSheet }) => { savedFiles.push(String(scanPdf)); return { saved: ['scan', 'sheet'] } }), dropboxConfigured: () => true, listFolder: vi.fn(), temporaryLink: vi.fn(),
  resourcesRoot: vi.fn(), usageRoot: vi.fn(), patientHistory: vi.fn(), caseFoldersOnDay: vi.fn(async () => []),
  uploadFile: vi.fn(async (path, buf, opts) => { uploads.push({ path, opts }) })
}))
const { default: handler } = await import('./usage/agent.js')
const { splitDtbvReadings, splitFormPages } = await import('./_dtbvPages.js')
const call = (action, body) => new Promise(resolve => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(d) { resolve({ status: this.statusCode, data: d }) } }
  handler({ method: 'POST', query: { action }, body: { redaction: 'v1', ...body }, headers: {} }, res)
})
const p1 = { mediaType: 'image/jpeg', data: 'a'.repeat(40) }
const p2 = { mediaType: 'image/jpeg', data: 'b'.repeat(40) }
const DTBV_TO = ['dtbv.utilization@vifm.org', 'allograft@ktmedical.com.au', 'ben@ktmedical.com.au']
const CASE = {
  id: 'c1', patientSurname: 'Testcase', date: '2026-11-26', surgeonSurname: 'Thani', hospital: 'CLV',
  folderName: 'Testcase_26112026_Thani_ACDF_CLV', createdAt: '2026-11-26T01:00:00Z',
  dropboxPath: '/ALL SURGEON USAGE/SPINE/Thani/November 2026/Testcase_26112026_Thani_ACDF_CLV',
  items: [
    { id: 'i1', referenceCode: 'CBM-1', productName: 'CBM allograft', distributorKey: 'dtbv', quantity: 1 },
    { id: 'i2', referenceCode: 'AB0140-55000', productName: 'Diplomat set screw', distributorKey: 'signus', quantity: 1 }
  ]
}

beforeEach(() => { records.clear(); usage.length = 0; tracking.length = 0; formOnly.length = 0; uploads.length = 0; savedFiles.length = 0 })

describe('one scan with the DTBV allograft form in it', () => {
  it('the DTBV email carries the form and goes to the four addresses only', async () => {
    records.set(CASE.id, { ...CASE, dtbvPages: [1] })
    const { status } = await call('email', { usageId: CASE.id, pages: [p1, p2] })
    expect(status).toBe(200)
    const dtbv = usage.find(m => m.to.includes('dtbv.utilization@vifm.org'))
    expect(dtbv.to).toEqual(DTBV_TO)
    expect(dtbv.cc).toEqual(['admin@technomed.com.au'])
    expect(String(dtbv.scanPdf)).toBe('2 pages')
  })

  it('no other distributor gets the DTBV form', async () => {
    records.set(CASE.id, { ...CASE, dtbvPages: [1] })
    await call('email', { usageId: CASE.id, pages: [p1, p2] })
    const signus = usage.find(m => !m.to.includes('dtbv.utilization@vifm.org'))
    expect(String(signus.scanPdf)).toBe('1 pages')
  })

  it('a form with no DTBV item on the usage still goes, alone, to the same addresses', async () => {
    records.set(CASE.id, { ...CASE, items: [CASE.items[1]], dtbvPages: [1] })
    const { data } = await call('email', { usageId: CASE.id, pages: [p1, p2] })
    expect(formOnly).toHaveLength(1)
    expect(formOnly[0]).toMatchObject({ to: DTBV_TO, cc: ['admin@technomed.com.au'] })
    expect(String(formOnly[0].pdf)).toBe('1 pages')
    expect(data.results.find(r => r.key === 'dtbv').ok).toBe(true)
  })

  it('a test goes to the rep only', async () => {
    records.set(CASE.id, { ...CASE, dtbvPages: [1] })
    await call('email', { usageId: CASE.id, pages: [p1, p2], testOnly: true })
    expect(usage.every(m => m.to.length === 1 && m.to[0] === 'rep@example.test' && m.cc.length === 0)).toBe(true)
  })

  it('is filed on its own beside the usage, and the usage scan leaves it out', async () => {
    const { id, dropboxPath, createdAt, ...fresh } = CASE
    const { status, data } = await call('save', { case: { ...fresh, dtbvPages: [1] }, pages: [p1, p2] })
    expect(status).toBe(200)
    expect(savedFiles).toEqual(['1 pages'])
    expect(uploads[0].path).toMatch(/_DTBV_Allograft_Form\.pdf$/)
    expect(data.record.dtbvPages).toEqual([1])
  })
})

describe('the rules', () => {
  it('a graft on the form is not counted twice when the usage page has its sticker', () => {
    const { readings, dtbvPages } = splitDtbvReadings([
      { items: [{ productName: 'CBM allograft 5cc' }, { productName: 'Diplomat screw' }] },
      { dtbvAllograftPages: [1], items: [{ productName: 'CBM allograft 5cc' }] }
    ])
    expect(dtbvPages).toEqual([1])
    expect(readings[1].items).toEqual([])
    expect(readings[0].items).toHaveLength(2)
  })
  it('the form\'s graft is kept when nothing else names it', () => {
    const { readings } = splitDtbvReadings([{ items: [{ productName: 'Diplomat screw' }] }, { dtbvAllograftPages: [1], items: [{ productName: 'DBM putty' }] }])
    expect(readings[1].items).toHaveLength(1)
  })
  it('Boost is not DTBV', () => {
    const { readings } = splitDtbvReadings([{ items: [{ productName: 'Boost DBM allograft' }] }, { dtbvAllograftPages: [1], items: [{ productName: 'CBM' }] }])
    expect(readings[1].items).toHaveLength(1)
  })
  it('splits the pages three ways', () => {
    expect(splitFormPages(['a', 'b', 'c'], { boostPages: [1], dtbvPages: [2] })).toEqual({ usagePages: ['a'], trackingPages: ['b'], dtbvPages: ['c'] })
  })
})

// Brent, 26 Nov 2026: the form was not recognised and went to every
// distributor. Each page now says what it is, and a page of nothing but DTBV
// grafts in a longer scan is the form anyway.
describe('the DTBV form is recognised', async () => {
  const { splitDtbvReadings } = await import('./_dtbvPages.js')
  const usage = { pageType: 'usage', items: [{ productName: 'Mariner screw' }, { productName: 'Cancellous Bone Matrix CBM' }] }
  it('by the page saying it is the DTBV form', () => {
    const { dtbvPages } = splitDtbvReadings([usage, { pageType: 'dtbv_allograft', items: [] }])
    expect(dtbvPages).toEqual([1])
  })
  it('by a page of nothing but DTBV grafts, its graft not counted twice', () => {
    const { dtbvPages, readings } = splitDtbvReadings([usage, { items: [{ productName: 'Cancellous Bone Matrix', referenceCode: 'CBM-001947-25-27' }] }])
    expect(dtbvPages).toEqual([1])
    expect(readings[1].items).toEqual([])
  })
  it('never the hospital usage page itself', () => {
    expect(splitDtbvReadings([usage]).dtbvPages).toEqual([])
  })
})
