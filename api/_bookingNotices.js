import { redis, redisSetBody } from './_redis.js'
import { readBooking, detectHospital } from '../src/clinicalPlan/parse.js'
import { systemsInKit } from '../src/clinicalPlan/systems.js'
import { inventoryFor, kitArrivalBy, isRush, suggestSupply } from '../src/clinicalPlan/inventory.js'
import { parseKitSupplies } from '../src/clinicalPlan/kitSupply.js'
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
  { id: 'signus', name: 'Signus', note: 'Jasper Hanson, prosthesis and stock control', to: ['J.Hanson@signus.com.au'], cc: ['A.Polites@signus.com.au'] },
  { id: 'kt', name: 'KT Medical', note: 'Firebird, Lonestar, Forza, connectors',
    to: ['kt@ktmedical.com.au'], cc: ['ben@ktmedical.com.au'] },
  { id: 'kt_allograft', name: 'KT allograft usage (DTBV / CBM / DBM)',
    to: ['allograft@ktmedical.com.au'], cc: ['dtbv.utilization@vifm.org'] },
  { id: 'neurophys', name: 'Neurophysiology (Neurophys)',
    to: ['info@neurophys.com.au'], cc: ['territorymgrs@neurophys.com.au'] },
  { id: 'e4', name: 'E4 Surgical', to: ['bookings@e4surgical.com'], cc: ['e4@e4surgical.com', 'eland@e4surgical.com'] },
  { id: 'globus', name: 'Globus / NuVasive',
    to: ['victoriadistribution@globusmedical.com', 'jlagoon@globusmedical.com'], cc: ['cmckenzie@globusmedical.com', 'mlyfordpike@globusmedical.com'] },
  { id: 'device', name: 'Device Technologies (loan requests only — no booking notices)',
    to: ['DL_VICLoans@device.com.au'], cc: ['asher.hammond@device.com.au', 'dl_spine_marketing@device.com.au'] },
  // Kit room moves (see api/_kits.js). From the team's own transfer emails:
  // Calvary is Sharon plus the loan-sets mailbox, RHH is Katelin's
  // coordinator mailbox. `greeting` is how the email opens.
  { id: 'calvary_loans', name: 'Calvary loans team', greeting: 'Sharon and Loans team',
    note: 'Kit movements into or out of Calvary', to: ['Sharon.Ashworth@calvarycare.org.au', 'TAS-LVH-Loansets@calvarycare.org.au'], cc: [] },
  { id: 'rhh_loans', name: 'RHH loans coordinator', greeting: 'Katelin',
    note: 'Kit movements into or out of RHH', to: ['rhhcsdloancoordinator@ths.tas.gov.au'], cc: [] }
]

// Corrections to contacts already saved in Redis. A saved copy replaces the
// defaults above whole, so changing a default alone never reaches the live
// portal. Each runs once — recorded in `applied` — so an admin can still
// change the same contact afterwards without it being put back.
export const CONTACT_CORRECTIONS = [
  // Brent, 1 Nov 2026: "Kaye Maree Watson needed to be removed… We need Asher
  // and the other DL-Spine marketing email included."
  { id: 'device-2026-11-01', contactId: 'device',
    remove: ['kwatson@device.com.au'],
    addCc: ['asher.hammond@device.com.au', 'dl_spine_marketing@device.com.au'] },
  // The kit room's two hospital contacts, added to a copy saved before they
  // existed.
  { id: 'kit-hospitals-2026-11-01', addContacts: ['calvary_loans', 'rhh_loans'] },
  // Device loan requests on, in a copy saved while they were offered but off.
  { id: 'device-loans-on-2026-11-02', enableLoans: 'device' },
  // The Dubey neurophys rule, added to a copy saved before it existed.
  { id: 'neurophys-dubey-2026-11-04', addContacts: ['neurophys'], addRules: ['neurophys-dubey-clv'] },
  // Brent, 5 Nov 2026: "double check the email addresses for Jasper and
  // Amanda". The seed list had dropped the dots — every real email to and from
  // these people uses the dotted address (Jasper writes from J.Hanson@).
  { id: 'addresses-2026-11-05', replace: {
    'jhanson@signus.com.au': 'J.Hanson@signus.com.au',
    'apolites@signus.com.au': 'A.Polites@signus.com.au',
    'asherhammond@device.com.au': 'asher.hammond@device.com.au',
    'dtbvutilization@vifm.org': 'dtbv.utilization@vifm.org',
    'vicdistribution@globusmedical.com': 'victoriadistribution@globusmedical.com',
    'cmkenzie@globusmedical.com': 'cmckenzie@globusmedical.com'
  } }
]

