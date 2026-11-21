import { describe, it, expect, vi } from 'vitest'
import { plannedShoreline, rhhInstrumentLines, runShorelineFix } from './_kitShorelineFix.js'

// Brent, 21 Nov 2026: Shoreline "still has trials separate from instruments,
// but everything has been merged into one instrument tray with a DNO tray as
// back up". Lines here are invented placeholders.
const L = code => ({ code, description: `Item ${code}`, qty: 1, kind: 'instrument' })

describe('planning a Shoreline set', () => {
  it('takes the trials and insertion trays off, adds the instrument tray, keeps a filled plate tray under its new name', () => {
    const current = { trays: [
      { name: 'Shoreline Plate & Screw', photo: '/Tray Lists/Tray Photos/S/p.jpg', lines: [L('P1')] },
      { name: 'Shoreline Trials', photo: '/Tray Lists/Tray Photos/S/wrong.jpg', lines: [L('T1')] },
      { name: 'Shoreline Insertion', lines: [L('I1')] },
      { name: 'Shoreline Sterile Interbodies', lines: [L('C1')] }
    ] }
    const plan = plannedShoreline(current, [
      { name: 'Shoreline Inst 1', lines: [L('A1')] },
      { name: 'Shoreline Plate & Screw 1', lines: [L('X')], keepIfFilled: true, match: /plate/i, photo: 'p5_1.jpg' },
      { name: 'Shoreline Extras 1', lines: [L('E1')] }
    ])
    expect(plan.trays.map(t => t.name)).toEqual(['Shoreline Inst 1', 'Shoreline Plate & Screw 1', 'Shoreline Extras 1', 'Shoreline Sterile Interbodies'])
    expect(plan.trays[1].lines[0].code).toBe('P1')
    expect(plan.trays[1].photo).toBe('/Tray Lists/Tray Photos/S/p.jpg')
    expect(plan.removed.map(t => t.name)).toEqual(['Shoreline Trials', 'Shoreline Insertion'])
    expect(plan.photoNeeded).toEqual([])
  })
  it('one variable drill guide at RHH, not two', () => {
    const lines = rhhInstrumentLines([{ code: '2SEA-86-0020', description: 'Drill Guide, Variable', qty: 2 }, { code: '2SEA-86-0030', description: 'Screwdriver', qty: 2 }])
    expect(lines.map(l => l.qty)).toEqual([1, 2])
  })
})

