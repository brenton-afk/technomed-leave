import { describe, it, expect } from 'vitest'
import { searchPortal, queryWords } from './_portalSearch.js'

// The portal-wide half of the search glass. Invented records only.

const usage = [
  { id: 'u1', folderName: 'Testa_01112026_Sample_PLIF_CLV', patientSurname: 'Testa', surgeonSurname: 'Sample', date: '2026-11-01',
    items: [{ productName: 'Boost allograft 5cc', referenceCode: 'BST-0505', lotNumber: 'LOT77881' }, { productName: 'Interbody cage', referenceCode: 'ZZ-9' }] },
  { id: 'u2', folderName: 'Dummy_02112026_Other_ACDF_RHH', patientSurname: 'Dummy', date: '2026-11-02', removed: { by: 'x' }, items: [] }
]
const kits = [
  { id: 'diplomat-clv', name: 'Diplomat', system: 'Diplomat', distributor: 'signus', home: 'CLV', at: 'CLV', kind: 'consignment', trays: ['Pedicle screws 2-5'] },
  { id: 'lonestar-rhh', name: 'Lonestar', system: 'Lonestar', home: 'RHH', at: 'CLV', away: { at: 'CLV' }, kind: 'consignment', trays: [] }
]
const trayLists = {
  'diplomat-clv': { trays: [{ name: 'Pedicle screws 2-5', lines: [
    { code: 'DP-6545', description: 'Pedicle screw 6.5 x 45mm', qty: 4 },
    { code: 'DP-6550', description: 'Pedicle screw 6.5 x 50mm', qty: 4 }
  ] }] }
}
const prefs = { surgeons: [{ id: 'sample', name: 'Sample', systems: [{ name: 'Dakota', subtitle: 'ACDF', items: ['**16mm** screws', 'Mini drill'] }] }] }
const inbox = [{ id: 'c1', status: 'pending', patient: 'Testa', surgeon: 'Sample', procedure: 'L4/5 PLIF', hospital: 'CLV', date: '2026-11-20' }]
const all = { usage, kits, trayLists, prefs, inbox }
const group = (q, key) => searchPortal(q, all).find(g => g.key === key)?.items || []

describe('searching the portal', () => {
  it('finds a usage scan by lot number, however it is typed', () => {
    expect(group('lot77881', 'usage').map(r => r.id)).toEqual(['u1'])
    expect(group('LOT 77881', 'usage').map(r => r.id)).toEqual(['u1'])
    expect(group('lot77881', 'usage')[0].detail).toMatch(/Lot LOT77881/)
  })

  it('finds a usage scan by product code or case', () => {
    expect(group('bst0505', 'usage').map(r => r.id)).toEqual(['u1'])
    expect(group('testa plif', 'usage').map(r => r.id)).toEqual(['u1'])
  })

  it('never offers a scan removed as a duplicate', () => {
    expect(group('dummy', 'usage')).toEqual([])
  })

  it('needs every word: a kit at a place, not everything at that place', () => {
    expect(group('diplomat calvary', 'kit').map(r => r.id)).toEqual(['diplomat-clv'])
    expect(group('lonestar calvary', 'kit')[0].detail).toMatch(/At Calvary · \(home RHH\)/)
  })

  it('finds tray lines by size or code, and a kit name alone is the kit, not its lines', () => {
    expect(group('diplomat', 'trayline')).toEqual([])
    expect(group('diplomat 45mm', 'trayline').map(r => r.title)).toEqual(['Pedicle screw 6.5 x 45mm'])
    expect(group('dp6550', 'trayline').map(r => r.title)).toEqual(['Pedicle screw 6.5 x 50mm'])
  })

  it('finds preference cards and the Inbox', () => {
    expect(group('sample dakota', 'pref')[0].title).toBe('Sample · Dakota')
    expect(group('mini drill', 'pref')[0].detail).toBe('Mini drill')
    expect(group('testa', 'inbox').map(r => r.id)).toEqual(['c1'])
  })

  it('returns nothing for nothing', () => {
    expect(queryWords('  ')).toEqual([])
    expect(searchPortal('', all)).toEqual([])
    expect(searchPortal('zzzz-nope', all)).toEqual([])
  })
})
