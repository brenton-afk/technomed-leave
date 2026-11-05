import { searchMailboxOf, readMessageHeadline } from './_gmail.js'

// ─── Self-funding quote requests from CNS (Brent, 5 Nov 2026) ────────────────
// "CNS would ordinarily send to bookings and cc me … You need to check both
// Bookings and brenton@ for quotes." Read-only, a narrow search (CNS's own
// domains *and* quote wording) in each mailbox, and the same email arriving in
// both counted once — by its Message-ID, else subject + sender + minute.

export const QUOTE_MAILBOXES = (process.env.QUOTE_MAILBOXES || 'bookings@technomed.com.au,brenton@technomed.com.au')
  .split(',').map(s => s.trim()).filter(Boolean)
const QUERY = process.env.QUOTE_QUERY
  || 'from:(cnstas.com.au OR tasmanianspineservice.com.au) (quote OR quotation OR uninsured OR "self funding" OR "self-funding" OR "self funded") -in:sent newer_than:60d'

const MBS = /\b5\d{4}\b/g
const LEVEL = /\b([CTLS]\d{1,2})\s*[/-]\s*([CTLS]?\d{1,2})\b/i

/** The facts a quote is built from, read from the email itself — never guessed. */
export function readRequest(m) {
  const text = `${m.subject || ''}\n${m.text || ''}`
  const level = LEVEL.exec(text)
  return {
    mbs: [...new Set(text.match(MBS) || [])],
    levels: level ? `${level[1].toUpperCase()}/${level[2].toUpperCase().replace(/^[CTLS]/, '')}` : '',
    uninsured: /uninsured|self[\s-]*fund/i.test(text)
  }
}

export function dedupe(messages) {
  const seen = new Map()
  for (const m of messages) {
    const key = m.messageId || `${m.subject}|${m.from}|${String(m.receivedAt).slice(0, 16)}`
    const had = seen.get(key)
    if (had) { had.mailboxes = [...new Set([...had.mailboxes, m.mailbox])]; continue }
    seen.set(key, { ...m, mailboxes: [m.mailbox] })
  }
  return [...seen.values()].sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
}

export async function listQuoteRequests({ max = 20 } = {}) {
  const found = []
  const errors = []
  await Promise.all(QUOTE_MAILBOXES.map(async mailbox => {
    try {
      const ids = await searchMailboxOf(mailbox, QUERY, { max })
      const read = await Promise.all(ids.map(id => readMessageHeadline(mailbox, id).catch(() => null)))
      for (const m of read.filter(Boolean)) found.push(m)
    } catch (err) { errors.push({ mailbox, error: err.message }) }
  }))
  return {
    requests: dedupe(found).map(m => ({
      id: m.id, mailbox: m.mailbox, mailboxes: m.mailboxes, from: m.from, subject: m.subject,
      receivedAt: m.receivedAt, ...readRequest(m), text: String(m.text || '').slice(0, 1500)
    })),
    errors
  }
}
