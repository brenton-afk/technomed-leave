import { redis, redisSetBody } from './_redis.js'
import { readBooking, detectHospital } from '../src/clinicalPlan/parse.js'
import { systemsInKit } from '../src/clinicalPlan/systems.js'
import { inventoryFor } from '../src/clinicalPlan/inventory.js'
import { escapeHtml } from './_email.js'

// ─── Telling suppliers about bookings (Tasks 8 and 9) ────────────────────────
// "Signus bookings, and KT Medical bookings at RHH, must be emailed to Signus
// and KT when added to the calendar. Reschedules and cancellations must be
// sent too." — Toni, who sends them by hand today.
//
// Rules, not code: a supplier, an optional hospital, the events that trigger
// it, and whether it may go without a person looking. All of it, and the
// contacts, live in Redis and are edited in Admin → Notices. What is written
// here is only the first copy, used until somebody saves their own.
//
// Every notice is shown before it is sent unless its rule says otherwise, and
// the text sent is the text stored at preview — the client confirms an id, it
// never supplies the words.
//
// Device Technologies are deliberately not on any rule: they asked not to get
// booking notices, which they read as loan requests (see _distributors.js).

const KEY = 'notices:settings'

// Confirmed by Brent (PORTAL_FIXES.md, 1 Nov 2026) and, for the rest, the
// addresses the team already writes to, read from the bookings mailbox.
export const DEFAULT_CONTACTS = [
  { id: 'signus', name: 'Signus', note: 'Jasper Hanson, prosthesis and stock control', to: ['jhanson@signus.com.au'], cc: ['apolites@signus.com.au'] },
  { id: 'kt', name: 'KT Medical', note: 'Firebird, Lonestar, Forza, connectors',
    to: ['kt@ktmedical.com.au'], cc: ['ben@ktmedical.com.au'] },
  { id: 'kt_allograft', name: 'KT allograft usage (DTBV / CBM / DBM)',
    to: ['allograft@ktmedical.com.au'], cc: ['dtbvutilization@vifm.org'] },
  { id: 'neurophys', name: 'Neurophysiology (Neurophys)',
    to: ['info@neurophys.com.au'], cc: ['territorymgrs@neurophys.com.au'] },
  { id: 'e4', name: 'E4 Surgical', to: ['bookings@e4surgical.com'], cc: ['e4@e4surgical.com', 'eland@e4surgical.com'] },
  { id: 'globus', name: 'Globus / NuVasive',
    to: ['vicdistribution@globusmedical.com', 'jlagoon@globusmedical.com'], cc: ['cmckenzie@globusmedical.com', 'mlyfordpike@globusmedical.com'] },
  { id: 'device', name: 'Device Technologies (loan requests only — no booking notices)',
    to: ['DL_VICLoans@device.com.au'], cc: ['asherhammond@device.com.au', 'kwatson@device.com.au', 'dl_spine_marketing@device.com.au'] }
]

export const EVENTS = ['new', 'changed', 'moved', 'cancelled']

export const DEFAULT_RULES = [
  { id: 'signus-all', contactId: 'signus', distributor: 'signus', hospital: '', events: EVENTS, autoSend: false },
  { id: 'kt-rhh', contactId: 'kt', distributor: 'kt', hospital: 'RHH', events: EVENTS, autoSend: false }
]

export async function getNoticeSettings() {
  try {
    const raw = await redis('get', KEY)
    const saved = raw ? JSON.parse(raw) : null
    if (saved?.contacts && saved?.rules) return saved
  } catch { /* fall through to the first copy */ }
  return { contacts: DEFAULT_CONTACTS, rules: DEFAULT_RULES }
}

const isEmail = v => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(String(v || '').trim())

/** Checks and stores edited settings. Throws a sentence on anything malformed. */
export async function saveNoticeSettings({ contacts, rules }) {
  if (!Array.isArray(contacts) || !Array.isArray(rules)) throw new Error('Contacts and rules are both needed')
  const cleanContacts = contacts.map(c => {
    const to = (c.to || []).map(String).map(s => s.trim()).filter(Boolean)
    const cc = (c.cc || []).map(String).map(s => s.trim()).filter(Boolean)
    if (!c.id || !c.name) throw new Error('Every contact needs a name')
    if (!to.length) throw new Error(`${c.name} needs at least one address to send to`)
    for (const a of [...to, ...cc]) if (!isEmail(a)) throw new Error(`"${a}" is not an email address`)
    return { id: String(c.id), name: String(c.name).slice(0, 80), note: String(c.note || '').slice(0, 120), to, cc }
  })
  const ids = new Set(cleanContacts.map(c => c.id))
  const cleanRules = rules.map(r => {
    if (!ids.has(r.contactId)) throw new Error('A rule names a contact that does not exist')
    return {
      id: String(r.id), contactId: String(r.contactId), distributor: String(r.distributor || ''),
      hospital: ['RHH', 'CLV', ''].includes(r.hospital) ? r.hospital : '',
      events: (r.events || []).filter(e => EVENTS.includes(e)),
      autoSend: Boolean(r.autoSend)
    }
  })
  const settings = { contacts: cleanContacts, rules: cleanRules }
  await redisSetBody(KEY, JSON.stringify(settings))
  return settings
}

