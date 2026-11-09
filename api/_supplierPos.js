import { searchMailboxOf, readMessageHeadline, readAttachment, sniffMediaType, addressOf } from './_gmail.js'
import { askClaude } from './_anthropic.js'
import { redis } from './_redis.js'
import { xeroCall } from './_xeroAccounting.js'

// ─── Purchase orders TO suppliers, from their quotes (Brent, 9 Nov 2026) ─────
// "Can you build a module in the portal so I can just tap check for POs in
// email? … you need to be able to read a quote and generate a PO." Cody at MAC
// Surgical sent quote 00012501 and asked for an updated PO-0147; that took a
// person opening the PDF, finding the PO in Xero and retyping the line.
//
// Not to be confused with _purchaseOrders.js, which is the other direction:
// Calvary's orders *to us*, turned into invoices.
//
// The flow, every step on a person's tap:
//   1. Check — supplier emails in brenton@ and admin@ with a quote attached or
//      a PO asked for (listSupplierQuotes).
//   2. Read — Claude reads the quote into lines; the supplier is matched to a
//      Xero contact and any PO the email names (PO-0147) is fetched with its
//      lines (readSupplierQuote).
//   3. Draft — a new DRAFT purchase order in Xero, or the named PO's lines
//      replaced with the quote's (saveSupplierPo). Never approved, emailed or
//      sent from here: the PO is sent from Xero, as always.
// A PO already billed is never changed. Each email remembers what was done
// with it (`supplierpo:{messageId}`), so it is not offered twice.

export const SUPPLIER_PO_MAILBOXES = (process.env.SUPPLIER_PO_MAILBOXES
  || 'brenton@technomed.com.au,admin@technomed.com.au').split(/[\s,;]+/).filter(Boolean)

// Quotes and PO requests, from outside, recently. Not Calvary (their orders to
// us are the other screen), not CNS (self-funding quote requests are theirs).
export const SUPPLIER_PO_QUERY = process.env.SUPPLIER_PO_QUERY
  || 'newer_than:45d {quote quotation "purchase order" PO} -from:technomed.com.au -from:calvarycare.org.au -from:cnstas.com.au -from:xero.com'

const MODEL = process.env.SUPPLIER_PO_MODEL || 'claude-opus-5'
const KEY = id => `supplierpo:${id}`
const PO_REF = /\bPO[-\s]?(\d{3,6})\b/i

/** A PO number of ours named in text — "PO-0147", "PO 147" → "PO-0147" — or ''. */
export function ourPoNumber(...texts) {
  for (const t of texts) {
    const m = PO_REF.exec(String(t || ''))
    if (m) return `PO-${m[1].padStart(4, '0')}`
  }
  return ''
}

/** Whether a message looks like a supplier quote or a request for a PO. */
export function looksLikeQuoteOrPoRequest({ subject = '', text = '', files = [] }) {
  const names = files.join(' ')
  const quoteFile = /quot|qte|\bqt\d|estimate|proposal/i.test(names)
  const asksForPo = /\b(send|need|require|issue|raise|updated?|new|revised)\b[^.\n]{0,40}\b(PO|purchase order)\b|\b(PO|purchase order)\b[^.\n]{0,20}\b(please|required|needed)\b/i.test(`${subject}\n${text.slice(0, 3000)}`)
  const quoteWords = /\bquot(e|ation)\b/i.test(subject)
  return (quoteFile || quoteWords || asksForPo) && files.some(f => /\.pdf$/i.test(f)) || asksForPo
}

