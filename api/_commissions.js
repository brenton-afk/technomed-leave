// ─── Commissions, worked out from Xero (Brent, 15 Nov 2026) ───────────────────
// Brent only (COMMISSION_USERS, default brenton@ — everyone else gets a 404).
// Three business days before each payment day the month's run is worked out
// from the invoices already in Xero (src/commissions/calc.js), using the rates
// Brent keeps here (seeded from the Dropbox workbooks). Brent checks it and
// approves; approving files each person's workbook in Dropbox the way they are
// already kept. Nothing is written to Xero payroll — the figures are entered
// in the monthly unscheduled pay run.
import ExcelJS from 'exceljs'
import { redis, redisSetBody } from './_redis.js'
import { salesInvoicesWithLines } from './_xeroAccounting.js'
import { uploadFile } from './_dropbox.js'
import { DEFAULT_RULES } from '../src/commissions/rules.js'
import { commissionsFor } from '../src/commissions/calc.js'
import { paymentDateFor, calcDateFor, nextSalesMonth, monthPlus, monthName } from '../src/commissions/schedule.js'
import { todayStr } from '../src/clinicalPlan/week.js'

const RULES = 'commission:rules'
const RUN = month => `commission:run:${month}`
const RUNS = 'commission:runs'
export const COMMISSION_FOLDER = '/Admin/Accounts/Finances/Commissions'

/** Who may see commissions. Unset means Brent alone. */
export function mayUseCommissions(email, env = process.env) {
  const list = String(env.COMMISSION_USERS || 'brenton@technomed.com.au').toLowerCase().split(/[\s,]+/).filter(Boolean)
  return list.includes(String(email || '').toLowerCase())
}

export async function getRules() {
  const raw = await redis('get', RULES)
  return raw ? JSON.parse(raw) : DEFAULT_RULES
}

/** Rates edited on the screen. A dated copy is kept so a past month can be read with its own. */
export async function saveRules(rules, by) {
  if (!Array.isArray(rules?.rows) || !Array.isArray(rules?.people)) throw new Error('Rules need rows and people')
  for (const p of rules.people) for (const r of p.rates || []) {
    const rate = Number(r.rate)
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error(`${p.name}: a rate must be between 0 and 100%`)
    if (!['tm', 'sales'].includes(r.base)) throw new Error(`${p.name}: say whether a rate is on sales or on TechnoMed's commission`)
  }
  const next = { ...rules, version: (Number(rules.version) || 1) + 1, savedBy: by, savedAt: new Date().toISOString() }
  await redisSetBody(RULES, JSON.stringify(next))
  await redis('lpush', 'commission:rules:history', JSON.stringify({ version: next.version, savedBy: by, savedAt: next.savedAt }))
  return next
}

export async function getRun(month) {
  const raw = await redis('get', RUN(month))
  return raw ? JSON.parse(raw) : null
}

export async function listRuns() {
  const months = (await redis('lrange', RUNS, 0, 23)) || []
  const runs = []
  for (const m of [...new Set(months)]) { const r = await getRun(m); if (r) runs.push(summary(r)) }
  return runs.sort((a, b) => b.salesMonth.localeCompare(a.salesMonth))
}

const summary = r => ({ salesMonth: r.salesMonth, paymentDate: r.paymentDate, status: r.status, computedAt: r.computedAt, total: r.people.reduce((s, p) => s + p.total, 0), missing: r.missing })

/** Lines paid in an earlier, approved month — so a late correction is paid once. */
async function countedBefore(month) {
  const out = new Set()
  for (let m = monthPlus(month, -1), i = 0; i < 12; i++, m = monthPlus(m, -1)) {
    const r = await getRun(m)
    if (r?.status === 'approved') for (const k of r.counted || []) out.add(k)
  }
  return out
}

