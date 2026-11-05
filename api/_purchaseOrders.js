import { searchMailboxOf, readMessageHeadline, readAttachment, sniffMediaType } from './_gmail.js'
import { askClaude } from './_anthropic.js'

// ─── Calvary's purchase orders, from accounts@ (Brent, 5 Nov 2026) ───────────
// Read-only, through the same domain-wide Gmail grant that reads bookings@:
// nothing here sends, deletes, labels or marks anything read. It searches
// narrowly — Calvary's domain, with an attachment — and only an admin can ask.
// Calvary's numbers look like LVH0012240 — nearly every invoice in Xero carries
// one of those as its reference — and LVP0005413; older ones ACP0000294.

export const PO_MAILBOX = process.env.PO_MAILBOX || 'accounts@technomed.com.au'
export const PO_QUERY = process.env.PO_QUERY
  || 'from:calvarycare.org.au has:attachment newer_than:120d'

const MODEL = process.env.PO_VISION_MODEL || 'claude-opus-5'
// Two letters for the site, H or P, seven digits (LVH0012240, LVP0005413);
// and the older forms. A bare "PO 12345" is accepted only with the space or dash.
const PO_NUMBER = /(?<![A-Za-z0-9])(?:[A-Z]{2}[HP]\d{7}|(?:ACP|CLV)\d{5,}|(?:LV[HP]|ACP|CLV|PO)[-\s]\d{5,})(?![0-9])/i

/** A PO number in a subject, file name or text, or ''. */
export function poNumberIn(...texts) {
  for (const t of texts) {
    const m = PO_NUMBER.exec(String(t || ''))
    if (m) return m[0].replace(/[-\s]/g, '').toUpperCase()
  }
  return ''
}

/** The purchase orders waiting in accounts@, newest first. */
export async function listPurchaseOrders({ max = 40 } = {}) {
  const ids = await searchMailboxOf(PO_MAILBOX, PO_QUERY, { max })
  const read = await Promise.all(ids.map(id => readMessageHeadline(PO_MAILBOX, id).catch(() => null)))
  const out = []
  for (const m of read) {
    if (!m) continue // one unreadable message is not the list
    const files = m.attachments.map(a => a.filename).filter(Boolean)
    const poNumber = poNumberIn(m.subject, ...files, m.text?.slice(0, 2000))
    // Only what looks like an order: a PO number, or the words for one.
    if (!poNumber && !/purchase\s*order|\bP\.?O\.?\b/i.test(`${m.subject} ${files.join(' ')}`)) continue
    out.push({ id: m.id, from: m.from, subject: m.subject, receivedAt: m.receivedAt, poNumber, files })
  }
  return out.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
}

/**
 * Which PO numbers Xero has already invoiced: Map of PO number → invoices.
 * The PO number is found in each invoice's Reference the same way it is found
 * in an email, so "LVH0012240", "PO LVH0012240" and "lvh0012240 – Jackson
 * kits" all count as that PO.
 */
export function invoicedByPo(invoices = []) {
  const map = new Map()
  for (const inv of invoices) {
    if (['VOIDED', 'DELETED'].includes(inv.status)) continue
    const po = poNumberIn(inv.reference)
    if (!po) continue
    if (!map.has(po)) map.set(po, [])
    map.get(po).push({ number: inv.number, status: inv.status })
  }
  return map
}

/**
 * The purchase orders split three ways, for a screen that offers only what is
 * waiting to be invoiced:
 *   outstanding — a PO number Xero has no invoice for (the only ones offered)
 *   invoiced    — already on an invoice in Xero
 *   noNumber    — no PO number could be read; a person checks these by hand
 * The same PO sent more than once (Calvary resend and amend) is one order, the
 * newest email, with `copies` saying how many arrived. With `invoiced` null —
 * Xero could not be asked — nothing is outstanding: it is `unchecked`, because
 * offering a PO that may already be invoiced is the mistake this screen is
 * here to prevent.
 */
export function splitOrders(orders = [], invoiced = null) {
  const byPo = new Map()
  const noNumber = []
  for (const o of orders) {
    if (!o.poNumber) { noNumber.push(o); continue }
    const seen = byPo.get(o.poNumber)
    if (seen) { seen.copies++; continue }
    byPo.set(o.poNumber, { ...o, copies: 1 })
  }
  const numbered = [...byPo.values()]
  if (!invoiced) return { outstanding: [], invoiced: [], noNumber, unchecked: numbered }
  const out = { outstanding: [], invoiced: [], noNumber, unchecked: [] }
  for (const o of numbered) {
    const invoices = invoiced.get(o.poNumber)
    if (invoices?.length) out.invoiced.push({ ...o, invoices })
    else out.outstanding.push({ ...o, invoices: [] })
  }
  return out
}