/** Applies any correction not yet applied. Returns null when nothing changed. */
export function applyCorrections(saved) {
  const applied = new Set(saved.applied || [])
  const due = CONTACT_CORRECTIONS.filter(c => !applied.has(c.id))
  if (!due.length) return null
  const lower = v => String(v).trim().toLowerCase()
  let contacts = saved.contacts
  let loanRequests = saved.loanRequests
  let rules = saved.rules
  for (const fix of due) {
    if (fix.replace) {
      const swap = new Map(Object.entries(fix.replace).map(([a, b]) => [lower(a), b]))
      const fixList = list => (list || []).map(a => swap.get(lower(a)) || a)
      contacts = contacts.map(c => ({ ...c, to: fixList(c.to), cc: fixList(c.cc) }))
      applied.add(fix.id)
      continue
    }
    if (fix.enableLoans) {
      if (Array.isArray(loanRequests)) {
        loanRequests = loanRequests.map(l => (l.distributor === fix.enableLoans ? { ...l, enabled: true } : l))
      }
      applied.add(fix.id)
      continue
    }
    if (fix.addContacts) {
      for (const id of fix.addContacts) {
        const seed = DEFAULT_CONTACTS.find(c => c.id === id)
        if (seed && !contacts.some(c => c.id === id)) contacts = [...contacts, seed]
      }
      for (const id of fix.addRules || []) {
        const seed = DEFAULT_RULES.find(r => r.id === id)
        if (seed && !(rules || []).some(r => r.id === id)) rules = [...(rules || []), seed]
      }
      applied.add(fix.id)
      continue
    }
    contacts = contacts.map(c => {
      if (c.id !== fix.contactId) return c
      const gone = new Set(fix.remove.map(lower))
      const to = (c.to || []).filter(a => !gone.has(lower(a)))
      const cc = (c.cc || []).filter(a => !gone.has(lower(a)))
      const have = new Set([...to, ...cc].map(lower))
      for (const a of fix.addCc) if (!have.has(lower(a))) cc.push(a)
      return { ...c, to: to.length ? to : (c.to || []), cc }
    })
    applied.add(fix.id)
  }
  return { ...saved, contacts, ...(rules ? { rules } : {}), ...(loanRequests ? { loanRequests } : {}), applied: [...applied] }
}


export const EVENTS = ['new', 'changed', 'moved', 'cancelled']

// Task 8: loan-set requests, by distributor. Separate from the notices above:
// a notice says a booking exists; a request asks for a tray to be sent.
export const DEFAULT_LOAN_REQUESTS = [
  { distributor: 'e4', contactId: 'e4', enabled: true },
  { distributor: 'globus', contactId: 'globus', enabled: true },
  // "DT also get loan requests, just not booking updates." — Brent, 2 Nov
  // 2026. On, like E4 and Globus: each request is still shown to a person
  // before it goes. Booking notices stay off for Device (no rule names them).
  { distributor: 'device', contactId: 'device', enabled: true }
]

/** A saved loan list with any distributor added since it was saved. */
function withNewLoanRequests(saved, contacts) {
  const list = Array.isArray(saved) ? [...saved] : []
  const ids = new Set(contacts.map(c => c.id))
  for (const d of DEFAULT_LOAN_REQUESTS) {
    if (!list.some(l => l.distributor === d.distributor) && ids.has(d.contactId)) list.push(d)
  }
  return list
}

