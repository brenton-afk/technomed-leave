import { getXeroToken } from './_xeroClient.js'
import { readXero } from './_xeroResponse.js'

// ─── Invoices and quotes in Xero (Brent, 5 Nov 2026) ─────────────────────────
// "Build it into the admin portal as an invoice/quote generator." Calvary's
// purchase orders arrive in accounts@; the portal reads one, and an admin
// turns it into an invoice — or writes a quote from nothing.
//
// Drafts only, and only on a person's tap. Nothing here approves, sends or
// emails anything from Xero: the invoice waits in Xero as a draft for whoever
// does accounts to check and approve. And a purchase order is invoiced once —
// before creating one, Xero is asked for an invoice already carrying that PO
// number as its reference, and if there is one, nothing is created.
//
// Same Xero app and tokens as payroll (_xeroClient.js), with the invoicing
// permissions added by the separate "Allow invoices" connection
// (api/xero/connect.js?invoices=1) — so leave and timesheets are never put at
// risk by asking for them.

const API = 'https://api.xero.com/api.xro/2.0'

/** The permissions invoicing needs, added to payroll's when connecting for it. */
export const INVOICE_SCOPES = (process.env.XERO_INVOICE_SCOPES
  || 'accounting.invoices accounting.contacts.read accounting.settings.read').split(/[\s,]+/).filter(Boolean)

/** Said in place of Xero's 401/403, which mean the permission was never given. */
export const NEEDS_PERMISSION = 'Xero has not been given permission for invoices yet. '
  + 'An admin taps "Allow invoices" in Admin → Invoices to connect it.'

async function call(method, path, body) {
  const { token, tenantId } = await getXeroToken()
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const { ok, status, data, error } = await readXero(res, 'Xero')
  if (status === 401 || status === 403) throw Object.assign(new Error(NEEDS_PERMISSION), { code: 'permission' })
  if (!ok) throw new Error(error)
  return data
}

