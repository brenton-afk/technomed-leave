// ─── Checking a distributor's sales report (Brent, 9 Nov 2026) ───────────────
// "You need to be able to cross check with the portal." Each month a
// distributor sends the report their commission is worked out from — Signus's
// is one line per item billed, grouped by invoice, with the surgeon in
// "Carrier" and the patient in "Project Name". This reads that report, finds
// the case behind every invoice (the portal's usage records first, then the
// bookings calendar), and writes the report back with three columns added:
// the surgery date, where it was found, and anything worth checking.
//
// Read-only from end to end. Nothing is written to Redis, the calendar or
// Dropbox, and the report itself is never stored: it comes in with the
// request and goes back out with the response.
//
// Columns are added at the end, never inserted, so a report's own formulas
// (Signus's total and its 30% line) still point at the cells they did.

import ExcelJS from 'exceljs'
import { redis } from './_redis.js'
import { detectDistributor, distributorName } from './_distributors.js'
import { siteCode } from '../src/clinicalPlan/inventory.js'
import { readBooking, isCancelled } from '../src/clinicalPlan/parse.js'
import { getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY } from './_googleCalendar.js'

// How far before an invoice its case can be. Signus invoices within a few
// weeks; a late extra item (a cross connector a month on) is the long end.
export const LOOKBACK_DAYS = 120

// ─── Reading the report ──────────────────────────────────────────────────────

const HEADERS = {
  invoice: /^invoice\s*(no|number|#|num)/i,
  invoiceDate: /invoice\s*date|^date$/i,
  customer: /^customer$|customer\s*name|^hospital$/i,
  surgeon: /carrier|surgeon|doctor|consultant/i,
  patient: /project|patient/i,
  code: /^code$|product\s*code|item\s*code|^ref/i,
  product: /^product$|^description$|product\s*name/i,
  type: /product\s*type|category/i,
  qty: /^qty$|quantity/i,
  sales: /^sales$|amount|^value$|line\s*total/i
}

/** The plain value of an ExcelJS cell: formulas give their result. */
export function cellValue(v) {
  if (v == null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result)
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('')
    if ('text' in v) return String(v.text)
    return ''
  }
  return v
}

const text = v => String(cellValue(v) ?? '').trim()

/** "01/10/2026", a Date or "2026-10-01" → "2026-10-01". */
export function isoDate(v) {
  const value = cellValue(v)
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return value.toISOString().slice(0, 10)
  }
  const s = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s)
  if (!m) return ''
  const year = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

