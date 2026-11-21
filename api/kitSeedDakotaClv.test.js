import { describe, it, expect, vi } from 'vitest'
import { DAKOTA_CLV_TRAYS, plannedDakotaClv, runDakotaClv } from './_kitSeedDakotaClv.js'

// Brent, 21 Nov 2026: "The Dakota tray photos you have are from the loan kits"
// — rebuilt from the E4 stocktake of the Calvary consignment and Calvary CSSD's
// own check sheets. Invented store, no patient detail, no prices.
describe('the Calvary Dakota set as it is on the shelf', () => {
  it('has the trays Calvary packs, with the totals the sheets give', () => {
    expect(DAKOTA_CLV_TRAYS.map(t => t.name)).toEqual(['Dakota Inst', 'Dakota Screws', 'Dakota Cages 14x12 and 16x14', 'Dakota Cages 18x15',
      'Dakota Bed Arm 1', 'Dakota Bed Arm 2', 'Dakota Cervical Retractor (TM ACDF)', 'Dakota Cervical Retractor Ibbett 2'])
    const total = n => DAKOTA_CLV_TRAYS.find(t => t.name === n).lines.reduce((s, l) => s + l.qty, 0)
    expect(total('Dakota Inst')).toBe(34) // CSSD total 35, less the basket liner
    expect(total('Dakota Screws')).toBe(72)
    expect(total('Dakota Cages 14x12 and 16x14')).toBe(24)
    expect(total('Dakota Cages 18x15')).toBe(13)
    expect(total('Dakota Cervical Retractor Ibbett 2')).toBe(19)
    expect(JSON.stringify(DAKOTA_CLV_TRAYS)).not.toMatch(/\$|\bprice\b|\bAUD\b/i)
  })
  it('replaces the old trays, keeps them as deleted, and keeps a repair mark', () => {
    const current = { trays: [
      { name: 'Dakota Instrument 1', lines: [] },
      { name: 'Dakota Inst', lines: [{ code: '71-IN-0010', description: 'Straight awl', qty: 1, kind: 'instrument', repair: { since: '2026-11-01' } }] }
    ] }
    const plan = plannedDakotaClv(current)
    expect(plan.removed.map(t => t.name)).toEqual(['Dakota Instrument 1'])
    expect(plan.trays[0].lines.find(l => l.code === '71-IN-0010').repair).toEqual({ since: '2026-11-01' })
  })
  it('writes the Calvary set only, files a photo per tray one at a time', async () => {
    const store = new Map()
    const defs = [
      { id: 'dakota-clv', name: 'Dakota', system: 'Dakota', home: 'CLV', kind: 'consignment', trays: ['Dakota Instrument 1'] },
      { id: 'dakota-rhh', name: 'Dakota', system: 'Dakota', home: 'RHH', kind: 'consignment', trays: ['X'] },
      { id: 'dakota-loan', name: 'Dakota', system: 'Dakota', home: 'office', kind: 'floating', trays: [] }
    ]
    store.set('kits:defs', JSON.stringify(defs))
    const uploads = []
    const out = await runDakotaClv({
      redisMod: { redis: vi.fn(async () => 1), redisSetBody: async (k, v) => store.set(k, v) },
      kits: { getDefs: async () => JSON.parse(store.get('kits:defs')), getTrayList: async () => ({ trays: [{ name: 'Dakota Instrument 1', lines: [] }] }), addHistory: vi.fn() },
      upload: async path => { uploads.push(path) },
      photos: { PHOTOS: { inst: 'AA==', screws: 'AA==', cages: 'AA==', cages18: 'AA==', bedarm: 'AA==', retractor_ibbett: 'AA==', retractor_tm: 'AA==' } }
    })
    expect(out.kitId).toBe('dakota-clv')
    expect(uploads).toHaveLength(8)
    expect(uploads[0]).toBe('/Tray Lists/Tray Photos/Dakota Calvary/Dakota Inst.jpg')
    const list = JSON.parse(store.get('kits:list:dakota-clv'))
    expect(list.trays.every(t => t.photo)).toBe(true)
    expect(store.has('kits:list:dakota-rhh')).toBe(false)
    expect(JSON.parse(store.get('kits:defs')).find(k => k.id === 'dakota-clv').trays).toHaveLength(8)
  })
})