export const DEFAULT_RULES = [
  { id: 'signus-all', contactId: 'signus', distributor: 'signus', hospital: '', events: EVENTS, autoSend: false },
  { id: 'kt-rhh', contactId: 'kt', distributor: 'kt', hospital: 'RHH', events: EVENTS, autoSend: false },
  // Toni, 4 Nov 2026: any Dubey posterior spine case at Calvary should prompt
  // a neurophys booking. A rule by surgeon and operation rather than by
  // system: Neurophys monitor the case, they supply no kit.
  { id: 'neurophys-dubey-clv', contactId: 'neurophys', distributor: '', surgeon: 'Dubey', posterior: true,
    hospital: 'CLV', events: EVENTS, autoSend: false,
    ask: 'Could you please book neurophysiology monitoring for this case.' }
]

// Posterior spine work, from the operation as booked. Anterior-only work (an
// ACDF, an ALIF) is not; a combined anterior and posterior case is.
const POSTERIOR = /\b(?:posterior|plif|tlif|psf|pcf|pslf|laminectom\w*|laminoplast\w*|laminotom\w*|pedicle|fixation|osteotom\w*|scoliosis|deformity|decompression|discectomy|microdiscectomy|foraminotom\w*|fusion|instrumentation)\b/i
const ANTERIOR_ONLY = /\b(?:acdf|alif|anterior|xlif|olif|llif|tdr|arthroplasty|corpectomy)\b/i
export function isPosteriorSpine(procedure) {
  const text = String(procedure || '')
  if (/\b(?:posterior|360|combined|plif|tlif)\b/i.test(text)) return true
  if (ANTERIOR_ONLY.test(text)) return false
  return POSTERIOR.test(text)
}

const sameSurgeon = (rule, booking) =>
  Boolean(booking?.surgeon) && String(booking.surgeon).toLowerCase().includes(String(rule).toLowerCase())

/** Whether a rule applies to the booking as it now stands. */
function ruleMatches(rule, now) {
  if (!now) return false
  if (rule.surgeon) {
    return sameSurgeon(rule.surgeon, now) && (!rule.posterior || isPosteriorSpine(now.procedure))
  }
  return Boolean(now.distributors?.includes(rule.distributor))
}

export async function getNoticeSettings() {
  try {
    const raw = await redis('get', KEY)
    let saved = raw ? JSON.parse(raw) : null
    if (saved?.contacts && saved?.rules) {
      const corrected = applyCorrections(saved)
      if (corrected) {
        saved = corrected
        await redisSetBody(KEY, JSON.stringify(saved)).catch(() => {})
      }
      return { ...saved, loanRequests: withNewLoanRequests(saved.loanRequests, saved.contacts) }
    }
  } catch { /* fall through to the first copy */ }
  return { contacts: DEFAULT_CONTACTS, rules: DEFAULT_RULES, loanRequests: DEFAULT_LOAN_REQUESTS }
}

const isEmail = v => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(String(v || '').trim())

