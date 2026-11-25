import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readDelivery } from './_dropboxInbox.js'

// Brent, 24 Nov 2026: "I want you to put the device price list into Dropbox."
// A delivery note is accepted only for allowed folders and matching bytes.
const note = (path, text, extra = {}) => {
  const b = Buffer.from(text)
  return JSON.stringify({ path, base64: b.toString('base64'), sha256: createHash('sha256').update(b).digest('hex'), ...extra })
}

describe('Dropbox delivery notes', () => {
  it('accepts a file for /Admin/Accounts with a matching checksum', () => {
    const d = readDelivery(note('/Admin/Accounts/List.xlsx', 'hello', { replaces: 'abc' }))
    expect(d.error).toBeUndefined()
    expect(d.path).toBe('/Admin/Accounts/List.xlsx')
    expect(d.bytes.toString()).toBe('hello')
    expect(d.replaces).toBe('abc')
  })
  it('refuses anywhere else, the usage tree above all', () => {
    expect(readDelivery(note('/ALL SURGEON USAGE/x.xlsx', 'x')).error).toBe('path not allowed')
    expect(readDelivery(note('/Tray Lists/x.xlsx', 'x')).error).toBe('path not allowed')
    expect(readDelivery(note('/Distributors/MAC Surgical/K-Wire/x.pdf', 'x')).error).toBeUndefined()
    expect(readDelivery(note('/Distributors/Signus/x.pdf', 'x')).error).toBe('path not allowed')
    expect(readDelivery(note('/Admin/Accounts/../ALL SURGEON USAGE/x', 'x')).error).toBe('bad path')
  })
  it('refuses bytes that do not match', () => {
    const n = JSON.parse(note('/Admin/Accounts/a.xlsx', 'x'))
    n.sha256 = '0'.repeat(64)
    expect(readDelivery(JSON.stringify(n)).error).toBe('checksum does not match')
    expect(readDelivery('nope').error).toBe('not JSON')
  })
})

describe('edits to a workbook already in Dropbox', async () => {
  const ExcelJS = (await import('exceljs')).default
  const { editWorkbook } = await import('./_dropboxInbox.js')
  it('appends rows after the last one, styled like it, and widens formulas', async () => {
    const wb = new ExcelJS.Workbook()
    const list = wb.addWorksheet('List')
    list.addRow(['Code', 'Price'])
    list.addRow(['A1', 10]); list.getCell('B2').numFmt = '$#,##0.00'
    const sum = wb.addWorksheet('Sum')
    sum.getCell('A1').value = { formula: "COUNTA('List'!$A$2:$A$2)" }
    const out = await editWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), [
      { op: 'replaceInFormulas', sheet: 'Sum', contains: "'List'!", find: '$2)', replace: '$4)' },
      { op: 'appendRows', sheet: 'List', rows: [['B2', 20], ['C3', 30]] },
      { op: 'setCell', sheet: 'Sum', cell: 'B1', value: 'note' }
    ])
    const back = new ExcelJS.Workbook(); await back.xlsx.load(out)
    const l = back.getWorksheet('List')
    expect(l.getCell('A3').value).toBe('B2')
    expect(l.getCell('B4').value).toBe(30)
    expect(l.getCell('B4').numFmt).toBe('$#,##0.00')
    expect(back.getWorksheet('Sum').getCell('A1').value.formula).toBe("COUNTA('List'!$A$2:$A$4)")
    expect(back.getWorksheet('Sum').getCell('B1').value).toBe('note')
  })
  it('an edit must name the version it edits, and only an .xlsx', () => {
    expect(readDelivery({ kind: 'edit', path: '/Admin/Accounts/a.xlsx', edits: [{ op: 'setCell', sheet: 'x' }] }).error).toMatch(/which version/)
    expect(readDelivery({ kind: 'edit', path: '/Admin/Accounts/a.txt', replaces: 'h', edits: [] }).error).toMatch(/xlsx/)
    expect(readDelivery({ kind: 'edit', path: '/Admin/Accounts/a.xlsx', replaces: 'h', edits: [{ op: 'drop', sheet: 'x' }] }).error).toBe('bad edits')
  })
})
