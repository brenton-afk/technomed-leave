// ─── Lines pasted from a spreadsheet (Brent, 5 Nov 2026) ─────────────────────
// Copying cells out of Excel, Numbers or Google Sheets gives tab-separated
// rows. Columns are read in the order a quote sheet lists them:
//   code · description · quantity · unit price · discount
// A header row ("Item", "Description", …) and blank rows are skipped; a row
// with no quantity and no price is not a line and is skipped too (a total, a
// heading). Nothing is guessed: a price that is not a number stays blank, and
// the line is refused at submit like any other blank price.

const money = v => {
  const s = String(v ?? '').replace(/[$,\s]/g, '')
  if (s === '') return ''
  const n = Number(s)
  return Number.isFinite(n) ? n : ''
}

/** "20.00%" → 20, "0.2" → 20, "20" → 20, "" → 0. */
export function discountOf(v) {
  const s = String(v ?? '').trim()
  if (!s) return 0
  const n = Number(s.replace(/[%\s]/g, ''))
  if (!Number.isFinite(n) || n < 0) return 0
  if (s.includes('%')) return Math.min(n, 100)
  return Math.min(n > 0 && n <= 1 ? n * 100 : n, 100)
}

export function parsePastedLines(text) {
  const out = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue
    const cells = raw.includes('\t') ? raw.split('\t') : raw.split(/\s{2,}|,(?=\S)/)
    const [code = '', description = '', qty = '', price = '', disc = ''] = cells.map(c => c.trim())
    if (/^(item|code)$/i.test(code) && /description/i.test(description)) continue
    const quantity = money(qty)
    const unitPrice = money(price)
    if (quantity === '' && unitPrice === '') continue
    out.push({ code, description, quantity: quantity === '' ? 1 : quantity, unitPrice, discount: discountOf(disc) })
  }
  return out
}

/** One line's amount ex GST, after its discount. */
export const lineAmount = l =>
  (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discount) || 0) / 100)