/** Checks and stores edited settings. Throws a sentence on anything malformed. */
export async function saveNoticeSettings({ contacts, rules, loanRequests = DEFAULT_LOAN_REQUESTS }) {
  if (!Array.isArray(contacts) || !Array.isArray(rules)) throw new Error('Contacts and rules are both needed')
  const cleanContacts = contacts.map(c => {
    const to = (c.to || []).map(String).map(s => s.trim()).filter(Boolean)
    const cc = (c.cc || []).map(String).map(s => s.trim()).filter(Boolean)
    if (!c.id || !c.name) throw new Error('Every contact needs a name')
    if (!to.length) throw new Error(`${c.name} needs at least one address to send to`)
    for (const a of [...to, ...cc]) if (!isEmail(a)) throw new Error(`"${a}" is not an email address`)
    return { id: String(c.id), name: String(c.name).slice(0, 80), note: String(c.note || '').slice(0, 120),
      ...(c.greeting ? { greeting: String(c.greeting).slice(0, 60) } : {}), to, cc }
  })
  const ids = new Set(cleanContacts.map(c => c.id))
  const cleanRules = rules.map(r => {
    if (!ids.has(r.contactId)) throw new Error('A rule names a contact that does not exist')
    return {
      id: String(r.id), contactId: String(r.contactId), distributor: String(r.distributor || ''),
      hospital: ['RHH', 'CLV', ''].includes(r.hospital) ? r.hospital : '',
      events: (r.events || []).filter(e => EVENTS.includes(e)),
      autoSend: Boolean(r.autoSend),
      ...(r.surgeon ? { surgeon: String(r.surgeon).slice(0, 40), posterior: Boolean(r.posterior) } : {}),
      ...(r.ask ? { ask: String(r.ask).slice(0, 200) } : {})
    }
  })
  const cleanLoans = (loanRequests || []).map(l => {
    if (!ids.has(l.contactId)) throw new Error('A loan request names a contact that does not exist')
    return { distributor: String(l.distributor), contactId: String(l.contactId), enabled: Boolean(l.enabled) }
  })
  // Corrections already in force stay recorded as applied, so saving does not
  // bring one back round to run again.
  const settings = { contacts: cleanContacts, rules: cleanRules, loanRequests: cleanLoans,
    applied: CONTACT_CORRECTIONS.map(c => c.id) }
  await redisSetBody(KEY, JSON.stringify(settings))
  return settings
}

