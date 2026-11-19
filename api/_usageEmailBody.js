// ─── The usage email's words (Brent, 17 Nov 2026) ────────────────────────────
// "Personalise the message that gets sent with usages both from an addressee
// point of view and also from the person sending it … a TechnoMed logo …
// the email signature of the person sending." He chose option B of the
// mock-ups (claude.ai/artifact/KLFYtSx7me31Z5KwSrDgFg): the logo as letterhead,
// "Hi {greeting}," then one panel of case facts, the rep's own note if they
// typed one, and their signature.
//
// Pure: no I/O, so the layout is tested directly (usageEmailBody.test.js).
// The panel says patient (surname only), surgeon, hospital, date, the
// distributor's systems and the item count. The patient's surname was left
// out until 19 Nov 2026 (Toni, approved by Brent: "include patient surname,
// so you don't have to look back at the subject line"); the subject already
// carried it. Never a first name, UR or date of birth.

import { findSystems } from '../src/clinicalPlan/systems.js'
import { STAFF } from '../src/staffConfig.js'
import { emailShell, para, factsPanel, signoff, ADDRESS } from './_emailLayout.js'


/** How each distributor's email opens: "Hi {greeting},". Edited in Admin → Supplier notices. */
export const DEFAULT_USAGE_GREETINGS = {
  signus: 'Jasper and Amanda',
  e4: 'Roy and the E4 team',
  device: 'Device Ortho & Spine team',
  device_boost: 'Device team',
  kt: 'Ben and the KT team',
  globus: 'Globus team',
  dtbv: 'DTBV team'
}

const MAKER_ONLY = /^(e4|signus|kt|device|globus|nuvasive)$/i
const HOSPITALS = { CLV: 'Calvary', RHH: 'Royal Hobart Hospital' }
const NOTE_MAX = 600

/** The greeting for a distributor, from the saved ones, else the default, else their name. */
export function greetingFor(key, saved = {}, fallbackName = '') {
  const g = String(saved?.[key] ?? DEFAULT_USAGE_GREETINGS[key] ?? '').trim()
  return g || (fallbackName ? `${fallbackName} team` : 'team')
}

/** A typed note, tidied: plain text, trimmed, capped. */
export function cleanNote(note) {
  return String(note || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, NOTE_MAX)
}

/** "Tue 17 Nov 2026" from YYYY-MM-DD, without the device's timezone. */
export function surgeryDay(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** The case facts the panel shows: the patient by surname only. */
export function caseFacts(record = {}, items = []) {
  // Per line: "E4 SURGICAL DAKOTA screw" names the maker and the system, and
  // "E4" alone also matches E4 Cages — a maker's name counts only when the
  // line names nothing more specific.
  const systems = [...new Set(items.flatMap(i => {
    const found = findSystems(String(i?.productName || ''))
    const specific = found.filter(f => !MAKER_ONLY.test(f.matched))
    return (specific.length ? specific : found).map(f => f.name)
  }))]
  const lines = items.length
  const stocks = [...new Set(items.map(i => String(i?.stock || '')).filter(Boolean))]
  const stock = stocks.length === 1 ? (stocks[0] === 'Loan' ? 'loan' : 'consignment') : ''
  return [
    ['Patient', String(record.patientSurname || '').trim()],
    ['Surgeon', String(record.surgeonSurname || record.surgeonName || '').trim()],
    ['Hospital', HOSPITALS[record.hospital] || String(record.hospital || '').trim()],
    ['Date of surgery', surgeryDay(record.date)],
    ['Your systems', systems.join(' · ')],
    ['Items', lines ? `${lines} line${lines === 1 ? '' : 's'}${stock ? ` · ${stock}` : ''}` : '']
  ].filter(([, v]) => v)
}

/** The sender's sign-off, from the staff list. */
export function signoffFor(sender = {}) {
  const staff = STAFF.find(s => s.email.toLowerCase() === String(sender.email || '').toLowerCase())
  return {
    name: staff?.name || String(sender.name || '').trim() || 'TechnoMed',
    role: staff?.role || '',
    contact: [staff?.phone, staff?.email || sender.email].filter(Boolean).join(' · ')
  }
}


/**
 * The email, html and text. `logoCid` is the inline logo's content id.
 * `banner` is the TEST or CORRECTION line, already worded by the caller.
 */
export function usageEmailContent({
  greeting, record = {}, items = [], note = '', sender = {}, scanAttached = false,
  logoCid = 'technomed-logo', banner = null, correctionText = ''
}) {
  const facts = caseFacts(record, items)
  const sig = signoffFor(sender)
  const typed = cleanNote(note)
  const lead = correctionText
    ? ''
    : (scanAttached
      ? 'Here’s the usage from the case below. The usage sheet and the signed hospital form are attached.'
      : 'Here’s the usage from the case below. The usage sheet is attached.')

  // The portal's one letterhead (api/_emailLayout.js), labelled USAGE.
  const html = emailShell({
    label: correctionText ? 'Usage correction' : 'Usage',
    logoCid,
    banner,
    body: [
      para(`Hi ${greeting},`),
      correctionText ? para(correctionText, { strong: true }) : para(lead),
      factsPanel(facts),
      typed ? para(typed) : '',
      signoff({ closing: 'Thanks,', name: sig.name, role: sig.role, contact: sig.contact })
    ].join('\n')
  })

  const text = [
    banner ? `${banner.title}${banner.detail ? ` ${banner.detail}` : ''}\n` : '',
    `Hi ${greeting},`,
    '',
    correctionText || lead,
    '',
    ...facts.map(([k, v]) => `${k}: ${v}`),
    ...(typed ? ['', typed] : []),
    '',
    'Thanks,',
    sig.name,
    ...(sig.role ? [sig.role] : []),
    ...(sig.contact ? [sig.contact] : []),
    '',
    ADDRESS
  ].join('\n').replace(/^\n+/, '')

  return { html, text }
}