const PROMPT = `This is a purchase order from a hospital to TechnoMed, a medical device distributor.
Read it and reply with JSON only, in this shape:
{"poNumber": "", "date": "YYYY-MM-DD", "deliverTo": "", "requestedBy": "", "reference": "",
 "lines": [{"code": "", "description": "", "quantity": 0, "unitPrice": 0, "xeroCode": ""}],
 "totalExGst": 0, "notes": ""}
- code: the product or catalogue code as written for TechnoMed's product (not the hospital's internal stock number, if both are shown).
- unitPrice: excluding GST, as a number; 0 if the order shows none.
- xeroCode: the code of the TechnoMed product below that this line is — matched on what the product is
  (type, size, pack), not on wording alone. "" if none of them is clearly the same product. Never guess.
- reference: any case, patient record or cost-centre reference the order asks to be quoted on the invoice — copied exactly.
- Leave out anything not on the order. Do not invent a line, a code or a price.`

/** The catalogue the reader matches lines against: "code — name" per line. */
export function catalogueText(items = []) {
  return items.filter(i => i.code).map(i => `${i.code} — ${i.name}`).join('\n').slice(0, 30000)
}

/**
 * One purchase order read into lines. With `items` (Xero's products), each
 * line also carries the Xero code the reader matched it to — checked against
 * the catalogue by the caller, never trusted on its own.
 */
export async function readPurchaseOrder(id, { items = [] } = {}) {
  const m = await readMessageHeadline(PO_MAILBOX, id)
  const content = []
  for (const a of m.attachments) {
    if (!a.attachmentId) continue
    const { data } = await readAttachment(PO_MAILBOX, id, a.attachmentId)
    const type = sniffMediaType(data, a.mediaType || '')
    if (type === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: type, data } })
    else if (/^image\/(png|jpeg|webp|gif)$/.test(type) && data.length * 0.75 > 20_000) {
      content.push({ type: 'image', source: { type: 'base64', media_type: type, data } })
    }
  }
  if (m.text) content.push({ type: 'text', text: `The email itself:\n\n${m.text.slice(0, 6000)}` })
  if (!content.length) throw new Error('That email has no order attached to read')
  content.push({ type: 'text', text: PROMPT + (items.length
    ? `\n\nTechnoMed's products (code — name):\n${catalogueText(items)}`
    : '\n\nNo product list is available: leave xeroCode "".') })

  const reply = await askClaude({
    feature: 'purchase-order',
    whenUnavailable: 'The purchase order could not be read automatically — open it and enter the lines by hand.',
    timeoutMs: 40000,
    request: { model: MODEL, max_tokens: 4000, thinking: { type: 'adaptive' }, messages: [{ role: 'user', content }] }
  })
  const text = reply.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const json = /\{[\s\S]*\}/.exec(text)
  let parsed = {}
  try { parsed = json ? JSON.parse(json[0]) : {} } catch { parsed = {} }
  return cleanOrder(parsed, m)
}

/** The model's reading, tidied and typed, with the PO number from the email as a fallback. */
export function cleanOrder(parsed = {}, message = {}) {
  const num = v => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0 }
  const lines = (Array.isArray(parsed.lines) ? parsed.lines : []).map(l => ({
    code: String(l?.code || '').trim().slice(0, 60),
    description: String(l?.description || '').trim().slice(0, 300),
    quantity: num(l?.quantity) || 1,
    unitPrice: num(l?.unitPrice),
    xeroCode: String(l?.xeroCode || '').trim().slice(0, 60)
  })).filter(l => l.code || l.description)
  return {
    messageId: message.id || null,
    poNumber: String(parsed.poNumber || '').trim() || poNumberIn(message.subject, ...(message.attachments || []).map(a => a.filename)),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || '')) ? parsed.date : '',
    deliverTo: String(parsed.deliverTo || '').slice(0, 200),
    requestedBy: String(parsed.requestedBy || '').slice(0, 120),
    reference: String(parsed.reference || '').slice(0, 120),
    lines,
    totalExGst: num(parsed.totalExGst),
    notes: String(parsed.notes || '').slice(0, 500)
  }
}
