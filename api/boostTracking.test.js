import { describe, it, expect, vi, beforeEach } from 'vitest'

// Brent, 9 Nov 2026 (Mulligan): "the boost tracking form to ONLY be sent to the
// boost email (and cc admin@technomed) … The standard usage can go to Device
// for resupply … The tracking email … should say something about tracking
// only." Invented case.

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
// The "PDF" is the page names, so the test can see which pages went where.
vi.mock('./_usagePdf.js', () => ({ buildScanPdf: vi.fn(async pages => Buffer.from(pages.map(p => p.data).join(','))) }))
vi.mock('./_googleCalendar.js', () => ({ markAttendance: vi.fn() }))
vi.mock('./_anthropic.js', () => ({ streamClaude: vi.fn() }))
vi.mock('./_dropbox.js', () => ({
  caseFolderPath: vi.fn(), saveUsageFiles: vi.fn(), dropboxConfigured: () => false, listFolder: vi.fn(), temporaryLink: vi.fn(),
  resourcesRoot: vi.fn(), usageRoot: vi.fn(), patientHistory: vi.fn(), uploadFile: vi.fn(), caseFoldersOnDay: vi.fn(async () => [])
}))

const { default: handler, mergeExtractions } = await import('./usage/agent.js')
const call = body => new Promise(resolve => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(d) { resolve({ status: this.statusCode, data: d }) } }
  handler({ method: 'POST', query: { action: 'email' }, body, headers: {} }, res)
})

const page = name => ({ mediaType: 'image/jpeg', data: Buffer.from(name.padEnd(40, '.')).toString('base64') })
const named = buf => buf.toString().split(',').map(b => Buffer.from(b, 'base64').toString().replace(/\.+$/, ''))
const CASE = {
  id: 'c1', patientSurname: 'Testcase', date: '2026-11-09', surgeonSurname: 'Sample', hospital: 'CLV',
  folderName: 'Sample_09112026_Testcase_ALIF+Boost-UF_CLV', createdAt: '2026-11-09T01:00:00Z',
  boostTrackingPages: [2],
  items: [
    { id: 'i1', referenceCode: 'B-1', productName: 'Boost DBM Allograft', distributorKey: 'device_boost', quantity: 1 },
    { id: 'i2', referenceCode: 'E-1', productName: 'Global BMD ALIF cage', distributorKey: 'e4', quantity: 1 }
  ]
}

beforeEach(() => { records.clear(); usage.length = 0; tracking.length = 0 })

describe('the Boost tracking form', () => {
  it('goes alone to boost@, copied to admin@, and the usage goes to the spine/ortho desk without it', async () => {
    records.set(CASE.id, CASE)
    const { data } = await call({ usageId: CASE.id, pages: [page('usage'), page('tracking')] })
    const boostUsage = usage.find(m => m.distributorLabel === 'Device Technologies Boost Allograft')
    expect(boostUsage.to).toEqual(['dl_spine_marketing@device.com.au', 'ortho@device.com.au'])
    expect(boostUsage.to).not.toContain('boost@device.com.au')
    for (const m of usage) expect(named(m.scanPdf)).toEqual(['usage'])
    expect(tracking).toHaveLength(1)
    expect(tracking[0]).toMatchObject({ to: ['boost@device.com.au'], cc: ['admin@technomed.com.au'] })
    expect(named(tracking[0].pdf)).toEqual(['tracking'])
    expect(data.results.find(r => r.key === 'boost_tracking')).toMatchObject({ ok: true })
    expect(records.get(CASE.id).emailsSent.find(e => e.key === 'boost_tracking').ok).toBe(true)
  })

  it('is said, not guessed, when no page was read as a tracking form', async () => {
    records.set(CASE.id, { ...CASE, boostTrackingPages: [] })
    const { data } = await call({ usageId: CASE.id, pages: [page('usage')] })
    expect(tracking).toHaveLength(0)
    expect(data.results.find(r => r.key === 'boost_tracking')).toMatchObject({ held: true, error: expect.stringMatching(/No Boost tracking form was found/) })
  })

  it('goes once', async () => {
    records.set(CASE.id, CASE)
    await call({ usageId: CASE.id, pages: [page('usage'), page('tracking')] })
    const again = await call({ usageId: CASE.id, only: ['boost_tracking'], pages: [page('usage'), page('tracking')] })
    expect(tracking).toHaveLength(1)
    expect(again.data.results.find(r => r.key === 'boost_tracking')).toMatchObject({ held: true })
  })

  it('a test sends the tracking form to the rep only', async () => {
    records.set(CASE.id, CASE)
    await call({ usageId: CASE.id, testOnly: true, pages: [page('usage'), page('tracking')] })
    expect(tracking[0]).toMatchObject({ to: ['rep@example.test'], cc: [] })
  })
})

describe('reading a scan with a tracking form in it', () => {
  it('knows which page is the form, and counts the graft once', () => {
    const merged = mergeExtractions([
      { patientSurname: 'Testcase', items: [{ referenceCode: 'B-1', lotNumber: 'L9', productName: 'Boost' }] },
      { boostTrackingForm: true, items: [{ referenceCode: 'B 1', lotNumber: 'l9', productName: 'Boost' }, { referenceCode: 'X-2', productName: 'Other graft' }] }
    ])
    expect(merged.boostTrackingPages).toEqual([2])
    expect(merged.items.map(i => i.referenceCode)).toEqual(['B-1', 'X-2'])
  })
})
