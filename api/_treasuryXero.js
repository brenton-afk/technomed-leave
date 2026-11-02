import { randomBytes } from 'node:crypto'
import { redis } from './_redis.js'
import { tget, tset, tdel } from './_treasuryStore.js'
import { readXero } from './_xeroResponse.js'

// ─── Xero, read-only, for the Treasury ───────────────────────────────────────
// A separate Xero app and a separate connection from the payroll one in
// _xeroClient.js, on purpose. That connection can file leave and timesheets;
// this one is granted read scopes only, so even a bug here cannot write to the
// books — Xero itself would refuse. On top of that, this module only has a GET:
// there is no function in it that can send anything else, and a test asserts
// that stays true.
//
// Scopes are Xero's granular ones (apps created after 2 March 2026 cannot use
// the old broad scopes). TREASURY_XERO_SCOPES overrides the list if Xero
// renames one, so a rename is a setting rather than a deploy.
//
// Tokens live encrypted in `treasury:xero:tokens` and never leave the server.

export const DEFAULT_SCOPES = [
  'offline_access',
  'accounting.invoices.read',
  'accounting.contacts.read',
  'accounting.settings.read',
  'accounting.reports.banksummary.read',
  'accounting.reports.profitandloss.read'
]

export const CACHE_MS = 15 * 60 * 1000
const API = 'https://api.xero.com/api.xro/2.0'

const cfg = () => ({
  clientId: process.env.TREASURY_XERO_CLIENT_ID,
  clientSecret: process.env.TREASURY_XERO_CLIENT_SECRET,
  redirectUri: process.env.TREASURY_XERO_REDIRECT_URI,
  scopes: (process.env.TREASURY_XERO_SCOPES || DEFAULT_SCOPES.join(' ')).split(/[\s,]+/).filter(Boolean),
  tenantName: process.env.TREASURY_XERO_TENANT || 'TechnoMed'
})

export function xeroConfigured() {
  const c = cfg()
  return Boolean(c.clientId && c.clientSecret && c.redirectUri)
}

// ─── Connecting ──────────────────────────────────────────────────────────────

/** The consent URL, with a one-use `state` tied to who asked, for ten minutes. */
export async function connectUrl(email) {
  const c = cfg()
  const state = randomBytes(24).toString('base64url')
  await redis('set', `treasury:xero:state:${state}`, email, 'EX', '600')
  const params = new URLSearchParams({
    response_type: 'code', client_id: c.clientId, redirect_uri: c.redirectUri,
    scope: c.scopes.join(' '), state
  })
  return 'https://login.xero.com/identity/connect/authorize?' + params.toString()
}

/** Who started the consent this `state` belongs to, or null. Used once. */
export async function consumeState(state) {
  if (!state || !/^[\w-]{20,64}$/.test(state)) return null
  const email = await redis('get', `treasury:xero:state:${state}`)
  if (email) await redis('del', `treasury:xero:state:${state}`)
  return email || null
}

async function tokenRequest(params, fetchImpl) {
  const c = cfg()
  const res = await fetchImpl('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')
    },
    body: new URLSearchParams(params)
  })
  // readXero, never res.json(): Xero answers some errors in XML.
  const { data } = await readXero(res, 'Xero token request')
  if (!res.ok || !data?.access_token) throw new Error(`Xero token request failed (${res.status})`)
  return data
}

/** Picks TechnoMed out of the organisations the consent covered. */
export function chooseTenant(connections, wanted = 'TechnoMed') {
  const orgs = (Array.isArray(connections) ? connections : []).filter(c => !c.tenantType || c.tenantType === 'ORGANISATION')
  const want = String(wanted).toLowerCase()
  return orgs.find(c => String(c.tenantName || '').toLowerCase().includes(want))
    || (orgs.length === 1 ? orgs[0] : null)
}

export async function completeConnect(code, fetchImpl = fetch) {
  const c = cfg()
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: c.redirectUri }, fetchImpl)
  const connRes = await fetchImpl('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' }
  })
  const { data: connections } = await readXero(connRes, 'Xero connections')
  const tenant = chooseTenant(connections, c.tenantName)
  if (!tenant) throw new Error('TechnoMed was not among the organisations you approved')
  await tset('xero:tokens', {
    access: t.access_token, refresh: t.refresh_token,
    exp: Date.now() + (Number(t.expires_in) || 1800) * 1000,
    tenantId: tenant.tenantId, tenantName: tenant.tenantName, connectedAt: new Date().toISOString()
  })
  return tenant.tenantName
}

