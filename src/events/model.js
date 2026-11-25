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
  if (d.startsWith('+610')) return `+61${d.slice(4)}` // "+61 0438 …"
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
 * Short and long forms of a first name, both ways (Brent, 25 Nov 2026: the
 * phone has "Matt Belford", the list "Dr Matthew (Matt) Belford").
 */
const NICKNAMES = [
  ['matthew', 'matt', 'mat'], ['michael', 'mike', 'mick'], ['daniel', 'dan', 'danny'], ['samuel', 'sam'],
  ['samantha', 'sam', 'sammy'], ['sandra', 'sandy'], ['jennifer', 'jenny', 'jen'], ['catherine', 'cate', 'cathy', 'kate'],
  ['cathryn', 'cate', 'cath'], ['kathryn', 'kate', 'kath'], ['katherine', 'kate', 'kath'], ['christopher', 'chris'],
  ['andrew', 'andy', 'drew'], ['anthony', 'tony'], ['benjamin', 'ben'], ['nicholas', 'nick', 'nic'], ['nicola', 'nic', 'nicky'],
  ['william', 'will', 'bill'], ['robert', 'rob', 'bob'], ['richard', 'rich', 'rick'], ['stephen', 'steve'], ['steven', 'steve'],
  ['timothy', 'tim'], ['thomas', 'tom'], ['jonathan', 'jon', 'jono'], ['joseph', 'joe'], ['james', 'jim', 'jimmy'],
  ['alexander', 'alex'], ['alexandra', 'alex', 'lexi'], ['elizabeth', 'liz', 'lizzie', 'beth'], ['rebecca', 'bec', 'becky'],
  ['victoria', 'vic', 'tori'], ['patricia', 'trish', 'pat'], ['margaret', 'maggie', 'meg'], ['phillip', 'phil'], ['philip', 'phil'],
  ['edward', 'ed', 'ted'], ['gregory', 'greg'], ['jeremy', 'jez'], ['zachary', 'zac', 'zack'], ['jessica', 'jess'],
  ['natalie', 'nat'], ['natasha', 'tash'], ['peter', 'pete'], ['david', 'dave'], ['kimberley', 'kim'], ['kimberly', 'kim'],
  ['abigail', 'abbey', 'abby'], ['sarah', 'sara'], ['philippa', 'pip', 'pippa'], ['deborah', 'deb'], ['susan', 'sue'],
  ['geoffrey', 'geoff'], ['jeffrey', 'jeff'], ['douglas', 'doug'], ['frederick', 'fred'], ['raymond', 'ray']
]
const NICK = new Map()
for (const group of NICKNAMES) for (const n of group) NICK.set(n, new Set([...(NICK.get(n) || []), ...group]))
const firstForms = f => [...(NICK.get(f) || [f])]

/**
 * Every "first surname" a contact could be saved under in a phone: titles
 * off, a bracketed name read as a nickname ("Matthew (Matt)") or a second
 * surname ("Andrea Haines (Hammond)"), middle names and initials ignored, and
 * the usual short and long forms of the first name.
 */
/** Words that make a name a place or a role, not a person ("RHH DMI Chief Radiographer"). */
const NOT_A_PERSON = /\b(rhh|lgh|nwrh|calvary|hospital|theatre|theatres|stores|admin|bookings|radiographer|radiology|dmi|desk|reception|team|department|unit|ward|office|cssd|loans|accounts|services|clinic)\b/i

export function nameForms(raw) {
  const s = String(raw || '')
  if (NOT_A_PERSON.test(s)) return []
  const bracket = (/\(([^)]*)\)/.exec(s)?.[1] || '').replace(/^prefers\s+/i, '')
  const words = nameKey(s.replace(/\([^)]*\)/g, ' ')).split(' ').filter(w => w && w.length > 1 || /^[a-z]{2,}/.test(w))
  if (words.length < 2) return []
  const firsts = new Set([words[0]])
  const lasts = new Set([words[words.length - 1]])
  // "P. Scott Mackie" — goes by the middle name.
  if (words.length > 2) firsts.add(words[1])
  for (const b of nameKey(bracket).split(' ').filter(Boolean)) {
    if (bracket.trim().split(/\s+/).length === 1 && !NICK.has(b) && b.length > 2 && words.length >= 2 && /^[A-Z]/.test(bracket.trim()) && !firstForms(words[0]).includes(b)) {
      // A one-word bracket that is not a short name: a nickname if it looks like a first name, else a maiden name.
      firsts.add(b); lasts.add(b)
    } else firsts.add(b)
  }
  const out = new Set()
  for (const f of firsts) for (const ff of firstForms(f)) for (const l of lasts) if (ff !== l) out.add(`${ff} ${l}`)
  return [...out]
}

