// ─── The commission sums (Brent, 15 Nov 2026) ─────────────────────────────────
// From the invoices already in Xero: each commission invoice line says which
// month and how much was sold ("Commission on SEPTEMBER 2026 Sales of
// $177,678.00 @ 30%"); its amount is TechnoMed's commission. Lateral Medical
// is TechnoMed's own sales of those kits to Calvary Lenah Valley that month.
// Pure, so the September 2026 workbook can be reproduced in a test.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const r2 = n => Math.round(n * 100) / 100

/** The month a line or reference speaks of, "YYYY-MM", or ''. */
export function monthIn(text) {
  const m = String(text || '').toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4}|\d{2})\b/)
  if (!m) return ''
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])
  return `${year}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`
}

/** The sales figure a commission line states, or null. */
export function salesIn(text) {
  const m = String(text || '').match(/sales[^$\d]{0,25}\$\s?([\d,]+(?:\.\d{1,2})?)/i)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

const re = s => (s ? new RegExp(s, 'i') : null)

/** The commission row an invoice line belongs to, or null. */
export function rowFor(rows, invoice, line) {
  const contact = invoice.contact || ''
  const words = `${invoice.reference || ''} ${line.description || ''}`
  for (const row of rows) {
    if (row.ownSales) continue
    if (!re(row.contact).test(contact)) continue
    if (row.words && !re(row.words).test(words)) continue
    return row
  }
  return null
}

const live = inv => !['VOIDED', 'DELETED', 'DRAFT'].includes(String(inv.status || '').toUpperCase())

/**
 * The month's commission.
 *
 * @param invoices [{ id, number, contact, date, reference, status, lines: [{ description, amount, itemName }] }]
 * @param counted  Set of "invoiceId:lineIndex" already paid in an earlier month
 * @returns {{ sources, people, missing }}
 */
export function commissionsFor({ salesMonth, invoices, rules, counted = new Set() }) {
  const { rows, people } = rules
  const sources = []
  for (const inv of invoices.filter(live)) {
    (inv.lines || []).forEach((line, i) => {
      const key = `${inv.id}:${i}`
      // Lateral Medical: the kits themselves, on invoices dated in the month.
      const own = rows.find(r => r.ownSales && re(r.contact).test(inv.contact || '') && re(r.items).test(line.itemName || line.description || ''))
      if (own) {
        if (String(inv.date || '').slice(0, 7) === salesMonth) {
          sources.push({ key, row: own.id, invoice: inv.number, sales: r2(Number(line.amount) || 0), tm: r2((Number(line.amount) || 0) * own.tmRate), month: salesMonth })
        }
        return
      }
      const row = rowFor(rows, inv, line)
      if (!row) return
      const month = monthIn(line.description) || monthIn(inv.reference)
      if (!month) return
      const adjustment = month < salesMonth && !counted.has(key)
      if (month !== salesMonth && !adjustment) return
      sources.push({
        key, row: row.id, invoice: inv.number, month, adjustment: adjustment || undefined,
        tm: r2(Number(line.amount) || 0), sales: salesIn(line.description)
      })
    })
  }

  const rowById = Object.fromEntries(rows.map(r => [r.id, r]))
  const missing = rows.filter(r => r.expected && !sources.some(s => s.row === r.id && !s.adjustment) && people.some(p => p.rates.some(x => x.row === r.id)))
    .map(r => r.label)

  const out = people.map(person => {
    const lines = []
    const groups = new Map()
    for (const rate of person.rates) {
      const found = sources.filter(s => s.row === rate.row)
      const base = r2(found.reduce((sum, s) => sum + (rate.base === 'sales' ? (s.sales ?? 0) : s.tm), 0))
      const unknownSales = rate.base === 'sales' && found.some(s => s.sales == null)
      lines.push({
        row: rate.row, label: rowById[rate.row]?.label || rate.row, invoices: [...new Set(found.filter(s => !s.adjustment).map(s => s.invoice))],
        adjustments: found.filter(s => s.adjustment).map(s => `${s.invoice} (${s.month})`),
        sales: r2(found.reduce((sum, s) => sum + (s.sales ?? 0), 0)), tm: r2(found.reduce((sum, s) => sum + s.tm, 0)),
        base: rate.base, rate: rate.rate, payItem: rate.payItem, unknownSales: unknownSales || undefined,
        amount: r2(base * rate.rate)
      })
      // Worked out on each pay item's total base, as the workbooks do (spine:
      // 1.5% of TechnoMed's whole spine commission), so cents never drift.
      const g = `${rate.payItem}|${rate.rate}|${rate.base}`
      groups.set(g, { payItem: rate.payItem, rate: rate.rate, base: r2((groups.get(g)?.base || 0) + base) })
    }
    const byPayItem = {}
    for (const g of groups.values()) byPayItem[g.payItem] = r2((byPayItem[g.payItem] || 0) + r2(g.base * g.rate))
    const total = r2(Object.values(byPayItem).reduce((a, b) => a + b, 0))
    return { email: person.email, name: person.name, lines, byPayItem, total }
  })
  return { sources, people: out, missing }
}