export async function disconnect() {
  await tdel('xero:tokens')
}

export async function connectionStatus() {
  const t = await tget('xero:tokens')
  return { configured: xeroConfigured(), connected: Boolean(t), tenantName: t?.tenantName || null, connectedAt: t?.connectedAt || null }
}

async function accessToken(fetchImpl) {
  const t = await tget('xero:tokens')
  if (!t) throw Object.assign(new Error('Xero is not connected'), { notConnected: true })
  if (Date.now() < t.exp - 60e3) return t
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }, fetchImpl)
  const next = { ...t, access: fresh.access_token, refresh: fresh.refresh_token || t.refresh, exp: Date.now() + (Number(fresh.expires_in) || 1800) * 1000 }
  await tset('xero:tokens', next)
  return next
}

/** The only call this module makes to the accounting API. GET, and nothing else. */
export async function xeroGet(path, query = {}, fetchImpl = fetch) {
  const t = await accessToken(fetchImpl)
  const qs = new URLSearchParams(query).toString()
  const res = await fetchImpl(`${API}/${path}${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${t.access}`, 'xero-tenant-id': t.tenantId, Accept: 'application/json' }
  })
  const { ok, data } = await readXero(res, `Xero ${path}`)
  if (!ok) throw new Error(`Xero ${path.split('?')[0]} answered ${res.status}`)
  return data
}

// ─── Reading Xero's shapes ───────────────────────────────────────────────────

/** "/Date(1700000000000+0000)/" or "2026-11-30T00:00:00" → "2026-11-30". */
export function xeroDay(v) {
  if (!v) return null
  const ms = /\/Date\((-?\d+)/.exec(String(v))
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10)
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(String(v))
  return iso ? iso[1] : null
}

const num = v => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Bank Summary report → [{name, balance}], plus the total. */
export function parseBankSummary(body) {
  const report = body?.Reports?.[0]
  if (!report) return { accounts: [], total: 0 }
  let closingIdx = -1
  const accounts = []
  const walk = rows => {
    for (const r of rows || []) {
      if (r.RowType === 'Header') {
        closingIdx = (r.Cells || []).findIndex(c => /closing/i.test(c.Value || ''))
      } else if (r.RowType === 'Row') {
        const cells = r.Cells || []
        const idx = closingIdx >= 0 ? closingIdx : cells.length - 1
        if (cells[0]?.Value) accounts.push({ name: cells[0].Value, balance: num(cells[idx]?.Value) })
      } else if (r.Rows) walk(r.Rows)
    }
  }
  walk(report.Rows)
  return { accounts, total: accounts.reduce((s, a) => s + a.balance, 0) }
}

/** P&L report → income, expenses and net profit for the period. */
export function parseProfitAndLoss(body) {
  const report = body?.Reports?.[0]
  const out = { income: null, grossProfit: null, expenses: null, netProfit: null }
  const walk = rows => {
    for (const r of rows || []) {
      if (r.Rows) walk(r.Rows)
      const label = String(r.Cells?.[0]?.Value || '').toLowerCase()
      const value = num(r.Cells?.[1]?.Value)
      if (r.RowType !== 'SummaryRow' && r.RowType !== 'Row') continue
      if (/^total (trading )?income$/.test(label)) out.income = value
      else if (label === 'gross profit') out.grossProfit = value
      else if (/^total operating expenses$/.test(label)) out.expenses = value
      else if (label === 'net profit') out.netProfit = value
    }
  }
  walk(report?.Rows)
  return out
}