/** A phone card's own "first surname": the first and last words of its name. */
function cardKey(name) {
  const words = nameKey(name).split(' ').filter(Boolean)
  return words.length >= 2 ? `${words[0]} ${words[words.length - 1]}` : ''
}

/**
 * Phone contacts matched to people already in the list — by email first, then
 * by name (`nameForms`: nicknames, bracketed names and middle names allowed for).
 * A name two people in the list could both be is never guessed. Unmatched
 * phone contacts are never added (Brent, 25 Nov 2026). Returns the updates (a
 * mobile filled in where the contact had none, with `how` and the phone's
 * name) and how many were left out.
 */
export function matchPhoneContacts(contacts, cards) {
  const byEmail = new Map()
  const byName = new Map()
  for (const c of contacts) {
    for (const e of [c.email, ...(c.otherEmails || [])].filter(Boolean)) byEmail.set(e.toLowerCase(), c)
    for (const k of nameForms(c.name)) byName.set(k, byName.has(k) && byName.get(k) !== c ? null : c) // two people: no guess
  }
  const updates = []
  const seen = new Map()
  let unmatched = 0
  for (const card of cards) {
    const mobile = card.phones.map(normaliseMobile).find(p => /^\+614\d{8}$/.test(p))
    const byMail = card.emails.map(e => byEmail.get(e)).find(Boolean)
    const hit = byMail || byName.get(cardKey(card.name))
    if (!hit) { unmatched++; continue }
    if (!mobile || hit.mobile) continue
    // Two phone cards for one person with different mobiles: leave it to a person.
    if (seen.has(hit.id)) { if (seen.get(hit.id).mobile !== mobile) seen.get(hit.id).conflict = true; continue }
    const u = { id: hit.id, mobile, from: 'phone', how: byMail ? 'email' : 'name', card: card.name }
    seen.set(hit.id, u)
    updates.push(u)
  }
  return { updates: updates.filter(u => !u.conflict), unmatched, work: workCards(cards, contacts, byEmail, byName) }
}

const WORK = /\b(rhh|royal hobart|calvary|lenah valley|st johns|lgh|launceston general|nwrh|hobart private|hospital|theatres?|reg|registrar|fellow|resident|intern|nurse|anum|num|cnc|scrub|cssd|stores|loans|ward|icu|radiograph\w*|anaesthe\w*|surgeon|neurosurg\w*|ortho\w*|neuro\w*|spine|spinal|max ?fax|omfs|ent|plastics|consultant|clinic|clinical|theatre tech|device technologies|e4 surgical|signus|depuy|synthes|stryker|medtronic|globus|kt medical|evolution surgical|brainlab|seaspine|orthofix|zimmer|smith ?& ?nephew|national surgical)\b/i

const NAME_WORK = /\b(rhh|calvary|st johns|lgh|cssd|radiographer|nurse|reg|scrub|anum|floor coordinator|loans|theatre)\b/i

/** Which group a phone contact's own words put them in. */
export function phoneGroup(card) {
  const t = `${card.org || ''} ${card.title || ''} ${card.name || ''}`
  if (/\b(reg|registrar|fellow|resident|intern)\b/i.test(t)) return 'Registrar/Fellow'
  if (/\b(device technologies|e4|signus|depuy|synthes|stryker|medtronic|globus|kt medical|evolution|brainlab|seaspine|orthofix|zimmer|nephew|national surgical|orthotech|surgical|sales|product specialist|product manager|territory)\b/i.test(t)) return 'Rep/Partner'
  if (/\b(surgeon|neurosurgeon|anaesthetist|neuro-?interventionist)\b|\b(ortho\w*|neuro\w*|spine|spinal)\s+consultant\b/i.test(t)) return 'Surgeon'
  if (/\b(stores|loans|booking|floor coordinator|theatre coordinator)\b/i.test(t)) return 'Hospital admin'
  if (/\b(nurse|anum|num|cnc|scrub|theatre|cssd|tech|radiograph\w*|ward|icu)\b/i.test(t)) return 'Theatre/Nursing'
  return 'Other'
}

const HOSPITAL_WORDS = [[/\b(rhh|royal hobart)\b/i, 'RHH'], [/\b(calvary|lenah valley|st johns)\b/i, 'Calvary'], [/\b(lgh|launceston general)\b/i, 'LGH'], [/hobart private/i, 'Hobart Private'], [/\bnwrh\b/i, 'NWRH']]

/**
 * Work contacts that are only in the phone (Brent, 25 Nov 2026: "a bunch of
 * the mobile phone numbers haven't come across" — registrars, theatre staff
 * and reps he texts but never emails). Never added by themselves: shown for a
 * person to tick. Clinical people come ticked, reps and anything else not.
 */
