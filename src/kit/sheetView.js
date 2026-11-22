// ─── Spreadsheets read in the portal (Brent, 22 Nov 2026) ────────────────────
// "Why do xlsx files try to load in PayPal?" An iPhone cannot show an .xlsx
// itself, so a downloaded one is handed to whichever app claims spreadsheets.
// DocViewer now draws the workbook as tables instead. Pure: the workbook comes
// in from exceljs, plain rows of text go out, so this is tested without a file.

export const MAX_ROWS = 3000
export const MAX_COLS = 60

const pad = n => String(n).padStart(2, '0')

/** One cell's value as the text a person would read. */
export function cellText(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text || '').join('')
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) return cellText(v.result)
    if ('text' in v) return cellText(v.text) // a hyperlink: its words, never the link
    if ('error' in v) return String(v.error)
  }
  return ''
}

/** A sheet's rows as text, empty rows and columns trimmed off the ends. */
export function sheetRows(rawRows, { maxRows = MAX_ROWS, maxCols = MAX_COLS } = {}) {
  let rows = rawRows.map(r => (r || []).slice(0, maxCols).map(cellText).map(s => s.replace(/\s+$/, '')))
  const filled = r => r.some(c => c !== '')
  while (rows.length && !filled(rows[rows.length - 1])) rows.pop()
  while (rows.length && !filled(rows[0])) rows.shift()
  const cut = rows.length > maxRows ? rows.length - maxRows : 0
  if (cut) rows = rows.slice(0, maxRows)
  let width = 0
  for (const r of rows) for (let i = r.length - 1; i >= width; i--) if (r[i] !== '') { width = i + 1; break }
  let left = width
  for (const r of rows) { const i = r.findIndex(c => c !== ''); if (i >= 0 && i < left) left = i }
  if (left === width) left = 0
  rows = rows.map(r => Array.from({ length: width - left }, (_, i) => r[left + i] ?? ''))
  return { rows, more: cut }
}

/** Every visible sheet of an exceljs workbook, as { name, rows, more }. Sheets with nothing on them are left out. */
export function sheetsFromWorkbook(wb, opts) {
  const out = []
  wb.eachSheet(ws => {
    if (ws.state && ws.state !== 'visible') return
    const raw = []
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = Array.isArray(row.values) ? row.values.slice(1) : [] // exceljs counts from 1
      raw[n - 1] = vals
    })
    for (let i = 0; i < raw.length; i++) if (!raw[i]) raw[i] = []
    const sheet = sheetRows(raw, opts)
    if (sheet.rows.length) out.push({ name: ws.name, ...sheet })
  })
  return out
}

/** The rows matching every word of `q` (anywhere in the row); the first row, the heading, always stays. */
export function filterRows(rows, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length || rows.length < 2) return rows
  const [head, ...rest] = rows
  return [head, ...rest.filter(r => { const line = r.join(' ').toLowerCase(); return words.every(w => line.includes(w)) })]
}

/** Opens .xlsx bytes. exceljs is loaded only when a spreadsheet is opened. */
export async function readWorkbook(buffer) {
  const mod = await import('exceljs')
  const ExcelJS = mod.default || mod
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  return sheetsFromWorkbook(wb)
}
