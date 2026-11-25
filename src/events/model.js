// ─── Events and RSVPs (Brent, 25 Nov 2026) ───────────────────────────────────
// "An RSVP portal within our Technomed portal for dinners etc … as good as
// RSVPify." Pure rules shared by the screens and api/_events.js: the contact
// groups, the reply-form question library, answer checking, the counts, the
// calendar file, and reading a phone's .vcf export.
//
// Contacts come from email first (Brent, 25 Nov 2026: "Choose contacts that
// cross reference with my email first and foremost and forget others"): a
// phone contact never becomes a contact on its own — it only fills in the
// mobile of somebody already in the list (`matchPhoneContacts`).

export const GROUPS = ['Surgeon', 'Registrar/Fellow', 'Theatre/Nursing', 'Rep/Partner', 'Hospital admin', 'Other']

/** Healthcare professionals, for the MTAA hospitality record. */
export const HCP_GROUPS = new Set(['Surgeon', 'Registrar/Fellow', 'Theatre/Nursing'])

export const EVENT_KINDS = [
  { id: 'dinner', label: 'Dinner or drinks' },
  { id: 'inservice', label: 'Breakfast or lunch in-service' },
  { id: 'workshop', label: 'Workshop or cadaver lab' },
  { id: 'conference', label: 'Conference or travel' }
]

export const REPLIES = ['yes', 'maybe', 'no']
export const REPLY_LABEL = { yes: 'Yes', maybe: 'Maybe', no: "Can't make it", waitlist: 'Waitlist', none: 'No reply' }

/**
 * The questions an organiser can put on an event's form. `type`:
 * chips (pick any), one (pick one), text, plus (partner: yes/no + name and
 * dietary), time. Options of `one` / `chips` can be retyped per event.
 */
export const QUESTION_LIBRARY = [
  { id: 'diet', label: 'Dietary needs', type: 'chips', options: ['None', 'Vegetarian', 'Vegan', 'Gluten free', 'Dairy free', 'Halal', 'Kosher'] },
  { id: 'allergy', label: 'Allergies or anything else', type: 'text' },
  { id: 'main', label: 'Menu choice', type: 'one', options: ['Beef', 'Fish', 'Vegetarian'] },
  { id: 'plus', label: 'Bringing a partner', type: 'plus' },
  { id: 'coffee', label: 'Coffee order', type: 'one', options: ['Flat white', 'Latte', 'Cappuccino', 'Long black', 'Espresso', 'Tea', 'No coffee'], note: true },
  { id: 'transport', label: 'Transport or parking', type: 'one', options: ['Driving myself', 'Taxi or Uber home', 'Parking pass please'] },
  { id: 'arrive', label: 'Arrival time', type: 'time' },
  { id: 'flights', label: 'Flights', type: 'text', hint: 'Departing city, preferred times, frequent flyer number' },
  { id: 'stay', label: 'Accommodation', type: 'text', hint: 'Nights needed, room share' },
  { id: 'cpd', label: 'CPD details', type: 'text', hint: 'AHPRA number and college, for your attendance certificate' },
  { id: 'size', label: 'Shirt or scrub size', type: 'one', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] }
]

const LIBRARY = Object.fromEntries(QUESTION_LIBRARY.map(q => [q.id, q]))
const TYPES = new Set(['chips', 'one', 'text', 'plus', 'time'])

/** A starting form for each kind of event. */
export function defaultForm(kind) {
  const ids = {
    dinner: ['diet', 'allergy', 'plus'],
    inservice: ['coffee', 'diet', 'allergy'],
    workshop: ['diet', 'allergy', 'cpd'],
    conference: ['flights', 'stay', 'diet', 'allergy']
  }[kind] || ['diet', 'allergy']
  return ids.map(id => ({ ...LIBRARY[id] }))
}

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** A form as saved: known shapes only, own questions given an id. */
export function cleanForm(form) {
  const seen = new Set()
  return (Array.isArray(form) ? form : []).slice(0, 20).map((q, i) => {
    const type = TYPES.has(q?.type) ? q.type : 'text'
    let id = clip(q?.id, 30).replace(/[^\w-]/g, '') || `q${i + 1}`
    while (seen.has(id)) id = `${id}x`
    seen.add(id)
    const out = { id, label: clip(q?.label, 120) || 'Question', type }
    if (type === 'one' || type === 'chips') {
      out.options = [...new Set((q.options || []).map(o => clip(o, 60)).filter(Boolean))].slice(0, 20)
      if (!out.options.length) out.type = 'text'
    }
    if (q?.hint) out.hint = clip(q.hint, 160)
    if (q?.note) out.note = true
    if (q?.required) out.required = true
    return out
  })
}