/** Outstanding invoices or bills → totals by when they fall due. */
export function summariseOutstanding(invoices, today) {
  const in30 = addDays(today, 30)
  const items = (invoices || []).map(i => ({
    number: i.InvoiceNumber || i.Reference || '',
    contact: i.Contact?.Name || '',
    due: xeroDay(i.DueDateString || i.DueDate),
    amountDue: num(i.AmountDue)
  })).filter(i => i.amountDue > 0)
  const sum = list => list.reduce((s, i) => s + i.amountDue, 0)
  const overdue = items.filter(i => i.due && i.due < today)
  const next30 = items.filter(i => i.due && i.due >= today && i.due <= in30)
  return {
    total: sum(items), count: items.length,
    overdue: sum(overdue), overdueCount: overdue.length,
    due30: sum(next30), due30Count: next30.length,
    items: items.sort((a, b) => String(a.due).localeCompare(String(b.due)))
  }
}

/** Sales invoices raised, split into this month and last. */
export function summariseRaised(invoices, today) {
  const thisMonth = today.slice(0, 7)
  const [y, m] = thisMonth.split('-').map(Number)
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const bucket = ym => {
    const list = (invoices || []).filter(i => (xeroDay(i.DateString || i.Date) || '').startsWith(ym)
      && !['DRAFT', 'DELETED', 'VOIDED'].includes(i.Status))
    return {
      month: ym, count: list.length,
      total: list.reduce((s, i) => s + num(i.Total), 0),
      exGst: list.reduce((s, i) => s + num(i.SubTotal), 0)
    }
  }
  return { thisMonth: bucket(thisMonth), lastMonth: bucket(lastMonth) }
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Australian financial year start for a day: 1 July. */
export function fyStart(day) {
  const [y, m] = day.split('-').map(Number)
  return `${m >= 7 ? y : y - 1}-07-01`
}

async function allInvoices(where, fetchImpl) {
  const all = []
  for (let page = 1; page <= 20; page++) {
    const body = await xeroGet('Invoices', { where, page: String(page), summaryOnly: 'true' }, fetchImpl)
    const list = body?.Invoices || []
    all.push(...list)
    if (list.length < 100) break
  }
  return all
}

const FIGURES = {
  bank: async (today, f) => parseBankSummary(await xeroGet('Reports/BankSummary', { fromDate: today, toDate: today }, f)),
  receivables: async (today, f) => summariseOutstanding(await allInvoices('Type=="ACCREC" AND Status=="AUTHORISED"', f), today),
  payables: async (today, f) => summariseOutstanding(await allInvoices('Type=="ACCPAY" AND Status=="AUTHORISED"', f), today),
  profit: async (today, f) => ({
    from: fyStart(today), to: today,
    ...parseProfitAndLoss(await xeroGet('Reports/ProfitAndLoss', { fromDate: fyStart(today), toDate: today }, f))
  }),
  raised: async (today, f) => {
    const [y, m] = today.split('-').map(Number)
    const from = m === 1 ? [y - 1, 12] : [y, m - 1]
    const where = `Type=="ACCREC" AND Date>=DateTime(${from[0]},${from[1]},1)`
    return summariseRaised(await allInvoices(where, f), today)
  }
}

export const FIGURE_NAMES = Object.keys(FIGURES)

/**
 * Every figure, each from cache if under 15 minutes old. A figure Xero will not
 * give right now comes back as its last stored value, `stale: true`, with a
 * short reason — never a raw error, and never blank when there is history.
 */
export async function xeroFigures({ today, force = false, fetchImpl = fetch, now = Date.now() }) {
  const status = await connectionStatus()
  const out = { status, figures: {} }
  for (const name of FIGURE_NAMES) {
    const cached = await tget(`xero:cache:${name}`)
    const fresh = cached && now - Date.parse(cached.fetchedAt) < CACHE_MS
    if (fresh && !force) { out.figures[name] = { ...cached, stale: false }; continue }
    if (!status.connected) { out.figures[name] = cached ? { ...cached, stale: true, problem: 'Xero is not connected' } : null; continue }
    try {
      const data = await FIGURES[name](today, fetchImpl)
      const record = { data, fetchedAt: new Date(now).toISOString() }
      await tset(`xero:cache:${name}`, record)
      out.figures[name] = { ...record, stale: false }
    } catch (err) {
      const problem = err.notConnected ? 'Xero is not connected' : 'Xero did not answer'
      out.figures[name] = cached ? { ...cached, stale: true, problem } : { data: null, stale: true, problem }
    }
  }
  return out
}
