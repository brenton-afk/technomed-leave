import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { cellText, sheetRows, sheetsFromWorkbook, filterRows } from './sheetView.js'
import { viewKind } from './DocViewer.jsx'

describe('spreadsheets open in the portal', () => {
  it('an .xlsx is a sheet; an old .xls is not (it still downloads)', () => {
    expect(viewKind('Reline Open codes with GTIN.xlsx')).toBe('sheet')
    expect(viewKind('book.XLSM')).toBe('sheet')
    expect(viewKind('old.xls')).toBe('')
  })

  it('reads cells as a person would', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(12)).toBe('12')
    expect(cellText(0.1 + 0.2)).toBe('0.3')
    expect(cellText(new Date(Date.UTC(2026, 10, 22)))).toBe('22/11/2026')
    expect(cellText({ richText: [{ text: 'Rebate ' }, { text: 'code' }] })).toBe('Rebate code')
    expect(cellText({ formula: 'A1*2', result: 8 })).toBe('8')
    expect(cellText({ text: 'Open', hyperlink: 'javascript:alert(1)' })).toBe('Open')
    expect(cellText({ error: '#N/A' })).toBe('#N/A')
  })

  it('trims empty rows and columns around the table', () => {
    const { rows } = sheetRows([[], [undefined, 'Code', 'Description'], [undefined, 'AB1', 'Screw', ''], []])
    expect(rows).toEqual([['Code', 'Description'], ['AB1', 'Screw']])
  })

  it('stops at the row limit and says how many more', () => {
    const raw = Array.from({ length: 12 }, (_, i) => [`r${i}`])
    const { rows, more } = sheetRows(raw, { maxRows: 10 })
    expect(rows).toHaveLength(10)
    expect(more).toBe(2)
  })

  it('finds every word anywhere in a row and keeps the heading', () => {
    const rows = [['Code', 'Description'], ['RL-100', 'Reline screw 6.5'], ['RL-200', 'Reline rod'], ['X', 'Other']]
    expect(filterRows(rows, 'reline screw')).toEqual([rows[0], rows[1]])
    expect(filterRows(rows, '')).toBe(rows)
  })

  it('reads a real workbook: every visible sheet with something on it', async () => {
    const wb = new ExcelJS.Workbook()
    const a = wb.addWorksheet('Codes')
    a.addRow(['Code', 'Description', 'Qty'])
    a.addRow(['RL-100', 'Reline screw', 2])
    a.addRow(['RL-200', { richText: [{ text: 'Reline ' }, { text: 'rod' }] }, { formula: 'C2*2', result: 4 }])
    wb.addWorksheet('Empty')
    const hidden = wb.addWorksheet('Hidden')
    hidden.addRow(['secret'])
    hidden.state = 'hidden'
    const buf = await wb.xlsx.writeBuffer()
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(buf)
    const sheets = sheetsFromWorkbook(back)
    expect(sheets.map(s => s.name)).toEqual(['Codes'])
    expect(sheets[0].rows).toEqual([['Code', 'Description', 'Qty'], ['RL-100', 'Reline screw', '2'], ['RL-200', 'Reline rod', '4']])
  })
})