/** The booking, as the notice describes it. */
export function describeBooking(event) {
  if (!event) return null
  const read = readBooking(event.summary || '', event.description || '',
    { knownPatient: event.extendedProperties?.private?.tmPatient }) || {}
  const kit = [read.system, read.kit].filter(Boolean).join(' ')
  return {
    date: String(event.start?.dateTime || event.start?.date || event.start || '').slice(0, 10),
    hospital: read.hospital || detectHospital(event.location, event.description, { caseEvent: true }) || '',
    surgeon: read.surgeon || '',
    patient: read.patient || '',
    procedure: read.operation || '',
    kit,
    distributors: [...new Set(systemsInKit(`${kit} ${event.summary || ''}`)
      .map(s => inventoryFor(s)?.distributor).filter(Boolean))]
  }
}

const FIELDS = [['date', 'Date'], ['hospital', 'Hospital'], ['surgeon', 'Surgeon'], ['procedure', 'Procedure'], ['kit', 'Kit']]

/** What changed between two readings, field by field. */
export function changesBetween(before, after) {
  if (!before || !after) return []
  return FIELDS
    .filter(([key]) => String(before[key] || '') !== String(after[key] || ''))
    .map(([key, label]) => ({ key, label, was: before[key] || '—', now: after[key] || '—' }))
}

function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : String(iso || '')
}

const WORD = { new: 'New booking', changed: 'Booking changed', moved: 'Booking moved', cancelled: 'Booking cancelled' }

/**
 * The notices one booking event calls for, fully written.
 *
 * The surname goes in because suppliers identify cases by it — "Pt Clegg
 * (Ascot)" is how the team already writes to them — and nothing else about
 * the patient ever does.
 */
export function noticesFor({ kind, before, after, eventId, settings }) {
  const subject = kind === 'cancelled' ? (before || after) : after
  if (!subject) return []
  const changes = kind === 'new' || kind === 'cancelled' ? [] : changesBetween(before, after)
  // A save that changed nothing a supplier cares about — notes, the rep, the
  // colour — is not news to them.
  if ((kind === 'changed' || kind === 'moved') && !changes.length) return []

  const ref = `TM-${String(eventId || '').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}`
  const contacts = new Map(settings.contacts.map(c => [c.id, c]))
  const out = []
  for (const rule of settings.rules) {
    if (!rule.events.includes(kind)) continue
    const relevant = [before, after].filter(Boolean)
    const has = relevant.some(b => b.distributors.includes(rule.distributor))
    const atHospital = !rule.hospital || relevant.some(b => b.hospital === rule.hospital)
    if (!has || !atHospital) continue
    const contact = contacts.get(rule.contactId)
    if (!contact) continue

    const title = `${WORD[kind]} — ${subject.patient || 'patient TBC'} ${shortDate(subject.date)} ${subject.hospital} — Ref ${ref}`
    const rows = FIELDS.map(([key, label]) => [label, key === 'date' ? shortDate(subject[key]) : subject[key]])
      .concat([['Patient', subject.patient || 'To be confirmed']])
    const changeLines = changes.map(c => `${c.label}: ${c.key === 'date' ? shortDate(c.was) : c.was} → ${c.key === 'date' ? shortDate(c.now) : c.now}`)
    const text = [
      `Hi ${contact.name.split(/[\s(/]/)[0]} team,`, '',
      kind === 'cancelled' ? 'This booking has been cancelled.'
        : kind === 'new' ? 'A new case has been booked.' : 'This booking has changed.',
      ...(changeLines.length ? ['', ...changeLines] : []),
      '', ...rows.map(([l, v]) => `${l}: ${v || '—'}`),
      '', `Reference: ${ref}`, '', 'TechnoMed'
    ].join('\n')
    const html = `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#042746">
<p>Hi ${escapeHtml(contact.name.split(/[\s(/]/)[0])} team,</p>
<p>${kind === 'cancelled' ? 'This booking has been <strong>cancelled</strong>.' : kind === 'new' ? 'A new case has been booked.' : 'This booking has changed.'}</p>
${changeLines.length ? `<ul>${changeLines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}
<table cellpadding="6" style="border-collapse:collapse">${rows.map(([l, v]) =>
  `<tr><td style="color:#6b7a8d">${escapeHtml(l)}</td><td><strong>${escapeHtml(v || '—')}</strong></td></tr>`).join('')}</table>
<p style="color:#6b7a8d">Reference: ${ref}</p><p>TechnoMed</p></div>`
    out.push({ ruleId: rule.id, contactId: contact.id, name: contact.name, to: contact.to, cc: contact.cc,
      subject: title, text, html, autoSend: rule.autoSend, eventId, kind })
  }
  return out
}

// ─── Held for confirmation ──────────────────────────────────────────────────
// Stored for a day under an id the client gets back. Confirming sends exactly
// what was shown; an id that has expired or been used sends nothing.

export async function holdNotice(notice) {
  const id = `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await redisSetBody(`notice:pending:${id}`, JSON.stringify(notice))
  await redis('expire', `notice:pending:${id}`, '86400').catch(() => {})
  return id
}

export async function takeNotice(id) {
  if (!/^n_[a-z0-9]+_[a-z0-9]+$/.test(String(id || ''))) return null
  const raw = await redis('get', `notice:pending:${id}`)
  if (!raw) return null
  await redis('del', `notice:pending:${id}`)
  try { return JSON.parse(raw) } catch { return null }
}

/** Preview for the client: who and what, without anything it could alter. */
export function previewOf(notice, id) {
  return { id, name: notice.name, to: notice.to, cc: notice.cc, subject: notice.subject, text: notice.text }
}