describe('running the fix', () => {
  it('rewrites both Calvary sets and the RHH set, keeps what it takes off, files the photos', async () => {
    const store = new Map()
    const defs = [
      { id: 'shoreline-clv-1', name: 'Shoreline 1', system: 'Shoreline', home: 'CLV', kind: 'consignment', trays: [] },
      { id: 'shoreline-clv-2', name: 'Shoreline 2', system: 'Shoreline', home: 'CLV', kind: 'consignment', trays: [] },
      { id: 'shoreline-rhh-1', name: 'Shoreline 3', system: 'Shoreline', home: 'RHH', kind: 'consignment', trays: [] },
      { id: 'shoreline-office', name: 'Shoreline (TM loan)', system: 'Shoreline', home: 'office', kind: 'floating', trays: [] }
    ]
    store.set('kits:defs', JSON.stringify(defs))
    store.set('kits:list:shoreline-clv-1', JSON.stringify({ trays: [{ name: 'Shoreline Trials', lines: [L('T')] }, { name: 'Shoreline Plate & Screw', lines: [L('P')] }] }))
    store.set('kits:list:shoreline-rhh-1', JSON.stringify({ trays: [{ name: 'Shoreline 10° Trials', lines: [L('T')] }, { name: 'Shoreline Instruments', lines: [L('OLD')] }] }))
    const redisMod = {
      redis: vi.fn(async (cmd, k, v) => { if (cmd === 'lpush') store.set(k, [...(store.get(k) || []), v]); return 1 }),
      redisSetBody: vi.fn(async (k, v) => { store.set(k, v) })
    }
    const kits = {
      getDefs: async () => JSON.parse(store.get('kits:defs')),
      getTrayList: async id => (store.has(`kits:list:${id}`) ? JSON.parse(store.get(`kits:list:${id}`)) : null),
      addHistory: vi.fn(async () => {})
    }
    const upload = vi.fn(async () => {})
    const data = {
      AGREEMENTS: [
        { doc: 'clv-shoreline', agreement: { name: 'clv.docx' }, trays: [{ name: 'Shoreline Plate & Screw', set: 1, lines: [L('P1')] }, { name: 'Shoreline Plate & Screw', set: 2, lines: [L('P2')] }] },
        { doc: 'rhh-shoreline', agreement: { name: 'rhh.pdf' }, trays: [
          { name: 'Shoreline Plate & Screw', photo: 'p4.jpg', lines: [L('RP')] },
          { name: 'Shoreline Instruments', photo: 'p7.jpg', lines: [{ code: '2SEA-86-0020', description: 'Drill Guide, Variable', qty: 2, kind: 'instrument' }, L('2SEA-86-2206')] },
          { name: 'Shoreline Instruments Extras DNO', photo: 'p9.jpg', lines: [L('D')] }] }
      ],
      PHOTO_LOADERS: {
        'clv-shoreline': async () => ({ PHOTOS: { 'p5_1.jpg': 'eA==' } }),
        'rhh-shoreline': async () => ({ PHOTOS: { 'p4.jpg': 'eA==', 'p7.jpg': 'eA==', 'p9.jpg': 'eA==' } })
      }
    }
    const seed = { SHORELINE_CLV_FILE: 'sheets', SHORELINE_CLV_TRAYS: [
      { name: 'Shoreline Inst 1', lines: [L('I1')] }, { name: 'Shoreline Inst 2', lines: [L('I2')] }, { name: 'Shoreline Extras 1', lines: [L('E')] }] }
    const done = await runShorelineFix({ redisMod, kits, upload, data, seed })

    const names = id => JSON.parse(store.get(`kits:list:${id}`)).trays.map(t => t.name)
    expect(names('shoreline-clv-1')).toEqual(['Shoreline Inst 1', 'Shoreline Plate & Screw 1', 'Shoreline Extras 1'])
    expect(names('shoreline-clv-2')).toEqual(['Shoreline Inst 2', 'Shoreline Plate & Screw 2'])
    expect(names('shoreline-rhh-1')).toEqual(['Shoreline Instruments', 'Shoreline Instruments Extras DNO', 'Shoreline Plate & Screw'])
    const rhhInst = JSON.parse(store.get('kits:list:shoreline-rhh-1')).trays[0]
    expect(rhhInst.lines.find(l => l.code === '2SEA-86-0020').qty).toBe(1)
    expect(rhhInst.photo).toBe('/Tray Lists/Tray Photos/Shoreline 3/Shoreline Instruments.jpg')
    expect(store.get('kits:list:deleted:shoreline-rhh-1')).toHaveLength(1)
    expect(store.get('kits:list:deleted:shoreline-clv-1')).toHaveLength(1)
    expect(JSON.parse(store.get('kits:defs')).find(k => k.id === 'shoreline-clv-2').trays).toEqual(['Shoreline Inst 2', 'Shoreline Plate & Screw 2'])
    // The TM loan set is not touched.
    expect(store.has('kits:list:shoreline-office')).toBe(false)
    expect(done).toHaveLength(3)
    expect(upload).toHaveBeenCalled()
  })
})

describe("Calvary's sheets as read", () => {
  it('carry no prices and match the totals on the sheets', async () => {
    const { SHORELINE_CLV_TRAYS } = await import('./_kitSeedShorelineClv.js')
    expect(JSON.stringify(SHORELINE_CLV_TRAYS)).not.toMatch(/\$|price|AUD/i)
    const total = name => SHORELINE_CLV_TRAYS.find(t => t.name === name).lines.reduce((s, l) => s + l.qty, 0)
    // The sheets' totals less the basket liner and the tray tag.
    expect([total('Shoreline Inst 1'), total('Shoreline Inst 2'), total('Shoreline Extras 1')]).toEqual([41, 40, 6])
  })
})