const num = v => {
  const n = Number(String(cellValue(v)).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Letters only, lower case: "La Pietra" and "LA PIETRA" are one surname. */
export const surnameKey = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
const codeKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * The report's lines, each with its sheet row number. Finds the header row by
 * what it says rather than where it is, so a distributor adding a title row
 * does not break it.
 */
export function readReport(ws) {
  let headerRow = 0
  const cols = {}
  for (let r = 1; r <= Math.min(ws.rowCount, 20) && !headerRow; r++) {
    const found = {}
    ws.getRow(r).eachCell((cell, c) => {
      const label = text(cell.value)
      for (const [key, re] of Object.entries(HEADERS)) if (!(key in found) && re.test(label)) found[key] = c
    })
    if (found.invoice && found.patient) { headerRow = r; Object.assign(cols, found) }
  }
  if (!headerRow) {
    throw Object.assign(new Error('This does not look like a sales report: no row has both an invoice number and a patient (or project) column.'), { status: 400 })
  }
  const lines = []
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const get = key => (cols[key] ? row.getCell(cols[key]).value : null)
    const invoice = text(get('invoice'))
    // Total and calculation rows have no invoice number.
    if (!invoice || !/\d/.test(invoice)) continue
    lines.push({
      row: r,
      invoice: invoice.replace(/\.0+$/, ''),
      invoiceDate: isoDate(get('invoiceDate')),
      customer: text(get('customer')),
      hospital: siteCode(text(get('customer'))) || '',
      surgeon: text(get('surgeon')),
      patient: text(get('patient')),
      code: text(get('code')),
      product: text(get('product')),
      type: text(get('type')),
      qty: num(get('qty')) || 0,
      sales: num(get('sales'))
    })
  }
  return { headerRow, cols, lines }
}

// ─── What the portal knows ───────────────────────────────────────────────────

const civil = s => new Date(`${s}T00:00:00Z`)
const addDays = (s, n) => new Date(civil(s).getTime() + n * 86400000).toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((civil(b) - civil(a)) / 86400000)

/**
 * Usage cases between two dates, only what a check needs: no lot numbers, no
 * rep, no Dropbox path. Removed duplicates are not on `usage:all`.
 */
export async function usageCasesBetween(from, to, { limit = 600 } = {}) {
  const ids = await redis('lrange', 'usage:all', '0', String(limit - 1)) || []
  const out = []
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const raw = await redis('mget', ...batch.map(id => `usage:${id}`)) || []
    for (const json of raw) {
      if (!json) continue
      let r
      try { r = JSON.parse(json) } catch { continue }
      if (!r?.date || r.removed || r.date < from || r.date > to) continue
      out.push({
        id: r.id,
        date: r.date,
        patient: r.patientSurname || '',
        surgeon: r.surgeonSurname || '',
        hospital: siteCode(r.hospital) || String(r.hospital || ''),
        procedure: r.procedure || '',
        items: (r.items || []).filter(it => !it.excluded).map(it => ({
          code: it.referenceCode || '',
          product: it.productName || '',
          quantity: Number(it.quantity) || 1,
          distributorKey: it.distributorKey || detectDistributor(it.productName, it.referenceCode) || null
        })),
        sentTo: (r.emailsSent || []).filter(e => e && e.ok !== false && !e.test).map(e => e.key || e.distributorKey || e.distributor).filter(Boolean)
      })
    }
  }
  return out
}

