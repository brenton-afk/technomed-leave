import { searchMailboxOf, readMessageHeadline, listLabelsOf } from './_gmail.js'
import { PO_MAILBOX } from './_purchaseOrders.js'

// ─── What is in accounts@ for reconciling Calvary (Brent, 5 Nov 2026) ────────
// "Search through the accounts email and see if there are sufficient
// remittances from Calvary to reconcile that way… file the emails in the same
// filing format as Toni uses." Nobody but Toni can see that mailbox, so this
// reports — read-only — what Calvary has sent and where each message has been
// filed (its Gmail labels), so the filing can be copied exactly before
// anything is ever filed by the portal. Nothing here labels, moves or marks.

const REMITTANCE = /remit|payment\s*advice|eft\s*advice|advice\s*of\s*payment|payment\s*notification/i
const INV = /\bINV[-\s]?(\d{3,6})\b/gi

export function invoiceNumbersIn(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(INV)) out.add(`INV-${m[1]}`)
  return [...out]
}

/** Everything Calvary sent accounts@ in the window, sorted into kinds, with its labels. */
export async function accountsAudit({ days = 180, max = 50 } = {}) {
  const labels = await listLabelsOf(PO_MAILBOX)
  const name = new Map(labels.map(l => [l.id, l.name]))
  // Remittances searched for by themselves (a window of purchase orders alone
  // passes 50), plus the latest Calvary mail of any kind to see how it is filed.
  const [remitIds, recentIds] = await Promise.all([
    searchMailboxOf(PO_MAILBOX, `from:calvarycare.org.au (remittance OR remit OR "payment advice" OR EFT OR "advice of payment") newer_than:${days}d`, { max }),
    searchMailboxOf(PO_MAILBOX, `from:calvarycare.org.au newer_than:${days}d`, { max })
  ])
  const ids = [...new Set([...remitIds, ...recentIds])]
  const read = await Promise.all(ids.map(id => readMessageHeadline(PO_MAILBOX, id).catch(() => null)))
  const messages = read.filter(Boolean).map(m => {
    const files = m.attachments.map(a => a.filename).filter(Boolean)
    const kind = REMITTANCE.test(`${m.subject} ${files.join(' ')}`) ? 'remittance'
      : /purchase\s*order|\b[A-Z]{2}[HP]\d{7}\b/i.test(`${m.subject} ${files.join(' ')}`) ? 'purchase order' : 'other'
    return {
      id: m.id, kind, from: m.from, subject: m.subject, receivedAt: m.receivedAt, files,
      filedUnder: (m.labelIds || []).map(id => name.get(id)).filter(Boolean),
      inbox: (m.labelIds || []).includes('INBOX'),
      invoices: kind === 'remittance' ? invoiceNumbersIn(`${m.subject} ${files.join(' ')} ${m.text?.slice(0, 8000)}`) : []
    }
  })
  // How each kind is filed today — the format to copy.
  const filing = {}
  for (const m of messages) {
    filing[m.kind] = filing[m.kind] || {}
    for (const l of m.filedUnder.length ? m.filedUnder : ['(not filed)']) filing[m.kind][l] = (filing[m.kind][l] || 0) + 1
  }
  return {
    mailbox: PO_MAILBOX, days, labels: labels.map(l => l.name).sort(), filing,
    counts: messages.reduce((c, m) => ({ ...c, [m.kind]: (c[m.kind] || 0) + 1 }), {}),
    remittances: messages.filter(m => m.kind === 'remittance'),
    others: messages.filter(m => m.kind === 'other').map(({ id, subject, receivedAt, files, filedUnder }) => ({ id, subject, receivedAt, files, filedUnder }))
  }
}
