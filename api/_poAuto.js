import { redis, redisSetBody } from './_redis.js'
import { listPurchaseOrders, readPurchaseOrder, invoicedByPo, splitOrders } from './_purchaseOrders.js'
import { findContacts, listItems, salesInvoicesSince, createDraftInvoice } from './_xeroAccounting.js'
import { todayStr, addCivilDays, parseDateStr, toDateStr } from '../src/clinicalPlan/week.js'

// ─── Calvary purchase orders invoiced by themselves (Brent, 5 Nov 2026) ──────
// "The whole point is to automate them from email and have it done for me."
//
// Twice a day (the 9am and 6pm jobs) and whenever Admin → Invoices is opened:
// every PO in accounts@ that Xero has no invoice for is read, and if it can be
// invoiced exactly the way the team already does it, a DRAFT invoice is made —
// the hospital by its PO prefix, reference = the PO number, each line a Xero
// item at the Xero price, "LOCAL Freight and Handling" added, due in 30 days.
// That is what every Calvary invoice in Xero looks like (INV-2016 to INV-2032).
//
// It stays a draft: approving and sending is still a person's tap in Xero.
// Anything it cannot do the usual way is HELD with the reason, never guessed
// at — a line it cannot match to a Xero item, a PO price that disagrees with
// Xero's, lines that do not add up to the PO's total, an unknown hospital.
// Held POs are not re-read on every run (each read is a Claude call); a person
// invoices them in Xero or taps Try again.

export const FREIGHT_CODE = process.env.PO_FREIGHT_CODE ?? 'F/H Local'
const DUE_DAYS = Number(process.env.PO_DUE_DAYS || 30)
const KEY = po => `po:auto:${po}`
const LOG = 'po:auto:log'
const LOCK = 'po:auto:lock'
const MAX_ATTEMPTS = 3

/** Calvary site by PO prefix → the words its Xero contact is named with. */
export const SITES = {
  LV: /lenah\s*valley/i,
  SJ: /st\.?\s*john/i
}

export function contactFor(poNumber, contacts = []) {
  const site = SITES[String(poNumber).slice(0, 2).toUpperCase()]
  if (!site) return null
  const hits = contacts.filter(c => /calvary/i.test(c.name) && site.test(c.name))
  return hits.length === 1 ? hits[0] : null
}

const near = (a, b) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005)

/**
 * What the invoice for this PO would be, or why it is held. Pure, so every
 * rule is tested directly.
 */
export function planInvoice(order, { poNumber, items = [], contacts = [], today }) {
  const hold = reason => ({ ok: false, reason })
  if (!order || !Array.isArray(order.lines) || !order.lines.length) return hold('No lines could be read from the order')
  const readPo = String(order.poNumber || '').replace(/[-\s]/g, '').toUpperCase()
  if (readPo && readPo !== poNumber) return hold(`The order says ${readPo}, the email says ${poNumber}`)

  const contact = contactFor(poNumber, contacts)
  if (!contact) return hold(`No single Calvary contact in Xero for a ${poNumber.slice(0, 2)} order`)

  const byCode = new Map(items.map(i => [String(i.code).toUpperCase(), i]))
  const lines = []
  for (const [n, l] of order.lines.entries()) {
    const label = `Line ${n + 1} (${l.description || l.code || 'no description'})`
    if (FREIGHT_CODE && /freight|handling|delivery/i.test(`${l.description} ${l.code}`)) continue // added once below
    const item = byCode.get(String(l.xeroCode || '').toUpperCase()) || byCode.get(String(l.code || '').toUpperCase())
    if (!item) return hold(`${label}: not matched to a product in Xero`)
    if (!Number.isFinite(item.price) || item.price <= 0) return hold(`${label}: ${item.code} has no sale price in Xero`)
    if (!(l.quantity > 0)) return hold(`${label}: no quantity`)
    if (l.unitPrice > 0 && !near(l.unitPrice, item.price)) {
      return hold(`${label}: the order says $${l.unitPrice.toFixed(2)}, Xero says $${item.price.toFixed(2)}`)
    }
    lines.push({ code: item.code, xeroCode: item.code, description: item.name, quantity: l.quantity, unitPrice: item.price })
  }
  if (!lines.length) return hold('Nothing on the order but freight')

  const goods = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  if (order.totalExGst > 0 && !near(order.totalExGst, goods) && !near(order.totalExGst, goods * 1.1)) {
    const freight = items.find(i => i.code === FREIGHT_CODE)?.price || 0
    if (!near(order.totalExGst, goods + freight) && !near(order.totalExGst, (goods + freight) * 1.1)) {
      return hold(`The lines come to $${goods.toFixed(2)} but the order's total is $${order.totalExGst.toFixed(2)}`)
    }
  }

  if (FREIGHT_CODE) {
    const freight = byCode.get(FREIGHT_CODE.toUpperCase())
    if (!freight || !(freight.price > 0)) return hold(`The freight item ${FREIGHT_CODE} is not in Xero with a price`)
    lines.push({ code: freight.code, xeroCode: freight.code, description: freight.name, quantity: 1, unitPrice: freight.price })
  }

  return {
    ok: true,
    invoice: { contactId: contact.id, contactName: contact.name, reference: poNumber, date: today, dueDate: toDateStr(addCivilDays(parseDateStr(today), DUE_DAYS)), lines }
  }
}