const quoted = s => String(s || '').replace(/["\\]/g, '')

/** Customers whose name contains `search`: [{ id, name }]. */
export async function findContacts(search) {
  const where = search ? `&where=${encodeURIComponent(`Name.Contains("${quoted(search)}")`)}` : ''
  const data = await call('GET', `/Contacts?summaryOnly=true&order=Name${where}`)
  return (data.Contacts || [])
    .filter(c => c.ContactStatus !== 'ARCHIVED')
    .map(c => ({ id: c.ContactID, name: c.Name }))
}

/** The products set up in Xero, with their sale price: [{ code, name, price }]. */
export async function listItems() {
  const data = await call('GET', '/Items')
  return (data.Items || []).map(i => ({
    code: i.Code,
    name: i.Name || i.Description || i.Code,
    description: i.Description || i.Name || '',
    price: Number(i.SalesDetails?.UnitPrice ?? NaN)
  })).filter(i => i.code)
}

/**
 * Every sales invoice dated on or after `since` (YYYY-MM-DD), any status, as
 * { id, number, status, reference } — one paged read, so the PO list can be
 * checked against Xero in a single pass rather than a call per PO.
 */
export async function salesInvoicesSince(since, { maxPages = 20 } = {}) {
  const [y, m, d] = String(since).split('-').map(Number)
  const where = encodeURIComponent(`Type=="ACCREC" AND Date>=DateTime(${y},${m},${d})`)
  const out = []
  for (let page = 1; page <= maxPages; page++) {
    const data = await call('GET', `/Invoices?where=${where}&summaryOnly=true&page=${page}`)
    const got = data.Invoices || []
    for (const i of got) out.push({ id: i.InvoiceID, number: i.InvoiceNumber, status: i.Status, reference: i.Reference || '' })
    if (got.length < 100) break
  }
  return out
}

/** Invoices whose reference contains this PO number, not voided or deleted. */
export async function invoicesWithReference(reference) {
  if (!reference) return []
  const where = encodeURIComponent(`Type=="ACCREC" AND Reference!=null AND Reference.Contains("${quoted(reference)}")`)
  const data = await call('GET', `/Invoices?where=${where}&summaryOnly=true`)
  return (data.Invoices || [])
    .filter(i => !['VOIDED', 'DELETED'].includes(i.Status))
    .map(i => ({ id: i.InvoiceID, number: i.InvoiceNumber, status: i.Status, total: i.Total }))
}

/**
 * A PO's or a quote's lines, as Xero line items.
 *
 * A code that is a Xero item is sent as the item, so Xero brings its own
 * account and tax; one that is not is kept in the description, so nothing on
 * the purchase order is lost. Quantities and prices are numbers or the line is
 * refused — an invoice with a blank price is a question, not a draft.
 */
export function lineItems(lines = [], items = [], accountCode = null) {
  // A line that is not a Xero item needs an account, or Xero refuses it.
  const account = /^[A-Za-z0-9.-]{1,10}$/.test(String(accountCode || '')) ? String(accountCode) : null
  const known = new Map(items.map(i => [String(i.code).toUpperCase(), i]))
  return lines
    .filter(l => l && (l.description || l.code))
    .map((l, n) => {
      const quantity = Number(l.quantity)
      const blank = l.unitPrice === null || l.unitPrice === undefined || String(l.unitPrice).trim() === ''
      const unit = blank ? NaN : Number(l.unitPrice)
      if (!(quantity > 0)) throw new Error(`Line ${n + 1} needs a quantity`)
      const discount = Number(l.discount) || 0
      if (discount < 0 || discount > 100) throw new Error(`Line ${n + 1}: the discount must be 0 to 100%`)
      if (!Number.isFinite(unit) || unit < 0) throw new Error(`Line ${n + 1} needs a price`)
      const item = (l.xeroCode && known.get(String(l.xeroCode).toUpperCase())) || (l.code && known.get(String(l.code).toUpperCase()))
      return {
        ...(item ? { ItemCode: item.code } : {}),
        Description: item
          ? (l.description || item.description || item.name)
          : [l.code, l.description].filter(Boolean).join(' — '),
        Quantity: quantity,
        UnitAmount: Math.round(unit * 100) / 100,
        ...(!item && account ? { AccountCode: account } : {}),
        ...(discount > 0 ? { DiscountRate: discount } : {})
      }
    })
}

/** A draft sales invoice. Refuses a PO number already invoiced. */
export async function createDraftInvoice({ contactId, reference, date, dueDate, lines, accountCode }) {
  if (!contactId) throw new Error('Choose who the invoice is for')
  const already = await invoicesWithReference(reference)
  if (already.length) {
    throw Object.assign(new Error(`Already invoiced: ${already.map(i => `${i.number || 'draft'} (${i.status})`).join(', ')}. Nothing was created.`), { code: 'duplicate', existing: already })
  }
  const LineItems = lineItems(lines, await listItems().catch(() => []), accountCode)
  if (!LineItems.length) throw new Error('Add at least one line')
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('The due date is not a date')
  const data = await call('POST', '/Invoices', {
    Invoices: [{
      Type: 'ACCREC',
      Contact: { ContactID: contactId },
      ...(reference ? { Reference: String(reference).slice(0, 255) } : {}),
      ...(date ? { Date: date } : {}),
      ...(dueDate ? { DueDate: dueDate } : {}),
      LineAmountTypes: 'Exclusive',
      Status: 'DRAFT',
      LineItems
    }]
  })
  const made = data.Invoices?.[0] || {}
  return { id: made.InvoiceID, number: made.InvoiceNumber, total: made.Total, status: made.Status }
}

/**
 * The quotes kept as templates (Brent's self-funding procedure, May 2024:
 * "Use draft templates in Xero to create a new draft") — every quote for the
 * contact named like "DRAFT QUOTE TEMPLATE", with its lines. Read-only.
 */
export async function quoteTemplates(contactName = process.env.QUOTE_TEMPLATE_CONTACT || 'DRAFT QUOTE TEMPLATE') {
  return quotesFor(contactName)
}

/** Every quote for the contact(s) named like `contactName`, with lines. */
export async function quotesFor(contactName) {
  const contacts = (await findContacts(contactName)).filter(c => c.name.toLowerCase().includes(contactName.toLowerCase()))
  const out = []
  for (const c of contacts) {
    for (let page = 1; page <= 10; page++) {
      const data = await call('GET', `/Quotes?ContactID=${encodeURIComponent(c.id)}&page=${page}`)
      const got = data.Quotes || []
      for (const q of got) {
        out.push({
          id: q.QuoteID, number: q.QuoteNumber, status: q.Status, title: q.Title || '', summary: q.Summary || '',
          reference: q.Reference || '', total: q.Total, date: String(q.DateString || q.Date || '').slice(0, 10),
          lines: (q.LineItems || []).map(l => ({
            code: l.ItemCode || '', description: l.Description || '', quantity: l.Quantity,
            unitPrice: l.UnitAmount, discount: l.DiscountRate || 0
          }))
        })
      }
      if (got.length < 100) break
    }
  }
  return out
}

/** One quote as Xero has it now: status, number, contact and lines. */
export async function getQuote(id) {
  const data = await call('GET', `/Quotes/${encodeURIComponent(id)}`)
  const q = data.Quotes?.[0]
  if (!q) return null
  return {
    id: q.QuoteID, number: q.QuoteNumber, status: q.Status, title: q.Title || '', summary: q.Summary || '',
    reference: q.Reference || '', total: q.Total,
    lines: (q.LineItems || []).map(l => ({ code: l.ItemCode || '', description: l.Description || '', quantity: l.Quantity, unitPrice: l.UnitAmount, discount: l.DiscountRate || 0 }))
  }
}

/** The quote as the PDF Xero would send — base64. */
export async function quotePdf(id) {
  const { token, tenantId } = await getXeroToken()
  const res = await fetch(`${API}/Quotes/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/pdf' }
  })
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(NEEDS_PERMISSION), { code: 'permission' })
  if (!res.ok) throw new Error(`Xero would not give the quote PDF (${res.status})`)
  return Buffer.from(await res.arrayBuffer()).toString('base64')
}

/** A draft quote. */
export async function createDraftQuote({ contactId, reference, title, summary, date, expiryDate, lines }) {
  if (!contactId) throw new Error('Choose who the quote is for')
  const LineItems = lineItems(lines, await listItems().catch(() => []))
  if (!LineItems.length) throw new Error('Add at least one line')
  const data = await call('POST', '/Quotes', {
    Quotes: [{
      Contact: { ContactID: contactId },
      Date: date || new Date().toISOString().slice(0, 10),
      ...(expiryDate ? { ExpiryDate: expiryDate } : {}),
      ...(reference ? { Reference: String(reference).slice(0, 255) } : {}),
      ...(title ? { Title: String(title).slice(0, 100) } : {}),
      ...(summary ? { Summary: String(summary).slice(0, 3000) } : {}),
      LineAmountTypes: 'EXCLUSIVE',
      Status: 'DRAFT',
      LineItems
    }]
  })
  const made = data.Quotes?.[0] || {}
  return { id: made.QuoteID, number: made.QuoteNumber, total: made.Total, status: made.Status }
}