/**
 * A guest's answers, kept only for questions on the form and only in shapes
 * the form allows. Nothing a guest types is trusted beyond that.
 */
export function cleanAnswers(form, raw = {}) {
  const out = {}
  for (const q of cleanForm(form)) {
    const v = raw?.[q.id]
    if (v == null || v === '') continue
    if (q.type === 'chips') {
      const picked = (Array.isArray(v) ? v : [v]).filter(o => q.options.includes(o))
      if (picked.length) out[q.id] = picked
    } else if (q.type === 'one') {
      const pick = typeof v === 'object' ? v.pick : v
      if (q.options.includes(pick)) {
        out[q.id] = q.note && typeof v === 'object' && v.note ? { pick, note: clip(v.note, 160) } : pick
      }
    } else if (q.type === 'plus') {
      if (v && typeof v === 'object' && v.coming) out[q.id] = { coming: true, name: clip(v.name, 80), diet: clip(v.diet, 160) }
    } else if (q.type === 'time') {
      if (/^\d{1,2}:\d{2}$/.test(String(v))) out[q.id] = String(v)
    } else {
      const t = clip(v, 600)
      if (t) out[q.id] = t
    }
  }
  return out
}

/** What is still to answer, for a guest coming. */
export function missingAnswers(form, answers) {
  return cleanForm(form).filter(q => q.required && answers?.[q.id] == null).map(q => q.label)
}

/** How many seats a guest takes: themselves, plus a partner. */
export const seatsFor = guest => (guest?.status === 'yes'
  ? 1 + (Object.values(guest.answers || {}).some(a => a && typeof a === 'object' && a.coming) ? 1 : 0)
  : 0)

/** One answer as words, for tables and the venue sheet. */
export function answerText(q, a) {
  if (a == null) return ''
  if (q.type === 'chips') return a.join(', ')
  if (q.type === 'plus') return a.coming ? [a.name || 'Partner', a.diet].filter(Boolean).join(' · ') : ''
  if (typeof a === 'object') return [a.pick, a.note].filter(Boolean).join(' · ')
  return String(a)
}

/** The counts and lists an organiser and a venue need. */
export function summarise(event) {
  const guests = event?.guests || []
  const form = cleanForm(event?.form)
  const by = s => guests.filter(g => (g.status || 'none') === s).length
  const coming = guests.filter(g => g.status === 'yes')
  const seats = coming.reduce((n, g) => n + seatsFor(g), 0)
  const tallies = form.filter(q => q.type === 'one' || q.type === 'chips').map(q => {
    const counts = Object.fromEntries(q.options.map(o => [o, 0]))
    for (const g of coming) {
      const a = g.answers?.[q.id]
      for (const pick of q.type === 'chips' ? (a || []) : [a?.pick ?? a]) if (pick in counts) counts[pick]++
    }
    return { id: q.id, label: q.label, counts }
  })
  const notes = []
  for (const g of coming) {
    for (const q of form) {
      const a = g.answers?.[q.id]
      if (q.type === 'text' && a) notes.push({ who: g.name, label: q.label, text: a })
      if (q.type === 'plus' && a?.coming && a.diet) notes.push({ who: `${g.name}'s partner`, label: 'Dietary', text: a.diet })
    }
  }
  return {
    invited: guests.length,
    yes: by('yes'), maybe: by('maybe'), no: by('no'), waitlist: by('waitlist'), none: by('none'),
    seats, capacity: Number(event?.capacity) || 0,
    left: event?.capacity ? Math.max(0, Number(event.capacity) - seats) : null,
    hcp: coming.filter(g => HCP_GROUPS.has(g.group)).length,
    tallies, notes
  }
}