/** Bookings on the calendar between two dates, read the way the app reads them. */
export async function bookingsBetween(from, to, { fetchImpl = fetch } = {}) {
  const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getCalendarId())}/events`
    + `?timeMin=${encodeURIComponent(`${from}T00:00:00+11:00`)}`
    + `&timeMax=${encodeURIComponent(`${to}T23:59:59+10:00`)}`
    + '&singleEvents=true&orderBy=startTime&maxResults=2500'
    + `&timeZone=${encodeURIComponent('Australia/Hobart')}`
  const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = await r.json()
  if (data.error) throw new Error(data.error.message || 'The calendar could not be read')
  return (data.items || [])
    .filter(e => e.start?.dateTime)
    .map(e => {
      const read = readBooking(e.summary || '', e.description || '')
      if (!read?.patient) return null
      return {
        id: e.id,
        date: e.start.dateTime.slice(0, 10),
        patient: read.patient,
        surgeon: read.surgeon || '',
        hospital: siteCode(read.hospital) || '',
        system: read.system || '',
        cancelled: isCancelled(e.summary || '', e.description || '')
      }
    })
    .filter(Boolean)
}

// ─── Matching ────────────────────────────────────────────────────────────────

const sameSurgeon = (a, b) => {
  const x = surnameKey(a); const y = String(b || '').toLowerCase()
  return Boolean(x) && y.split(/[^a-z]+/).some(w => w && (w === x || x.startsWith(w) || w.startsWith(x)))
}

const samePatient = (a, b) => {
  const x = surnameKey(a); const y = surnameKey(b)
  return Boolean(x && y) && (x === y || (x.length > 4 && y.length > 4 && (x.startsWith(y) || y.startsWith(x))))
}

function score(inv, c, codes) {
  let s = 0
  if (inv.hospital && c.hospital === inv.hospital) s += 3
  if (sameSurgeon(inv.surgeon, c.surgeon)) s += 2
  if (c.items) {
    const used = new Set(c.items.map(i => codeKey(i.code)).filter(Boolean))
    const overlap = codes.filter(k => used.has(k)).length
    if (overlap) s += 5 + overlap
  }
  // Nearer the invoice is likelier, all else equal.
  s -= Math.max(0, daysBetween(c.date, inv.invoiceDate)) / 100
  return s
}

function best(inv, list, codes) {
  const from = addDays(inv.invoiceDate, -LOOKBACK_DAYS)
  const to = addDays(inv.invoiceDate, 3)
  const ranked = list
    .filter(c => samePatient(inv.patient, c.patient) && c.date >= from && c.date <= to)
    .map(c => ({ c, s: score(inv, c, codes) }))
    .sort((a, b) => b.s - a.s)
  if (!ranked.length) return { match: null, others: [] }
  return { match: ranked[0].c, others: ranked.slice(1).filter(x => x.c.date !== ranked[0].c.date && ranked[0].s - x.s < 1).map(x => x.c) }
}

/**
 * The usage's code for a billed one. A form read by a camera and a
 * distributor's system do not always write a code the same way —
 * "MACNIT18470 R/R" on the report, "MACNIT18470" on the form — so a code that
 * starts with the other counts, once both are long enough to mean something.
 */
export function sameCode(billed, usedKeys) {
  if (usedKeys.includes(billed)) return billed
  return usedKeys.find(u => Math.min(u.length, billed.length) >= 6 && (billed.startsWith(u) || u.startsWith(billed))) || null
}

const money = n => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dmy = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

/**
 * Every invoice on the report with its case, its surgery date and what to
 * check; and the distributor's cases in the same weeks that no invoice
 * covers. Pure: the cases and bookings are handed in.
 */
export function checkReport(lines, { cases = [], bookings = [] } = {}) {
  const byInvoice = new Map()
  for (const l of lines) {
    if (!byInvoice.has(l.invoice)) byInvoice.set(l.invoice, [])
    byInvoice.get(l.invoice).push(l)
  }

  // Whose report this is: the distributor most of its lines belong to.
  const votes = {}
  for (const l of lines) {
    const k = detectDistributor(l.type, l.product)
    if (k) votes[k] = (votes[k] || 0) + 1
  }
  const distributorKey = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  // The usual price of each code at each hospital, to point out a discount.
  // Per hospital: RHH and Calvary pay different prices for the same item
  // (a K-wire is $150 at one and $200 at the other), and that is not a discount.
  const priceKey = l => `${l.hospital || l.customer}|${codeKey(l.code)}`
  const fullPrice = {}
  for (const l of lines) {
    if (!l.qty) continue
    const each = l.sales / l.qty
    fullPrice[priceKey(l)] = Math.max(fullPrice[priceKey(l)] || 0, each)
  }

  const live = bookings.filter(b => !b.cancelled)
  const invoices = []
  for (const [invoice, group] of byInvoice) {
    const first = group[0]
    const inv = { ...first, invoice }
    const codes = group.map(l => codeKey(l.code)).filter(Boolean)
    const fromUsage = best(inv, cases, codes)
    const fromCalendar = best(inv, live, [])
    const usage = fromUsage.match
    const booking = fromCalendar.match
    const surgeryDate = usage?.date || booking?.date || ''
    const source = usage ? 'Portal usage' : booking ? 'Bookings calendar' : ''
    const checks = []

    if (!usage && !booking) checks.push('Not found in the portal or on the bookings calendar')
    else if (!usage) checks.push('No usage record in the portal — date from the bookings calendar')
    if (usage && booking && booking.date !== usage.date) checks.push(`Bookings calendar says ${dmy(booking.date)}`)
    if (fromUsage.others.length) checks.push(`Also a usage for this surname on ${fromUsage.others.map(c => dmy(c.date)).join(', ')} — check which case this is`)

    const caseFound = usage || booking
    if (caseFound?.surgeon && first.surgeon && !sameSurgeon(first.surgeon, caseFound.surgeon)) {
      checks.push(`Surgeon on the report is ${first.surgeon}; ${usage ? 'the usage' : 'the booking'} says ${caseFound.surgeon}`)
    }
    if (caseFound?.hospital && first.hospital && caseFound.hospital !== first.hospital) {
      checks.push(`Billed to ${first.hospital}; the case was at ${caseFound.hospital}`)
    }

    if (usage) {
      const used = {}
      for (const it of usage.items) {
        const k = codeKey(it.code)
        if (k) used[k] = (used[k] || 0) + it.quantity
      }
      if (Object.keys(used).length) {
        const billed = {}
        for (const l of group) { const k = codeKey(l.code); if (k) billed[k] = (billed[k] || 0) + l.qty }
        for (const [k, q] of Object.entries(billed)) {
          const line = group.find(l => codeKey(l.code) === k)
          const u = sameCode(k, Object.keys(used))
          if (!u) checks.push(`${line.code} billed but not on the usage`)
          else if (q > used[u]) checks.push(`${line.code}: ${q} billed, ${used[u]} on the usage`)
        }
      }
    }

    for (const l of group) {
      const full = fullPrice[priceKey(l)]
      const each = l.qty ? l.sales / l.qty : 0
      if (full && each && each < full - 0.005) {
        checks.push(`${l.code}: ${money(each)} each against ${money(full)} elsewhere at ${first.hospital || 'this hospital'}`)
      }
    }

    invoices.push({
      invoice, invoiceDate: first.invoiceDate, patient: first.patient, surgeon: first.surgeon,
      hospital: first.hospital, customer: first.customer,
      lines: group.length, sales: Math.round(group.reduce((s, l) => s + l.sales, 0) * 100) / 100,
      surgeryDate, source, usageId: usage?.id || null, checks
    })
  }

  // Same case billed on two invoices — usually a late item; worth a look.
  const byCase = {}
  for (const i of invoices) {
    if (!i.surgeryDate) continue
    const k = `${surnameKey(i.patient)}|${i.surgeryDate}`
    ;(byCase[k] ||= []).push(i)
  }
  for (const group of Object.values(byCase)) {
    if (group.length < 2) continue
    for (const i of group) {
      const others = group.filter(o => o !== i).map(o => o.invoice)
      i.checks.push(`Same case is also on invoice ${others.join(', ')}`)
    }
  }

  // The distributor's cases in the report's weeks that no invoice covers.
  const matchedIds = new Set(invoices.map(i => i.usageId).filter(Boolean))
  const dates = invoices.map(i => i.surgeryDate).filter(Boolean).sort()
  // From the first case the report covers to its last invoice: a case after
  // the last one it covers is most likely on next month's report, and says so.
  const lastInvoice = invoices.map(i => i.invoiceDate).filter(Boolean).sort().pop() || ''
  const lastCovered = dates[dates.length - 1] || ''
  const notBilled = !distributorKey || !dates.length ? [] : cases
    .filter(c => c.date >= dates[0] && c.date <= (lastInvoice || lastCovered))
    .filter(c => !matchedIds.has(c.id))
    .filter(c => c.items.some(it => it.distributorKey === distributorKey))
    .filter(c => !invoices.some(i => samePatient(i.patient, c.patient) && i.surgeryDate === c.date))
    .map(c => ({
      date: c.date, patient: c.patient, surgeon: c.surgeon, hospital: c.hospital, procedure: c.procedure,
      items: c.items.filter(it => it.distributorKey === distributorKey).length,
      sent: c.sentTo.includes(distributorKey),
      note: c.date > lastCovered ? 'After the last case on this report — probably next month' : 'Missing from this report'
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  return {
    distributorKey,
    distributor: distributorKey ? distributorName(distributorKey) : '',
    invoices,
    notBilled,
    totals: {
      lines: lines.length,
      invoices: invoices.length,
      sales: Math.round(lines.reduce((s, l) => s + l.sales, 0) * 100) / 100,
      dated: invoices.filter(i => i.surgeryDate).length,
      withChecks: invoices.filter(i => i.checks.length).length
    }
  }
}

// ─── Writing it back ─────────────────────────────────────────────────────────

/**
 * The same workbook with Surgery Date, Found in and Check on every line, and
 * a "Not on this report" sheet. Columns go after the last one used, so the
 * report's own formulas are untouched.
 */
export async function annotate(workbook, ws, report, result) {
  const last = Math.max(...Object.values(report.cols), ws.getRow(report.headerRow).cellCount, ws.columnCount)
  const [dateCol, sourceCol, checkCol] = [last + 1, last + 2, last + 3]
  const header = ws.getRow(report.headerRow)
  const style = header.getCell(report.cols.invoice).style
  for (const [c, label, width] of [[dateCol, 'Surgery Date', 13], [sourceCol, 'Found in', 18], [checkCol, 'Check', 70]]) {
    const cell = header.getCell(c)
    cell.value = label
    cell.style = { ...style }
    ws.getColumn(c).width = width
  }
  const byInvoice = new Map(result.invoices.map(i => [i.invoice, i]))
  for (const l of report.lines) {
    const i = byInvoice.get(l.invoice)
    const row = ws.getRow(l.row)
    if (i?.surgeryDate) {
      const cell = row.getCell(dateCol)
      cell.value = civil(i.surgeryDate)
      cell.numFmt = 'dd/mm/yyyy'
    }
    row.getCell(sourceCol).value = i?.source || 'Not found'
    if (i?.checks.length) row.getCell(checkCol).value = i.checks.join('; ')
  }

  const extra = workbook.addWorksheet('Not on this report')
  extra.columns = [
    { header: 'Surgery Date', key: 'date', width: 13 },
    { header: 'Patient', key: 'patient', width: 18 },
    { header: 'Surgeon', key: 'surgeon', width: 14 },
    { header: 'Hospital', key: 'hospital', width: 9 },
    { header: 'Procedure', key: 'procedure', width: 40 },
    { header: `${result.distributor || 'Distributor'} items`, key: 'items', width: 12 },
    { header: 'Usage emailed to them', key: 'sent', width: 20 },
    { header: 'Note', key: 'note', width: 50 }
  ]
  extra.getRow(1).font = { bold: true }
  for (const c of result.notBilled) {
    extra.addRow({ ...c, date: civil(c.date), sent: c.sent ? 'Yes' : 'No' }).getCell('date').numFmt = 'dd/mm/yyyy'
  }
  if (!result.notBilled.length) extra.addRow({ patient: 'Every portal case for this distributor in these weeks is on the report.' })
  return workbook
}

/** The whole check, from the uploaded file to the marked-up one. */
export async function checkSalesReport(buffer, { loadCases = usageCasesBetween, loadBookings = bookingsBetween } = {}) {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    throw Object.assign(new Error('That file could not be opened as an Excel workbook (.xlsx).'), { status: 400 })
  }
  const ws = workbook.worksheets.find(s => s.state !== 'hidden') || workbook.worksheets[0]
  if (!ws) throw Object.assign(new Error('The workbook has no sheets.'), { status: 400 })
  const report = readReport(ws)
  if (!report.lines.length) throw Object.assign(new Error('No invoice lines were found under the header row.'), { status: 400 })

  const invoiceDates = report.lines.map(l => l.invoiceDate).filter(Boolean).sort()
  const to = addDays(invoiceDates[invoiceDates.length - 1] || new Date().toISOString().slice(0, 10), 3)
  const from = addDays(invoiceDates[0] || to, -LOOKBACK_DAYS)
  const [cases, bookings] = await Promise.all([
    loadCases(from, to),
    loadBookings(from, to).catch(() => [])
  ])
  const result = checkReport(report.lines, { cases, bookings })
  await annotate(workbook, ws, report, result)
  const file = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')
  return { ...result, window: { from, to }, file }
}