async function record(po, entry) {
  await redisSetBody(KEY(po), JSON.stringify({ ...entry, at: new Date().toISOString() }))
  await redis('LPUSH', LOG, po).catch(() => {})
  await redis('LTRIM', LOG, '0', '199').catch(() => {})
}

/** What the automation last did for each of these PO numbers: { po: entry }. */
export async function autoRecords(pos = []) {
  if (!pos.length) return {}
  const got = await redis('MGET', ...pos.map(KEY)).catch(() => [])
  const out = {}
  pos.forEach((po, i) => { try { if (got?.[i]) out[po] = JSON.parse(got[i]) } catch { /* unreadable: treat as none */ } })
  return out
}

/** Forget a held PO, so the next run reads it again. */
export async function retryPo(po) {
  await redis('DEL', KEY(po))
}

/**
 * One pass: every outstanding PO not already held, read in parallel (at most
 * `max`), planned, and drafted. Locked, so the 6pm job and someone opening
 * the tab at 6pm cannot both draft the same PO; and createDraftInvoice asks
 * Xero once more, immediately before creating, whether the PO is invoiced.
 */
// PAUSED (Brent, 6 Nov 2026: "pause the Invoice and PO auto completion in
// the portal until I've chatted to Toni"). Nothing is drafted by itself —
// not from the crons, not on opening Admin → Invoices — until PO_AUTO=on is
// set in Vercel. Reading POs and drafting one by hand still work.
export const PO_AUTO_ON = () => process.env.PO_AUTO === 'on'

export async function autoInvoice({ max = 4, by = 'automatic' } = {}) {
  if (!PO_AUTO_ON()) return { paused: true, drafted: [], held: [], failed: [] }
  const got = await redis('SET', LOCK, by, 'NX', 'EX', '90')
  if (got !== 'OK') return { skipped: 'already running' }
  try {
    const orders = await listPurchaseOrders()
    const times = orders.map(o => Date.parse(o.receivedAt)).filter(Number.isFinite)
    const since = new Date((times.length ? Math.min(...times) : Date.now() - 120 * 864e5) - 60 * 864e5).toISOString().slice(0, 10)
    const invoiced = invoicedByPo(await salesInvoicesSince(since))
    const { outstanding } = splitOrders(orders, invoiced)
    const records = await autoRecords(outstanding.map(o => o.poNumber))
    const waiting = outstanding.filter(o => {
      const r = records[o.poNumber]
      return !r || (r.status === 'failed' && (r.attempts || 0) < MAX_ATTEMPTS)
    })
    const todo = waiting.slice(0, max)
    if (!todo.length) return { outstanding: outstanding.length, drafted: [], held: [], failed: [] }

    const [items, contacts] = await Promise.all([listItems(), findContacts('Calvary')])
    const today = todayStr()
    const drafted = []; const held = []; const failed = []
    await Promise.all(todo.map(async o => {
      const attempts = (records[o.poNumber]?.attempts || 0) + 1
      try {
        const order = await readPurchaseOrder(o.id, { items })
        const plan = planInvoice(order, { poNumber: o.poNumber, items, contacts, today })
        if (!plan.ok) {
          held.push({ po: o.poNumber, reason: plan.reason })
          return record(o.poNumber, { status: 'held', reason: plan.reason, messageId: o.id, by })
        }
        const made = await createDraftInvoice(plan.invoice)
        drafted.push({ po: o.poNumber, invoice: made.number, total: made.total })
        return record(o.poNumber, { status: 'drafted', invoice: made.number, total: made.total, messageId: o.id, by })
      } catch (err) {
        if (err.code === 'duplicate') return record(o.poNumber, { status: 'drafted', invoice: (err.existing || []).map(i => i.number).join(', '), by, note: 'already in Xero' })
        if (err.code === 'permission') throw err
        failed.push({ po: o.poNumber, error: err.message })
        return record(o.poNumber, { status: 'failed', reason: err.message, attempts, messageId: o.id, by })
      }
    }))
    console.log('po auto-invoice', JSON.stringify({ drafted: drafted.length, held: held.length, failed: failed.length }))
    return { outstanding: outstanding.length, drafted, held, failed, more: waiting.length > todo.length }
  } finally {
    await redis('DEL', LOCK).catch(() => {})
  }
}