/** Australian mobiles as +614…; anything else as typed, digits only. */
export function normaliseMobile(raw) {
  const d = String(raw || '').replace(/[^\d+]/g, '')
  if (!d) return ''
  if (d.startsWith('+')) return d
  if (d.startsWith('614') && d.length === 11) return `+${d}`
  if (d.startsWith('04') && d.length === 10) return `+61${d.slice(1)}`
  if (d.startsWith('4') && d.length === 9) return `+61${d}`
  return d
}

export const isMobile = raw => /^\+614\d{8}$/.test(normaliseMobile(raw))

/** "04xx xxx xxx" for a person to read. */
export function showMobile(raw) {
  const m = normaliseMobile(raw)
  if (!/^\+614\d{8}$/.test(m)) return String(raw || '')
  const d = `0${m.slice(3)}`
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`
}

/** A .vcf export read into plain cards (name, org, title, emails, phones). */
export function parseVcf(text) {
  const unfolded = String(text || '').replace(/\r?\n[ \t]/g, '')
  return unfolded.split(/BEGIN:VCARD/i).slice(1).map(block => {
    const card = { name: '', org: '', title: '', emails: [], phones: [] }
    for (const line of block.split(/\r?\n/)) {
      const at = line.indexOf(':')
      if (at < 0) continue
      const key = line.slice(0, at).split(';')[0].split('.').pop().toUpperCase()
      const value = line.slice(at + 1).replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').trim()
      if (key === 'FN') card.name = value
      else if (key === 'ORG') card.org = value.replace(/;+$/, '').replace(/;/g, ' · ')
      else if (key === 'TITLE') card.title = value
      else if (key === 'EMAIL' && value.includes('@')) card.emails.push(value.toLowerCase())
      else if (key === 'TEL' && value) card.phones.push(value)
    }
    return card
  }).filter(c => c.name || c.emails.length)
}

const nameKey = s => String(s || '').toLowerCase()
  .replace(/^(dr|prof|professor|mr|mrs|ms|miss|a\/prof)\.?\s+/g, '')
  .replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Phone contacts matched to people already in the list — by email first, then
 * by full name. Unmatched phone contacts are never added (Brent, 25 Nov 2026).
 * Returns the updates (a mobile filled in where the contact had none) and how
 * many were left out.
 */
export function matchPhoneContacts(contacts, cards) {
  const byEmail = new Map()
  const byName = new Map()
  for (const c of contacts) {
    for (const e of [c.email, ...(c.otherEmails || [])].filter(Boolean)) byEmail.set(e.toLowerCase(), c)
    const k = nameKey(c.name)
    if (k.includes(' ')) byName.set(k, byName.has(k) ? null : c) // two of the same name: no guess
  }
  const updates = []
  let unmatched = 0
  for (const card of cards) {
    const hit = card.emails.map(e => byEmail.get(e)).find(Boolean) || byName.get(nameKey(card.name))
    if (!hit) { unmatched++; continue }
    const mobile = card.phones.map(normaliseMobile).find(p => /^\+614\d{8}$/.test(p))
    if (mobile && !hit.mobile) updates.push({ id: hit.id, mobile, from: 'phone' })
  }
  return { updates, unmatched }
}

/** Escaped for an .ics line. */
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsTime = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** A calendar file for "Add to my calendar". */
export function icsFor(event, url = '') {
  const start = event.start
  const end = event.end || new Date(new Date(event.start).getTime() + 3 * 3600e3).toISOString()
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TechnoMed//Events//EN', 'BEGIN:VEVENT',
    `UID:${event.id}@technomed.com.au`, `DTSTAMP:${icsTime(new Date().toISOString())}`,
    `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(event.title)}`,
    `LOCATION:${icsText([event.venue, event.address].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${icsText([event.details, url].filter(Boolean).join('\n\n'))}`,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n')
}

/** "Thu 4 Dec · 7:00pm", in Hobart. */
export function whenText(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Hobart', weekday: 'short', day: 'numeric', month: 'short' }).format(d)
  const time = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Hobart', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/\s/g, '').toLowerCase()
  return `${day} · ${time}`
}