/** The booking, as the notice describes it. */
export function describeBooking(event) {
  if (!event) return null
  const read = readBooking(event.summary || '', event.description || '',
    { knownPatient: event.extendedProperties?.private?.tmPatient }) || {}
  const kit = [read.system, read.kit].filter(Boolean).join(' ')
  // Which distributors this booking has a distributor loan from, and of what.
  //
  // A system with no supply written is still a loan when the hospital does not
  // hold it and the answer can only be the distributor's set — "Mariner MIS"
  // for a Calvary case, read from an email, offered no request at all because
  // nobody had typed "(Distributor Loan)" after it. Never inferred for a kit
  // the hospital holds, even one there on long-term loan: that is on the shelf.
  const hospital = read.hospital || detectHospital(event.location, event.description, { caseEvent: true }) || ''
  const loans = {}
  for (const { system, supply } of (read.supplies?.length ? read.supplies : parseKitSupplies(kit))) {
    const item = inventoryFor(system)
    const site = hospital === 'CLV' || hospital === 'RHH' ? hospital : ''
    const inferred = !supply && item && site && !((item.consigned?.[site] || 0) > 0)
      && suggestSupply(system, site) === 'Distributor Loan'
    if (supply !== 'Distributor Loan' && !inferred) continue
    const d = item?.distributor
    if (d) (loans[d] ||= []).push(system)
  }
  return {
    startIso: event.start?.dateTime || null,
    loans,
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

// Compared as a supplier reads it: "DIPLOMAT ON STANDBY" and "Diplomat on
// standby" are the same booking, and an email saying one became the other is
// noise (Signus were sent exactly that, 5 Nov 2026).
const sameText = (a, b) =>
  String(a || '').replace(/\s+/g, ' ').trim().toLowerCase() === String(b || '').replace(/\s+/g, ' ').trim().toLowerCase()

/** What changed between two readings, field by field. */
export function changesBetween(before, after) {
  if (!before || !after) return []
  return FIELDS
    .filter(([key]) => !sameText(before[key], after[key]))
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

  const contacts = new Map(settings.contacts.map(c => [c.id, c]))
  const out = []
  for (const rule of settings.rules) {
    if (!rule.events.includes(kind)) continue
    // Judged on the booking as it now stands. It used to be before OR after,
    // so a case switched from Diplomat to Mariner still offered Signus a
    // "booking changed" email — telling them about a case that is no longer
    // theirs ("I don't want them to receive notification that we are not
    // booking the case with Diplomat"). A cancellation is judged on the
    // booking as it was, since there is no "after" worth the name.
    // Where the case is, though, counts before or after: a KT case moved off
    // RHH is still news to KT.
    const now = kind === 'cancelled' ? (before || after) : after
    const has = ruleMatches(rule, now)
    const atHospital = !rule.hospital || [before, after].filter(Boolean).some(b => b.hospital === rule.hospital)
    if (!has || !atHospital) continue
    const contact = contacts.get(rule.contactId)
    if (!contact) continue

    const title = `${WORD[kind]} — ${subject.patient || 'patient TBC'} ${shortDate(subject.date)} ${subject.hospital}`
    const rows = FIELDS.map(([key, label]) => [label, key === 'date' ? shortDate(subject[key]) : subject[key]])
      .concat([['Patient', subject.patient || 'To be confirmed']])
    const changeLines = changes.map(c => `${c.label}: ${c.key === 'date' ? shortDate(c.was) : c.was} → ${c.key === 'date' ? shortDate(c.now) : c.now}`)
    const text = [
      `Hi ${contact.name.split(/[\s(/]/)[0]} team,`, '',
      kind === 'cancelled' ? 'This booking has been cancelled.'
        : kind === 'new' ? 'A new case has been booked.' : 'This booking has changed.',
      ...(rule.ask && kind === 'new' ? ['', rule.ask] : []),
      ...(changeLines.length ? ['', ...changeLines] : []),
      '', ...rows.map(([l, v]) => `${l}: ${v || '—'}`)
    ].join('\n')
    const html = `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#042746">
<p>Hi ${escapeHtml(contact.name.split(/[\s(/]/)[0])} team,</p>
<p>${kind === 'cancelled' ? 'This booking has been <strong>cancelled</strong>.' : kind === 'new' ? 'A new case has been booked.' : 'This booking has changed.'}</p>
${rule.ask && kind === 'new' ? `<p>${escapeHtml(rule.ask)}</p>` : ''}
${changeLines.length ? `<ul>${changeLines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}
<table cellpadding="6" style="border-collapse:collapse">${rows.map(([l, v]) =>
  `<tr><td style="color:#6b7a8d">${escapeHtml(l)}</td><td><strong>${escapeHtml(v || '—')}</strong></td></tr>`).join('')}</table>
</div>`
    out.push({ ruleId: rule.id, contactId: contact.id, name: contact.name, to: contact.to, cc: contact.cc,
      subject: title, text, html, autoSend: rule.autoSend, eventId, kind,
      // For the sent-email log: which email, without the patient.
      label: [`${WORD[kind]} → ${contact.name}`, subject.surgeon, subject.hospital, shortDate(subject.date)].filter(Boolean).join(' · ') })
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
  // One atomic read-and-delete: a GET then a DEL let two Send taps both read
  // the notice before either deleted it, and the supplier got it twice.
  const raw = await redis('getdel', `notice:pending:${id}`)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/** Puts a notice back under its id when sending it failed, so Send can be tried again. */
export async function restoreNotice(id, notice) {
  await redisSetBody(`notice:pending:${id}`, JSON.stringify(notice))
  await redis('expire', `notice:pending:${id}`, '86400').catch(() => {})
}

/** Preview for the client: who and what, without anything it could alter. */
export function previewOf(notice, id) {
  return { id, name: notice.name, to: notice.to, cc: notice.cc, subject: notice.subject, text: notice.text }
}


// ─── Loan-set requests (Task 8) ──────────────────────────────────────────────
// A booking whose kit says "Distributor Loan" for an E4 or Globus system is a
// tray somebody has to ask for. The portal writes the request and shows it,
// the same way as a notice; once it has gone, the booking remembers, so a
// move or a cancellation sends a follow-up and a second save does not ask
// twice.
//
//   request   first time the booking needs a loan set from them
//   update    a request went, and the date or hospital has since changed
//   cancel    a request went, and the case is off or no longer needs the set

export async function loanStateFor(eventId, distributors) {
  const out = {}
  await Promise.all(distributors.map(async d => {
    try {
      const raw = await redis('get', `loanreq:${eventId}:${d}`)
      if (raw) out[d] = JSON.parse(raw)
    } catch { /* unknown is treated as not sent */ }
  }))
  return out
}

/**
 * Records what a confirmed request said, or forgets it once cancelled — and
 * logs it on the booking either way.
 *
 * "Once the request for a loan set is sent to the distributor, the portal is
 * updated to say that the request was made, by whom and at what time and date
 * the loan set was requested." — Brent, 2 Nov 2026. The state key above is
 * what decides the next email and is removed on a cancellation; the log is
 * what a person reads, so it keeps every request, change and call-off.
 */
export async function recordLoanRequest(notice, by = null) {
  if (!notice?.loan) return
  const at = new Date().toISOString()
  const key = `loanreq:${notice.eventId}:${notice.loan.distributor}`
  if (notice.loan.status === 'cancel') await redis('del', key)
  else await redisSetBody(key, JSON.stringify({ date: notice.loan.date, hospital: notice.loan.hospital,
    systems: notice.loan.systems, sentAt: at, by }))
  const log = `loanlog:${notice.eventId}`
  await redis('lpush', log, JSON.stringify({
    at, by, status: notice.loan.status, systems: notice.loan.systems || [],
    to: String(notice.name || '').split(' — ')[0], hospital: String(notice.loan.distributor).startsWith('hosp-')
  }))
  await redis('ltrim', log, 0, 49)
}

/** Every loan email sent for a booking, newest first. */
export async function loanLogFor(eventId) {
  const raw = await redis('lrange', `loanlog:${eventId}`, 0, 49) || []
  return raw.map(r => { try { return JSON.parse(r) } catch { return null } }).filter(Boolean)
}

const LOAN_WORD = { request: 'Loan set request', update: 'Loan set — booking changed', cancel: 'Loan set no longer needed' }

// ─── Telling the hospital a loan set is coming ───────────────────────────────
// "We also need to inform Calvary loan sets of the loan set being ordered and
// in this case the change in the booking." — Brent, 2 Nov 2026.
//
// The hospital's loans team receives and tracks every loan set, so they hear
// when one is ordered for a case at their hospital, when the case changes
// (date, or which set), and when it is no longer coming. Kept under its own
// key per booking (`hosp-CLV`), the same way a distributor's request is, so a
// second save does not tell them twice. Shown before sending, like the rest.

export const DEFAULT_HOSPITAL_LOAN_NOTICES = [
  { hospital: 'CLV', contactId: 'calvary_loans', enabled: true },
  // Off until asked for: RHH's coordinator is told by the distributor today.
  { hospital: 'RHH', contactId: 'rhh_loans', enabled: false }
]

const DISTRIBUTOR_NAMES = { signus: 'Signus', kt: 'KT Medical', e4: 'E4 Surgical', globus: 'Globus / NuVasive', device: 'Device Technologies' }

/** Every loan set on a booking, named with who is sending it. */
function loanSets(b) {
  return Object.entries(b?.loans || {}).flatMap(([d, systems]) =>
    systems.map(s => `${s} (${DISTRIBUTOR_NAMES[d] || d})`))
}

// Only a loan set that is new to the booking is asked for (Brent, 4 Nov 2026:
// "The emails re: loan sets should only be offered when the booking is first
// placed, not when amendments are made"). Changing the list order on Ware —
// whose E4 set Ben had requested by hand in October — offered E4 and the
// Calvary loans team a fresh request, because the portal had no record of one.
// A new booking asks; an edit asks only for a set the edit itself added (a
// switch from Diplomat to Mariner is still Device's loan request). Updates and
// cancellations still follow requests the portal has sent.
function newToBooking(kind, wasSystems = [], nowSystems = []) {
  if (kind === 'new') return true
  const was = new Set(wasSystems.map(s => String(s).toLowerCase()))
  return nowSystems.some(s => !was.has(String(s).toLowerCase()))
}

export function hospitalLoanNoticesFor({ kind, before, after, eventId, settings, sent = {} }) {
  const out = []
  const contacts = new Map(settings.contacts.map(c => [c.id, c]))
  for (const rule of settings.hospitalLoanNotices || DEFAULT_HOSPITAL_LOAN_NOTICES) {
    if (!rule.enabled) continue
    const contact = contacts.get(rule.contactId)
    if (!contact) continue
    const key = `hosp-${rule.hospital}`
    const had = sent[key]
    const sets = kind !== 'cancelled' && after?.hospital === rule.hospital ? loanSets(after) : []
    const needs = sets.length > 0

    const was = before ? loanSets(before) : []
    let status = null
    if (needs && !had) status = newToBooking(kind, before?.hospital === rule.hospital ? was : [], sets) ? 'request' : null
    else if (had && !needs) status = 'cancel'
    else if (had && needs && (had.date !== after.date || (had.systems || []).join('|') !== sets.join('|'))) status = 'update'
    if (!status) continue

    const b = status === 'cancel' ? (after || before) : after
    const systems = status === 'cancel' ? (had?.systems || []) : sets
    const lines = status === 'request'
      ? [`A loan set has been ordered for this case: ${systems.join(' + ')}.`,
        ...(kind === 'changed' && before?.kit && !sameText(before.kit, after.kit) ? [`The booking has changed: ${before.kit} → ${after.kit}.`] : [])]
      : status === 'update'
        ? [`This case has changed — the loan set for it is now: ${systems.join(' + ')}.`,
          ...(had.date !== b.date ? [`Date: ${shortDate(had.date)} → ${shortDate(b.date)}.`] : []),
          ...((had.systems || []).join('|') !== systems.join('|') ? [`Was: ${(had.systems || []).join(' + ') || '—'}.`] : [])]
        : [`The loan set for this case is no longer coming: ${systems.join(' + ')}.`,
          kind === 'cancelled' ? 'The case has been cancelled.' : (was.length ? '' : 'The booking no longer needs it.')].filter(Boolean)
    const arrive = status !== 'cancel' && b?.startIso ? kitArrivalBy(b.startIso) : null
    // The set on its own line with the rest of the case, not only in the
    // sentence above: the loans team works down these rows ("it still needs
    // to be in the main body of the booking with Pt:, Surg:, Date:").
    const rows = [
      ['Surgery', shortDate(b?.date)], ['Surgeon', b?.surgeon], ['Procedure', b?.procedure],
      ['Patient', b?.patient || 'To be confirmed'],
      [status === 'cancel' ? 'Loan set (not coming)' : 'Loan set', systems.join(' + ')],
      ...(arrive ? [['Due at the hospital by', `${shortDate(arrive.date)} ${arrive.time}`]] : [])
    ]
    const greeting = `Hi ${contact.greeting || contact.name},`
    const subject = `${{ request: 'Loan set ordered', update: 'Loan set — case changed', cancel: 'Loan set not coming' }[status]}`
      + ` — ${systems.join(' + ')} — ${shortDate(b?.date)} — Pt ${b?.patient || 'TBC'}`
    const text = [greeting, '', ...lines, '', ...rows.map(([l, v]) => `${l}: ${v || '—'}`)].join('\n')
    const html = `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#042746">
<p>${escapeHtml(greeting)}</p>${lines.map(l => `<p>${escapeHtml(l)}</p>`).join('')}
<table cellpadding="6" style="border-collapse:collapse">${rows.map(([l, v]) =>
  `<tr><td style="color:#6b7a8d">${escapeHtml(l)}</td><td><strong>${escapeHtml(v || '—')}</strong></td></tr>`).join('')}</table>
</div>`
    out.push({ ruleId: key, contactId: contact.id, name: `${contact.name} — ${status === 'request' ? 'loan set ordered' : status === 'update' ? 'case changed' : 'loan set not coming'}`,
      to: contact.to, cc: contact.cc, subject, text, html, autoSend: false, eventId, kind,
      label: [`${{ request: 'Loan set ordered', update: 'Loan set — case changed', cancel: 'Loan set not coming' }[status]} → ${contact.name}`, systems.join(' + '), b?.hospital, shortDate(b?.date)].filter(Boolean).join(' · '),
      loan: { distributor: key, status, date: b?.date, hospital: b?.hospital, systems } })
  }
  return out
}

export function loanRequestsFor({ kind, before, after, eventId, settings, sent = {} }) {
  const out = []
  const contacts = new Map(settings.contacts.map(c => [c.id, c]))
  for (const rule of settings.loanRequests || []) {
    if (!rule.enabled) continue
    const contact = contacts.get(rule.contactId)
    if (!contact) continue
    const d = rule.distributor
    const had = sent[d]
    const needs = kind !== 'cancelled' && after?.loans?.[d]?.length

    let status = null
    if (needs && !had) status = newToBooking(kind, before?.loans?.[d] || [], after.loans[d]) ? 'request' : null
    else if (had && !needs) status = 'cancel'
    else if (had && needs && (had.date !== after.date || had.hospital !== after.hospital)) status = 'update'
    if (!status) continue

    const b = status === 'cancel' ? (after || before) : after
    const systems = status === 'cancel' ? (had?.systems || []) : after.loans[d]
    const arrive = b?.startIso ? kitArrivalBy(b.startIso) : null
    const rush = b?.startIso ? isRush(b.startIso) : false
    const subject = `${LOAN_WORD[status]} — ${systems.join(' + ')} — ${b?.hospital || ''} ${shortDate(b?.date)}`
      + ` — ${b?.surgeon || ''} — Pt ${b?.patient || 'TBC'}`
    const ask = status === 'request'
      ? `Please send the following loan set${systems.length > 1 ? 's' : ''}: ${systems.join(' + ')}.`
      : status === 'update'
        ? `This case has changed — please redirect the loan set (${systems.join(' + ')}).`
          + `${had.date !== b.date ? ` Date: ${shortDate(had.date)} → ${shortDate(b.date)}.` : ''}`
          + `${had.hospital !== b.hospital ? ` Hospital: ${had.hospital} → ${b.hospital}.` : ''}`
        : `This case ${kind === 'cancelled' ? 'has been cancelled' : 'no longer needs the loan set'} — please do not send ${systems.join(' + ')}, or recall it if it is on its way.`
    const rows = [
      ['Surgery', shortDate(b?.date)], ['Hospital', b?.hospital], ['Surgeon', b?.surgeon],
      ['Procedure', b?.procedure], ['Patient', b?.patient || 'To be confirmed'],
      [status === 'cancel' ? 'Loan set (not needed)' : 'Loan set', systems.join(' + ')],
      ...(status !== 'cancel' && arrive ? [['Needed at the hospital by', rush
        ? 'As soon as possible — less than 48 hours to surgery'
        : `${shortDate(arrive.date)} ${arrive.time}`]] : [])
    ]
    const greeting = `Hi ${contact.name.split(/[\s(/]/)[0]} team,`
    const text = [greeting, '', ask, '', ...rows.map(([l, v]) => `${l}: ${v || '—'}`), '',
      'Please reply to confirm.'].join('\n')
    const html = `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#042746">
<p>${escapeHtml(greeting)}</p><p><strong>${escapeHtml(ask)}</strong></p>
<table cellpadding="6" style="border-collapse:collapse">${rows.map(([l, v]) =>
  `<tr><td style="color:#6b7a8d">${escapeHtml(l)}</td><td><strong>${escapeHtml(v || '—')}</strong></td></tr>`).join('')}</table>
<p>Please reply to confirm.</p></div>`
    out.push({ ruleId: `loan-${d}`, contactId: contact.id, name: `${contact.name} — ${LOAN_WORD[status].toLowerCase()}`,
      to: contact.to, cc: contact.cc, subject, text, html, autoSend: false, eventId, kind,
      label: [`${LOAN_WORD[status]} → ${contact.name}`, systems.join(' + '), b?.surgeon, b?.hospital, shortDate(b?.date)].filter(Boolean).join(' · '),
      loan: { distributor: d, status, date: b?.date, hospital: b?.hospital, systems } })
  }
  return out
}