/** Works a month out from Xero and keeps it as a draft. An approved month is never redone. */
export async function runCommissions(salesMonth, { by }) {
  if (!/^\d{4}-\d{2}$/.test(String(salesMonth))) throw new Error('Pick a sales month')
  const existing = await getRun(salesMonth)
  if (existing?.status === 'approved') return existing
  const rules = await getRules()
  const to = [todayStr(), `${monthPlus(salesMonth, 3)}-01`].sort()[0]
  const invoices = await salesInvoicesWithLines(`${salesMonth}-01`, to)
  const result = commissionsFor({ salesMonth, invoices, rules, counted: await countedBefore(salesMonth) })
  const run = {
    salesMonth, paymentDate: paymentDateFor(salesMonth), calcDate: calcDateFor(salesMonth),
    status: 'draft', computedAt: new Date().toISOString(), computedBy: by, rulesVersion: rules.version,
    people: result.people, missing: result.missing,
    sources: result.sources.map(({ key, row, invoice, month, adjustment, sales, tm }) => ({ key, row, invoice, month, adjustment, sales, tm })),
    counted: result.sources.map(s => s.key)
  }
  await redisSetBody(RUN(salesMonth), JSON.stringify(run))
  await redis('lrem', RUNS, 0, salesMonth)
  await redis('lpush', RUNS, salesMonth)
  return run
}

/** Approve: file each person's workbook in Dropbox and lock the month. */
export async function approveRun(salesMonth, { by }) {
  const run = await getRun(salesMonth)
  if (!run) throw Object.assign(new Error('Work the month out first'), { status: 404 })
  if (run.status === 'approved') return run
  const rules = await getRules()
  const filed = []
  for (const person of run.people) {
    if (!person.total && !person.lines.some(l => l.tm)) continue
    const def = rules.people.find(p => p.email === person.email)
    const buffer = await commissionWorkbook(run, person)
    const path = `${COMMISSION_FOLDER}/${def?.folder || `${person.name.split(' ')[0]} Commissions`}/${def?.file || `${person.name.split(' ')[0]} Commissions`} ${monthName(salesMonth)}.xlsx`
    const saved = await uploadFile(path, buffer, { keep: true })
    filed.push(saved?.path_display || path)
  }
  const next = { ...run, status: 'approved', approvedBy: by, approvedAt: new Date().toISOString(), filed }
  await redisSetBody(RUN(salesMonth), JSON.stringify(next))
  return next
}

/** The month due now, worked out if it is time and it has not been (the morning cron). */
export async function commissionsDue({ today = todayStr(), by = 'cron' } = {}) {
  const month = nextSalesMonth(today)
  if (today < calcDateFor(month)) return { month, waiting: calcDateFor(month) }
  const run = await getRun(month)
  if (run) return { month, already: run.status }
  const fresh = await runCommissions(month, { by })
  return { month, worked: true, total: fresh.people.reduce((s, p) => s + p.total, 0) }
}

/** The person's workbook, laid out like the ones in Dropbox. */
export async function commissionWorkbook(run, person) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  const label = new Date(`${run.salesMonth}-01T00:00:00Z`).toLocaleDateString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace(' ', '-')
  const first = person.name.split(' ')[0]
  ws.addRow(['Company', label, 'Technomed Commission', `${first} Commission Rate`, 'On', `${first} Commission`, 'Pay item', 'Invoices'])
  for (const l of person.lines) {
    ws.addRow([l.label, l.sales || 0, l.tm || 0, l.rate, l.base === 'sales' ? 'Sales' : 'TM commission', l.amount, l.payItem,
      [...l.invoices, ...l.adjustments.map(a => `adjustment ${a}`)].join(', ')])
  }
  ws.addRow([])
  ws.addRow(['PAY RUN SUMMARY (Xero pay items)'])
  for (const [item, amount] of Object.entries(person.byPayItem)) ws.addRow([item, '', '', '', '', amount])
  ws.addRow([`TOTAL ${first.toUpperCase()} COMMISSION`, '', '', '', '', person.total])
  ws.addRow([])
  ws.addRow([`Source: Xero invoices for ${monthName(run.salesMonth)} sales. Worked out by the portal ${run.computedAt.slice(0, 10)}; paid ${run.paymentDate}.`])
  for (const col of [2, 3, 6]) ws.getColumn(col).numFmt = '$#,##0.00'
  ws.getColumn(4).numFmt = '0.00%'
  ws.getColumn(1).width = 52
  ws.getColumn(8).width = 30
  return Buffer.from(await wb.xlsx.writeBuffer())
}
