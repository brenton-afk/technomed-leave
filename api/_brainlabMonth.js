import { redis, redisSetBody } from './_redis.js'
import { getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY } from './_googleCalendar.js'
import { readBooking, isCancelled, plainDescription } from '../src/clinicalPlan/parse.js'
import { parseLabelledDescription, descriptionNotes } from '../src/clinicalPlan/labelledFields.js'
import { isDistributorEmail } from '../src/clinicalPlan/bookingSources.js'
import { sortMonth, monthBounds, invoiceReference } from '../src/clinicalPlan/brainlabBilling.js'
import { findContacts, createDraftInvoice, invoicesWithReference } from './_xeroAccounting.js'
import { todayStr, addCivilDays } from '../src/clinicalPlan/week.js'

// ─── The Brainlab invoice, from the bookings (Brent, 22 Nov 2026) ────────────
// Admin → Brainlab invoice. A month of the bookings calendar, sorted by
// sortMonth (src/clinicalPlan/brainlabBilling.js) into billed, No F2F, to
// answer and not billed; answers at month end kept per month in Redis
// (`brainlab:month:{YYYY-MM}`, one key); and, once nothing is left to
// answer, a DRAFT invoice to Brainlab Australia in the house format —
// reference "{MONTH} {YYYY} Clinical Support", one BLCS line per case. Never
// approved or sent from here; a month already invoiced is refused (the
// reference check in createDraftInvoice).

const QUERY_TZ = 'Australia/Melbourne'
const ITEM = process.env.BRAINLAB_ITEM_CODE || 'BLCS'
const CONTACT = process.env.BRAINLAB_CONTACT || 'Brainlab Australia'
const key = month => `brainlab:month:${month}`
export const validMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''))

/** The month's bookings, read the way the week reads them. */
export async function monthCases(month) {
  const { from, to } = monthBounds(month)
  const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getCalendarId())}/events`
    + `?timeMin=${encodeURIComponent(`${from}T00:00:00+11:00`)}`
    + `&timeMax=${encodeURIComponent(`${to}T23:59:59+10:00`)}`
    + '&singleEvents=true&orderBy=startTime&maxResults=2500'
    + `&timeZone=${encodeURIComponent(QUERY_TZ)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = await res.json()
  if (data.error) throw new Error(`The bookings calendar could not be read: ${data.error.message}`)
  return (data.items || [])
    .filter(e => !isDistributorEmail(e.organizer?.email))
    .map(e => {
      const description = plainDescription(e.description || '')
      const read = readBooking(e.summary || '', description, { knownPatient: e.extendedProperties?.private?.tmPatient || null })
      if (!read?.patient) return null
      const date = String(e.start?.dateTime || e.start?.date || '').slice(0, 10)
      if (date < from || date > to) return null
      const labelled = parseLabelledDescription(description)
      return {
        id: e.id,
        date,
        patient: read.patient,
        surgeon: read.surgeon || '',
        procedure: read.operation || labelled.procedure || '',
        hospital: read.hospital || e.location || '',
        kit: read.kit || labelled.kit || '',
        notes: descriptionNotes(description).join('\n'),
        brainlab: read.brainlab || labelled.brainlab || '',
        reps: read.reps || [],
        notRequired: Boolean(read.notRequired),
        cancelled: isCancelled(e.summary || '', e.description || '')
      }
    })
    .filter(Boolean)
}

export async function monthDecisions(month) {
  try { return JSON.parse(await redis('GET', key(month)) || '{}') || {} } catch { return {} }
}

/** The month, sorted, with what Xero already holds for it. */
export async function brainlabMonth(month) {
  if (!validMonth(month)) throw new Error('Which month?')
  const [cases, decisions] = await Promise.all([monthCases(month), monthDecisions(month)])
  const sorted = sortMonth(cases, decisions)
  const reference = invoiceReference(month)
  const invoiced = await invoicesWithReference(reference).catch(err => ({ error: err.message }))
  return { month, reference, ...sorted, invoiced }
}

/** An answer for one booking: { attended?: bool, kind?: 'airo'|'nav'|'none'|null }. */
export async function decide(month, id, change, by) {
  if (!validMonth(month) || !/^[A-Za-z0-9_-]{4,200}$/.test(String(id || ''))) throw new Error('Which booking?')
  const all = await monthDecisions(month)
  const next = { ...(all[id] || {}) }
  if ('attended' in change) {
    if (change.attended === null) delete next.attended
    else next.attended = Boolean(change.attended)
  }
  if ('kind' in change) {
    if (change.kind === null) delete next.kind
    else if (['airo', 'nav', 'none'].includes(change.kind)) next.kind = change.kind
    else throw new Error('AIRO, Navigation or Not billed')
  }
  next.by = by; next.at = new Date().toISOString()
  all[id] = next
  await redisSetBody(key(month), JSON.stringify(all))
  return all
}

/** The DRAFT invoice in Xero. Refused while anything is left to answer. */
export async function draftBrainlabInvoice(month, by) {
  const m = await brainlabMonth(month)
  if (m.ask.length) throw Object.assign(new Error(`${m.ask.length} case${m.ask.length === 1 ? '' : 's'} still to answer`), { code: 'unanswered' })
  if (!m.bill.length) throw new Error('Nothing to bill this month')
  const contact = (await findContacts(CONTACT)).find(c => /brain\s*lab/i.test(c.name))
  if (!contact) throw new Error(`No Xero contact named like "${CONTACT}"`)
  const today = todayStr()
  const invoice = await createDraftInvoice({
    contactId: contact.id,
    reference: m.reference,
    date: today,
    dueDate: addCivilDays(today, 30),
    lines: m.bill.map(r => ({ code: ITEM, description: r.line, quantity: 1, unitPrice: r.amount }))
  })
  await redisSetBody(`brainlab:invoiced:${month}`, JSON.stringify({ ...invoice, by, at: new Date().toISOString(), cases: m.bill.map(r => r.id), net: m.net }))
  return { invoice, net: m.net, lines: m.bill.length }
}
