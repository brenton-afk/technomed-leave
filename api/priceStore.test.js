import { describe, it, expect, vi, beforeEach } from 'vitest'
import ExcelJS from 'exceljs'

// The distributor price lists kept in the portal (Brent, 18 Nov 2026).
// Invented products and prices only — the real lists are confidential.

const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'mget') return args.map(k => store.get(k) ?? null)
    if (cmd === 'del') { store.delete(args[0]); return 1 }
    return null
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v) })
}))
const files = { entries: [], data: null }
vi.mock('./_dropbox.js', () => ({
  dropboxConfigured: () => true,
  listFolder: vi.fn(async () => ({ entries: files.entries })),
  downloadFile: vi.fn(async () => files.data)
}))

const { parsePriceBook, savePriceBook, loadPriceBook, refreshPriceBook, searchPriceBook, listForSheet } = await import('./_priceStore.js')
const { priceList } = await import('./_priceList.js')

const HEAD = ['Product range', 'Product type', 'Description', 'Product code', 'Rebate (PL) code', 'Price (AUD)', 'Price setting', 'UDI', 'ARTG', 'Supply', 'Notes']
async function workbook() {
  const wb = new ExcelJS.Workbook()
  const readMe = wb.addWorksheet('Read me')
  readMe.addRow(['TechnoMed distributor price lists'])
  const tab = (name, note, rows) => {
    const ws = wb.addWorksheet(name)
    ws.addRow([`${name} price list`]); ws.addRow([note]); ws.addRow([]); ws.addRow(HEAD)
    rows.forEach(r => ws.addRow(r))
  }
  tab('Signus', 'Source: invented.', [
    ['Diplomat', 'Implant', 'Test tulip', 'AB0010-11111', 'QQ001', 100, 'All hospitals', null, null, 'Consignment (213C)'],
    ['Diplomat', 'Implant', 'Test rod', 'AB0955-00105', 'QQ002', '$250.50', 'All hospitals']
  ])
  tab('E4 Surgical', 'Source: invented.', [['Dakota', 'Implant', 'Test pin', '71-PIN-01', 'EY034', 0, 'All hospitals']])
  tab('KT Medical (Private)', 'Source: invented.', [['FIREBIRD', 'Implant', 'Test screw', '44-1111', 'ER571', 500, 'Private (PL)'], ['LONESTAR', 'Implant', 'Integrated screw', '83-0001', null, '-', 'Private (PL)']])
  tab('KT Medical (RHH)', 'Source: invented. Use with caution until confirmed.', [['FIREBIRD', 'Implant', 'Test screw', '44-1111', 'ER571', 480, 'Public (RHH)']])
  const rebate = wb.addWorksheet('Rebate codes')
  rebate.addRow(['Distributor', 'Price setting', 'Rebate (PL) code']); rebate.addRow(['Signus', 'All', 'QQ001'])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

beforeEach(() => { store.clear() })

describe('reading the workbook', () => {
  it('reads every line of every distributor tab, KT split by hospital, and nothing else', async () => {
    const { lists, notes } = await parsePriceBook(await workbook())
    expect(Object.keys(lists).sort()).toEqual(['e4', 'kt-private', 'kt-rhh', 'signus'])
    expect(lists.signus.map(r => [r.code, r.price, r.rebate, r.supply])).toEqual([
      ['AB0010-11111', 100, 'QQ001', 'Consignment (213C)'], ['AB0955-00105', 250.5, 'QQ002', '']])
    expect(lists.e4[0].price).toBe(0) // $0 kept: it is on the list
    expect(lists['kt-private'][1].price).toBeNull() // "-" is no charge, still listed
    expect(lists['kt-rhh'][0].price).toBe(480)
    expect(notes['kt-rhh']).toMatch(/caution/)
  })

  it('names the tabs', () => {
    expect(listForSheet('KT Medical (RHH)').key).toBe('kt-rhh')
    expect(listForSheet('KT Medical (Private)').key).toBe('kt-private')
    expect(listForSheet('Globus Medical').key).toBe('globus')
    expect(listForSheet('Rebate codes')).toBeNull()
  })
})

describe('kept in the portal', () => {
  it('saves, loads in one read, and searches', async () => {
    const parsed = await parsePriceBook(await workbook())
    await savePriceBook({ file: 'TechnoMed_Distributor_Price_Lists.xlsx', modified: '2026-11-18T04:19:57Z', by: 'Brent' }, parsed)
    const book = await loadPriceBook({ fresh: true })
    expect(book.meta.counts).toMatchObject({ signus: 2, e4: 1, 'kt-private': 2, 'kt-rhh': 1, globus: 0 })
    expect(book.lists.signus[1]).toMatchObject({ code: 'AB0955-00105', price: 250.5 })
    expect(searchPriceBook(book, 'firebird screw').map(r => r.list)).toEqual(['kt-rhh', 'kt-private'])
    expect(searchPriceBook(book, 'ab0955')[0].distributor).toBe('Signus')
  })

  it('reads Dropbox only when the workbook changed', async () => {
    files.entries = [{ kind: 'file', name: 'TechnoMed_Distributor_Price_Lists.xlsx', path: '/Admin/Accounts/x.xlsx', modified: '2026-11-18T04:19:57Z' }]
    files.data = await workbook()
    expect((await refreshPriceBook()).read).toBe(true)
    expect((await refreshPriceBook()).unchanged).toBe(true)
    expect((await refreshPriceBook({ force: true })).read).toBe(true)
  })

  it('self-funding quotes price from what the portal holds (priced lines only)', async () => {
    await savePriceBook({ file: 'f.xlsx', modified: 'm' }, await parsePriceBook(await workbook()))
    await loadPriceBook({ fresh: true })
    const list = await priceList()
    expect(list.rows.map(r => r.code)).toEqual(['AB0010-11111', 'AB0955-00105', '44-1111', '44-1111'])
    expect(list.rows[0]).toMatchObject({ sheet: 'Signus', price: 100 })
  })
})