/** The quotes and PO requests waiting, newest first, each with what was done about it. */
export async function listSupplierQuotes({ max = 25, mailboxes = SUPPLIER_PO_MAILBOXES } = {}) {
  const found = []
  const errors = []
  for (const mailbox of mailboxes) {
    let ids = []
    try { ids = await searchMailboxOf(mailbox, SUPPLIER_PO_QUERY, { max }) } catch (err) {
      errors.push({ mailbox, error: err.message })
      continue
    }
    const read = await Promise.all(ids.map(id => readMessageHeadline(mailbox, id).catch(() => null)))
    for (const m of read) {
      if (!m) continue
      const files = (m.attachments || []).map(a => a.filename).filter(Boolean)
      if (!looksLikeQuoteOrPoRequest({ subject: m.subject, text: m.text || '', files })) continue
      found.push({
        id: m.id, mailbox, from: m.from, subject: m.subject, receivedAt: m.receivedAt, files,
        poNumber: ourPoNumber(m.subject, m.text?.slice(0, 4000))
      })
    }
  }
  // The same email in two mailboxes (cc'd) is one request.
  const seen = new Set()
  const unique = found
    .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
    .filter(r => {
      const k = `${addressOf(r.from)}|${String(r.subject).replace(/^(re|fwd?):\s*/gi, '').toLowerCase()}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  const records = await recordsFor(unique.map(r => r.id))
  for (const r of unique) if (records[r.id]) r.done = records[r.id]
  return { requests: unique, errors }
}

async function recordsFor(ids) {
  if (!ids.length) return {}
  const values = await redis('mget', ...ids.map(KEY)).catch(() => [])
  const out = {}
  ids.forEach((id, i) => { try { if (values?.[i]) out[id] = JSON.parse(values[i]) } catch { /* skip */ } })
  return out
}

const PROMPT = `This is an email to TechnoMed, a medical device distributor, from one of its suppliers, usually with a quote attached. TechnoMed is the buyer.
Read the quote and reply with JSON only:
{"supplier": "", "quoteNumber": "", "quoteDate": "YYYY-MM-DD", "poNumber": "",
 "lines": [{"code": "", "description": "", "quantity": 0, "unitPrice": 0}],
 "freight": 0, "totalExGst": 0, "checks": [""]}
- supplier: the supplier's business name as on the quote.
- poNumber: a TechnoMed purchase order number the email asks to be updated or replaced (like "PO-0147"), else "".
- lines: every product line on the quote; unitPrice excluding GST, as a number. Do not invent a line, code or price.
- freight: freight excluding GST if charged, else 0.
- checks: anything a buyer should confirm before ordering — a description that contradicts the item code, the subject or the drawing (e.g. a size), a price that does not multiply out, an expired quote. Plain sentences; [] if none.`

/** One email's quote read into lines, with the supplier and any named PO found in Xero. */
export async function readSupplierQuote(mailbox, id, { xero = xeroCall } = {}) {
  if (!SUPPLIER_PO_MAILBOXES.includes(mailbox)) throw new Error('That mailbox is not read for supplier quotes')
  const m = await readMessageHeadline(mailbox, id)
  const content = []
  for (const a of m.attachments || []) {
    if (!a.attachmentId) continue
    const { data } = await readAttachment(mailbox, id, a.attachmentId)
    const type = sniffMediaType(data, a.mediaType || '')
    if (type === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: type, data } })
    else if (/^image\/(png|jpeg|webp)$/.test(type) && data.length * 0.75 > 40_000) {
      content.push({ type: 'image', source: { type: 'base64', media_type: type, data } })
    }
  }
  content.push({ type: 'text', text: `Subject: ${m.subject}\n\nThe email itself:\n\n${String(m.text || '').slice(0, 6000)}` })
  content.push({ type: 'text', text: PROMPT })

  const reply = await askClaude({
    feature: 'supplier-quote',
    whenUnavailable: 'The quote could not be read automatically — open it and enter the lines by hand.',
    timeoutMs: 45000,
    request: { model: MODEL, max_tokens: 3000, thinking: { type: 'adaptive' }, messages: [{ role: 'user', content }] }
  })
  const text = reply.content.filter(b => b.type === 'text').map(b => b.text).join('')
  let parsed = {}
  try { parsed = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] || '{}') } catch { parsed = {} }
  const quote = cleanQuote(parsed, m)

  const [contacts, existing] = await Promise.all([
    findSuppliers(quote.supplier, addressOf(m.from), xero).catch(() => []),
    quote.poNumber ? getPurchaseOrderByNumber(quote.poNumber, xero).catch(() => null) : null
  ])
  return { quote, contacts, existing, email: { id, mailbox, from: m.from, subject: m.subject, receivedAt: m.receivedAt } }
}

/** The model's reading, typed, never trusted for anything it did not read. */
export function cleanQuote(p = {}, m = {}) {
  const num = v => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null)
  return {
    supplier: String(p.supplier || '').trim().slice(0, 120),
    quoteNumber: String(p.quoteNumber || '').trim().slice(0, 40),
    quoteDate: /^\d{4}-\d{2}-\d{2}$/.test(String(p.quoteDate || '')) ? p.quoteDate : null,
    poNumber: ourPoNumber(p.poNumber) || ourPoNumber(m.subject, m.text),
    lines: (Array.isArray(p.lines) ? p.lines : [])
      .map(l => ({
        code: String(l?.code || '').trim().slice(0, 40),
        description: String(l?.description || '').trim().slice(0, 300),
        quantity: num(l?.quantity),
        unitPrice: num(l?.unitPrice)
      }))
      .filter(l => l.code || l.description),
    freight: num(p.freight) || 0,
    totalExGst: num(p.totalExGst),
    checks: (Array.isArray(p.checks) ? p.checks : []).map(c => String(c || '').trim()).filter(Boolean).slice(0, 6)
  }
}

/** Xero contacts that could be this supplier: by name, then by email domain. */
async function findSuppliers(name, email, xero) {
  const words = String(name || '').replace(/\b(pty|ltd|limited|australia|inc)\b/gi, '').trim().split(/\s+/).filter(w => w.length > 2)
  const tries = [...new Set([words.slice(0, 2).join(' '), words[0]].filter(Boolean))]
  for (const q of tries) {
    const data = await xero('GET', `/Contacts?summaryOnly=true&where=${encodeURIComponent(`Name.ToLower().Contains("${q.toLowerCase().replace(/["\\]/g, '')}")`)}`)
    const list = (data.Contacts || []).filter(c => c.ContactStatus !== 'ARCHIVED').map(c => ({ id: c.ContactID, name: c.Name }))
    if (list.length) return list.slice(0, 8)
  }
  const domain = String(email || '').split('@')[1]
  if (domain) {
    const data = await xero('GET', `/Contacts?summaryOnly=true&where=${encodeURIComponent(`EmailAddress!=null&&EmailAddress.ToLower().EndsWith("@${domain.toLowerCase()}")`)}`)
    return (data.Contacts || []).map(c => ({ id: c.ContactID, name: c.Name })).slice(0, 8)
  }
  return []
}

/**
 * One of our purchase orders by number, with its lines, or null.
 *
 * Xero's purchase-order list does not take a where filter, so the PO is
 * fetched by its number directly (GET /PurchaseOrders/{number}) — and the
 * answer is used only if it really is that number. A lookup that quietly
 * returned "the first PO" would have the save replace the wrong order's lines.
 */
export async function getPurchaseOrderByNumber(number, xero = xeroCall) {
  const want = ourPoNumber(number)
  if (!want) return null
  let data
  try { data = await xero('GET', `/PurchaseOrders/${encodeURIComponent(want)}`) } catch (err) {
    if (/not ?found|404/i.test(err.message)) return null
    throw err
  }
  const po = (data.PurchaseOrders || []).find(p => String(p.PurchaseOrderNumber).toUpperCase() === want)
  return po ? shapePo(po) : null
}

function shapePo(po) {
  return {
    id: po.PurchaseOrderID,
    number: po.PurchaseOrderNumber,
    status: po.Status,
    reference: po.Reference || '',
    contact: { id: po.Contact?.ContactID, name: po.Contact?.Name },
    date: po.DateString?.slice(0, 10) || null,
    subTotal: po.SubTotal, total: po.Total,
    lines: (po.LineItems || []).map(l => ({
      code: l.ItemCode || '', description: l.Description || '', quantity: l.Quantity, unitPrice: l.UnitAmount,
      accountCode: l.AccountCode || null, taxType: l.TaxType || null
    }))
  }
}

/** The PO lines Xero takes, from checked lines. Account and tax follow the PO being replaced, if any. */
export function poLines(lines = [], { accountCode = null, taxType = null, freight = 0 } = {}) {
  const out = lines
    .filter(l => l && (l.description || l.code))
    .map((l, n) => {
      const quantity = Number(l.quantity)
      const unit = Number(l.unitPrice)
      if (!(quantity > 0)) throw new Error(`Line ${n + 1} needs a quantity`)
      if (!Number.isFinite(unit) || unit < 0 || String(l.unitPrice ?? '').trim() === '') throw new Error(`Line ${n + 1} needs a price`)
      return {
        Description: [l.code, l.description].filter(Boolean).join(' — ').slice(0, 4000),
        Quantity: quantity,
        UnitAmount: Math.round(unit * 100) / 100,
        ...(accountCode ? { AccountCode: accountCode } : {}),
        ...(taxType ? { TaxType: taxType } : {})
      }
    })
  if (Number(freight) > 0) {
    out.push({ Description: 'Freight', Quantity: 1, UnitAmount: Math.round(Number(freight) * 100) / 100,
      ...(accountCode ? { AccountCode: accountCode } : {}), ...(taxType ? { TaxType: taxType } : {}) })
  }
  if (!out.length) throw new Error('Add at least one line')
  return out
}

/**
 * Saves the PO in Xero: `update` replaces the named PO's lines (never one
 * already billed, and its status is left as it is); otherwise a new DRAFT.
 * Remembers what was done with the email.
 */
export async function saveSupplierPo({ messageId, contactId, update, lines, freight = 0, reference = '', quoteNumber = '', by = '' }, xero = xeroCall) {
  if (!/^[A-Za-z0-9_-]{6,}$/.test(String(messageId || ''))) throw new Error('Which email?')
  const ref = [reference, quoteNumber ? `as per quote ${quoteNumber}` : ''].filter(Boolean).join(' — ').slice(0, 255)
  let saved
  if (update) {
    const existing = await getPurchaseOrderByNumber(update, xero)
    if (!existing || existing.number !== ourPoNumber(update)) throw new Error(`${update} could not be found in Xero, so nothing was changed`)
    // The PO being replaced must belong to the supplier the screen shows.
    if (contactId && existing.contact.id && existing.contact.id !== contactId) {
      throw new Error(`${update} is ${existing.contact.name}'s, not this supplier's, so it was not changed`)
    }
    if (['BILLED', 'DELETED'].includes(existing.status)) {
      throw Object.assign(new Error(`${update} is ${existing.status.toLowerCase()} in Xero, so it was not changed. Draft a new PO instead.`), { code: 'billed' })
    }
    const first = existing.lines[0] || {}
    const data = await xero('POST', `/PurchaseOrders/${existing.id}`, {
      PurchaseOrders: [{
        PurchaseOrderID: existing.id,
        Reference: [existing.reference.replace(/\s*—\s*as per quote .*$/i, ''), quoteNumber ? `as per quote ${quoteNumber}` : ''].filter(Boolean).join(' — ').slice(0, 255),
        LineAmountTypes: 'Exclusive',
        LineItems: poLines(lines, { accountCode: first.accountCode, taxType: first.taxType, freight })
      }]
    })
    saved = shapePo(data.PurchaseOrders?.[0] || {})
  } else {
    if (!contactId) throw new Error('Choose the supplier')
    const data = await xero('POST', '/PurchaseOrders', {
      PurchaseOrders: [{
        Contact: { ContactID: contactId },
        Date: new Date().toISOString().slice(0, 10),
        ...(ref ? { Reference: ref } : {}),
        LineAmountTypes: 'Exclusive',
        Status: 'DRAFT',
        LineItems: poLines(lines, { freight })
      }]
    })
    saved = shapePo(data.PurchaseOrders?.[0] || {})
  }
  const record = { status: update ? 'updated' : 'drafted', po: saved.number, poId: saved.id, total: saved.total, by, at: new Date().toISOString() }
  await redis('set', KEY(messageId), JSON.stringify(record)).catch(() => {})
  return { po: saved, record }
}

/** "Not a PO request" — remembered, so it is not offered again. */
export async function dismissSupplierQuote(messageId, by = '') {
  if (!/^[A-Za-z0-9_-]{6,}$/.test(String(messageId || ''))) throw new Error('Which email?')
  await redis('set', KEY(messageId), JSON.stringify({ status: 'dismissed', by, at: new Date().toISOString() }))
  return { ok: true }
}