function workCards(cards, contacts, byEmail, byName) {
  const out = new Map()
  for (const card of cards) {
    if (card.emails.some(e => byEmail.has(e)) || byName.get(cardKey(card.name))) continue
    const mobile = card.phones.map(normaliseMobile).find(p => /^\+614\d{8}$/.test(p))
    // The org and title say where someone works; a name only when it is a role ("Calvary Loans", "Rhh nurse").
    if (!mobile || !card.name || !(WORK.test(`${card.org} ${card.title}`) || NAME_WORK.test(card.name))) continue
    if (contacts.some(c => c.mobile === mobile)) continue
    const key = `${nameKey(card.name)}|${mobile}`
    if (out.has(key)) continue
    const group = phoneGroup(card)
    const where = `${card.org} ${card.title}`
    out.set(key, {
      key, name: card.name.replace(/\s+/g, ' ').trim(), mobile, email: card.emails[0] || '',
      group, hospital: HOSPITAL_WORDS.find(([re]) => re.test(where))?.[1] || '',
      title: [card.title, card.org].filter(Boolean).join(' · ').slice(0, 100),
      suggested: ['Surgeon', 'Registrar/Fellow', 'Theatre/Nursing', 'Hospital admin'].includes(group)
    })
  }
  return [...out.values()].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.name.localeCompare(b.name))
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

/** One CSV line into cells, quotes honoured. */
function csvCells(line) {
  const out = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false; else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map(c => c.trim())
}

const GROUP_WORDS = [
  [/registrar|fellow|\breg\b|resident|jmo/i, 'Registrar/Fellow'],
  [/surgeon|consultant|neurosurg|orthopaed|\bvmo\b/i, 'Surgeon'],
  [/nurse|\bnum\b|\banum\b|theatre|cssd|scrub|radiograph|perioperative|sterilis/i, 'Theatre/Nursing'],
  [/\brep\b|partner|distributor|sales/i, 'Rep/Partner'],
  [/admin|booking|secretar|coordinator|manager|mailbox/i, 'Hospital admin']
]

/** A typed group word ("Registrar", "NUM", "Surgeon?") as one of GROUPS. */
export function groupFrom(...words) {
  const said = words.filter(Boolean).join(' ')
  const exact = GROUPS.find(g => g.toLowerCase() === said.trim().toLowerCase())
  if (exact) return exact
  for (const [re, g] of GROUP_WORDS) if (re.test(said)) return g
  return 'Other'
}

/**
 * A list to import — a spreadsheet saved as CSV (a header row naming name,
 * group, hospital, title, email, mobile, tags) or the JSON the email sweep
 * writes. Returns contacts in the server's import shape.
 */
export function parseContactList(textOrJson) {
  const text = String(textOrJson || '').trim()
  let rows = []
  if (text.startsWith('[')) {
    try { rows = JSON.parse(text) } catch { rows = [] }
    return rows.filter(r => r && (r.name || r.email)).map(r => ({
      name: r.name, email: r.email, otherEmails: r.otherEmails || [],
      mobile: (r.phones || []).map(normaliseMobile).find(p => /^\+614\d{8}$/.test(p)) || r.mobile || '',
      group: groupFrom(r.group === 'Unknown' || r.group === 'Shared mailbox' ? '' : r.group, r.title),
      hospital: r.organisation || r.hospital || '', title: [r.title, r.department].filter(Boolean).join(' · '),
      lastSeen: r.lastSeen || '', tags: r.group === 'Shared mailbox' ? ['shared mailbox'] : []
    }))
  }
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const head = csvCells(lines[0]).map(h => h.toLowerCase())
  const col = (...names) => head.findIndex(h => names.some(n => h.includes(n)))
  const at = {
    name: col('name'), group: col('group', 'role', 'type'), hospital: col('hospital', 'organisation', 'org', 'company'),
    title: col('title', 'position'), email: col('email'), mobile: col('mobile', 'phone'), tags: col('tag'), keep: col('keep')
  }
  for (const line of lines.slice(1)) {
    const c = csvCells(line)
    const get = k => (at[k] >= 0 ? c[at[k]] || '' : '')
    if (at.keep >= 0 && /^n/i.test(get('keep'))) continue
    const name = get('name')
    if (!name) continue
    rows.push({
      name, email: get('email').split(/[;\s]+/)[0] || '', mobile: normaliseMobile(get('mobile').split(';')[0]),
      group: groupFrom(get('group'), get('title')), hospital: get('hospital'), title: get('title'),
      tags: get('tags') ? get('tags').split(/[;|]/).map(t => t.trim()).filter(Boolean) : []
    })
  }
  return rows
}
