import { redis, redisSetBody } from './_redis.js'
import { INVENTORY } from '../src/clinicalPlan/inventory.js'
import { STAFF } from '../src/staffConfig.js'
import { getNoticeSettings } from './_bookingNotices.js'

// ─── The kit room: where every set is, and telling the hospitals ────────────
// "We move the kit in the portal which updates the kit locations and then the
// kit gets moved back when it is returned. I don't think we need to update the
// loans teams when we are returning it… we don't want inaccurate comms going
// to either team." — Brent, 1 Nov 2026.
//
// The old kit room kept nothing: moves and statuses lived in one phone's
// memory and were gone on reload. This keeps them in Redis, shared.
//
// Three rules carry the "no inaccurate comms" requirement:
//
//   1. Every email is shown in full before it goes, and only the person moving
//      the kit can send it. Recipients come from here, never from the request.
//   2. Hospital emails are OFF until an admin turns them on — after the
//      stock-take has confirmed where everything actually is. Until then a move
//      is recorded and the email is shown as "would have gone to".
//   3. A return never emails anybody. Brent's call.
//
// Storage. The list of kits is one key; each kit's whereabouts is its own key,
// so two people moving two different kits at once cannot overwrite each other.

const DEFS = 'kits:defs'
const LOC = id => `kits:loc:${id}`
const HISTORY = 'kits:history'
const SETTINGS = 'kits:settings'
const PENDING = id => `kits:pending:${id}`

export const PLACES = {
  office: { short: 'TM office', long: 'the TechnoMed office' },
  CLV: { short: 'Calvary', long: 'Calvary Lenah Valley' },
  RHH: { short: 'RHH', long: 'the Royal Hobart Hospital' }
}
const HOSPITAL_CONTACT = { CLV: 'calvary_loans', RHH: 'rhh_loans' }

// Tray lists the team has already written out in their own transfer emails.
// Everything else starts empty and is filled in during the stock-take.
const KNOWN_TRAYS = {
  Diplomat: ['Rods and tulips 3-5', 'Rods and tulips 1-3', 'Pedicle screws 2-5',
    'Pedicle screws DNO 1', 'Iliac/pelvic screws tray', 'Insertion 2-1', 'Torque and reduction 3-2'],
  Lonestar: ['Lonestar insertion', 'Lonestar implants', 'KT Medical bed arm']
}

// TechnoMed's own kits, from the old kit room page. Not in INVENTORY because
// they never need a distributor's loan set.
const TECHNOMED_KITS = [
  { system: 'TM Screw Removal', distributor: 'technomed', home: 'CLV', kind: 'technomed' },
  { system: 'TM Locking Distractor', distributor: 'technomed', home: 'CLV', kind: 'technomed' }
  // Reform Lumbar was here as a TM loan at the office; it went back to E4
  // Surgical (Brent, 2 Nov 2026).
]

// Changes to a kit list already saved in Redis. The seed only runs once, so a
// correction to it alone never reaches the live portal. Each runs once.
export const KIT_CORRECTIONS = [
  { id: 'outrigger-consigned-clv-2026-11-02',
    replace: { from: 'mariner-outrigger-floating', to: {
      id: 'mariner-outrigger-clv', name: 'Mariner Outrigger', system: 'Mariner Outrigger',
      distributor: 'device', kind: 'consignment', home: 'CLV' } } },
  { id: 'reform-lumbar-returned-2026-11-02', remove: 'reform-lumbar-office' }
]

/** Applies corrections not yet applied. Returns null when nothing changed. */
export function correctKits(defs, applied = []) {
  const due = KIT_CORRECTIONS.filter(c => !applied.includes(c.id))
  if (!due.length) return null
  let kits = defs
  for (const fix of due) {
    if (fix.remove) kits = kits.filter(k => k.id !== fix.remove)
    if (fix.replace) {
      const old = kits.find(k => k.id === fix.replace.from)
      const next = { trays: old?.trays || [], ...fix.replace.to }
      kits = old
        ? kits.map(k => (k.id === fix.replace.from ? next : k))
        : kits.some(k => k.id === next.id) ? kits : [...kits, next]
    }
  }
  return { kits, applied: [...applied, ...due.map(c => c.id)] }
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * The first list, from what Brent dictated in September (inventory.js).
 * Only a starting point: the stock-take is what makes it true.
 */
export function seedKits() {
  const kits = []
  for (const item of INVENTORY) {
    for (const [site, count] of Object.entries(item.consigned || {})) {
      for (let n = 1; n <= count; n += 1) {
        kits.push({
          id: slug(`${item.system}-${site}${count > 1 ? `-${n}` : ''}`),
          name: count > 1 ? `${item.system} ${n}` : item.system,
          system: item.system, distributor: item.distributor || '',
          kind: 'consignment', home: site,
          trays: [...(KNOWN_TRAYS[item.system] || [])]
        })
      }
    }
    for (let n = 1; n <= (item.floating || 0); n += 1) {
      kits.push({
        id: slug(`${item.system}-floating${item.floating > 1 ? `-${n}` : ''}`),
        name: `${item.system} (TM loan)`, system: item.system, distributor: item.distributor || '',
        kind: 'floating', home: 'office',
        trays: [...(KNOWN_TRAYS[item.system] || [])]
      })
    }
  }
  for (const k of TECHNOMED_KITS) {
    const id = slug(`${k.system}-${k.home}`)
    if (!kits.some(x => x.id === id)) {
      kits.push({ id, name: k.system, system: k.system, distributor: k.distributor, kind: k.kind, home: k.home, trays: [] })
    }
  }
  return kits
}

export async function getKitSettings() {
  try {
    const raw = await redis('get', SETTINGS)
    if (raw) return { emailsOn: false, ...JSON.parse(raw) }
  } catch { /* defaults */ }
  return { emailsOn: false }
}

export async function saveKitSettings({ emailsOn }, by) {
  const settings = { emailsOn: Boolean(emailsOn), changedBy: by, changedAt: new Date().toISOString() }
  await redisSetBody(SETTINGS, JSON.stringify(settings))
  await addHistory({ kind: 'setting', text: `Hospital emails turned ${settings.emailsOn ? 'on' : 'off'}`, by })
  return settings
}

const APPLIED = 'kits:applied'

async function getDefs() {
  const raw = await redis('get', DEFS)
  if (!raw) {
    const kits = seedKits()
    await redisSetBody(DEFS, JSON.stringify(kits))
    await redisSetBody(APPLIED, JSON.stringify(KIT_CORRECTIONS.map(c => c.id)))
    return kits
  }
  const defs = JSON.parse(raw)
  let applied = []
  try { applied = JSON.parse((await redis('get', APPLIED)) || '[]') } catch { applied = [] }
  const corrected = correctKits(defs, applied)
  if (!corrected) return defs
  await redisSetBody(DEFS, JSON.stringify(corrected.kits))
  await redisSetBody(APPLIED, JSON.stringify(corrected.applied))
  // Where the old kit was recorded, the new one starts fresh at its home.
  await redis('del', LOC('mariner-outrigger-floating')).catch(() => {})
  return corrected.kits
}

/** Every kit with where it is now. */
export async function listKits() {
  const defs = await getDefs()
  const locs = defs.length ? await redis('mget', ...defs.map(k => LOC(k.id))) : []
  return defs.map((kit, i) => {
    let loc = null
    try { loc = locs[i] ? JSON.parse(locs[i]) : null } catch { loc = null }
    return {
      ...kit,
      at: loc?.at || kit.home,
      away: loc?.at && loc.at !== kit.home ? loc : null,
      checkedAt: loc?.checkedAt || null,
      checkedBy: loc?.checkedBy || null
    }
  })
}

async function getLoc(id) {
  const raw = await redis('get', LOC(id))
  return raw ? JSON.parse(raw) : null
}

async function setLoc(id, loc) {
  await redisSetBody(LOC(id), JSON.stringify(loc))
}

async function addHistory(entry) {
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() })
  await redis('lpush', HISTORY, line)
  await redis('ltrim', HISTORY, 0, 499)
}

export async function kitHistory(limit = 100) {
  const raw = await redis('lrange', HISTORY, 0, limit - 1)
  return (raw || []).map(r => { try { return JSON.parse(r) } catch { return null } }).filter(Boolean)
}

/** Adds, edits or removes a kit in the list. Trays are the usual reason. */
export async function saveKitDef(kit, by) {
  const defs = await getDefs()
  const name = String(kit?.name || '').trim().slice(0, 60)
  if (!name) throw new Error('A kit needs a name')
  if (!PLACES[kit.home]) throw new Error('Choose where the kit lives')
  const trays = (kit.trays || []).map(t => String(t).trim().slice(0, 80)).filter(Boolean).slice(0, 40)
  const id = kit.id || `${slug(name)}-${Date.now().toString(36)}`
  const clean = {
    id, name, system: String(kit.system || name).slice(0, 60),
    distributor: String(kit.distributor || '').slice(0, 30),
    kind: ['consignment', 'floating', 'technomed'].includes(kit.kind) ? kit.kind : 'consignment',
    home: kit.home, trays
  }
  const at = defs.findIndex(k => k.id === id)
  const next = at >= 0 ? defs.map(k => (k.id === id ? clean : k)) : [...defs, clean]
  await redisSetBody(DEFS, JSON.stringify(next))
  await addHistory({ kind: 'edit', kitId: id, kitName: name, text: at >= 0 ? 'Kit details changed' : 'Kit added', by })
  return clean
}

export async function removeKitDef(id, by) {
  const defs = await getDefs()
  const kit = defs.find(k => k.id === id)
  if (!kit) throw new Error('No such kit')
  await redisSetBody(DEFS, JSON.stringify(defs.filter(k => k.id !== id)))
  await redis('del', LOC(id))
  await addHistory({ kind: 'edit', kitId: id, kitName: kit.name, text: 'Kit removed', by })
}

/** Stock-take: "it is here, I have seen it." */
export async function checkKit(id, at, by) {
  if (!PLACES[at]) throw new Error('Choose where the kit is')
  const kit = (await getDefs()).find(k => k.id === id)
  if (!kit) throw new Error('No such kit')
  const loc = (await getLoc(id)) || {}
  const moved = (loc.at || kit.home) !== at
  const next = moved
    ? { at, since: new Date().toISOString(), by, trays: kit.trays, note: 'Found here at stock-take' }
    : { ...loc }
  await setLoc(id, { ...next, at, checkedAt: new Date().toISOString(), checkedBy: by })
  await addHistory({
    kind: 'check', kitId: id, kitName: kit.name, to: at, by,
    text: moved ? `Stock-take: found at ${PLACES[at].short}` : `Stock-take: confirmed at ${PLACES[at].short}`
  })
}

// ─── The email ───────────────────────────────────────────────────────────────

function longDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'][d.getUTCMonth()]
  return `${day} ${Number(m[3])} ${month}`
}
const shortDate = s => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? `${Number(m[2])}/${Number(m[1])}` : '' }

const KIND_WORD = { consignment: 'consignment', floating: 'TechnoMed loan', technomed: 'TechnoMed' }

/**
 * Who hears about a move, and the words they get. Pure, so it can be tested
 * line by line — this is the part that must never say something untrue.
 *
 * Into a hospital: that hospital. Out of one hospital into the other: both.
 * Into the office: nobody (it is ours, and returns are not announced).
 */
export function draftKitEmail({ kit, from, to, trays, date, today, caseDate, surname, note, sender, contacts, team }) {
  if (to === 'office' || !HOSPITAL_CONTACT[to]) return null
  const hospitals = [to, ...(HOSPITAL_CONTACT[from] && from !== to ? [from] : [])]
  const people = hospitals.map(h => contacts.find(c => c.id === HOSPITAL_CONTACT[h])).filter(Boolean)
  if (!people.length) return null
  const toList = [...new Set(people.flatMap(p => p.to || []))]
  const ccList = [...new Set([...people.flatMap(p => p.cc || []), 'bookings@technomed.com.au', ...team]
    .filter(a => !toList.map(x => x.toLowerCase()).includes(String(a).toLowerCase())))]
  const names = people.map(p => p.greeting || p.name)
  // "Hi Katelin, Sharon and Loans team" — the receiving hospital first.
  const greeting = names.join(', ')

  const when = !date || date === today ? 'today' : `on ${longDate(date)}`
  const allTrays = kit.trays || []
  const sending = trays && trays.length ? trays : allTrays
  const partial = allTrays.length > 0 && sending.length < allTrays.length
  const what = `${kit.system} ${KIND_WORD[kit.kind] || ''} ${sending.length === 1 ? 'tray' : 'trays'}`.replace(/\s+/g, ' ')

  const lines = [
    `Hi ${greeting},`,
    '',
    `Just letting you know TechnoMed ${when === 'today' ? 'is moving' : 'will be moving'} the ${what} from ${PLACES[from]?.long || from} to ${PLACES[to].long} ${when}.`,
    ''
  ]
  if (sending.length) {
    lines.push(`${kit.system}${partial ? ` (${sending.length} of ${allTrays.length} trays)` : ''}:`)
    for (const t of sending) lines.push(`- ${t}`)
    lines.push('')
  }
  if (caseDate) {
    lines.push(`It's needed for a case at ${PLACES[to].short} on ${longDate(caseDate)}${surname ? ` — please assign it to pt ${surname}` : ''}.`)
    lines.push('')
  }
  if (note && String(note).trim()) { lines.push(String(note).trim()); lines.push('') }
  lines.push('Any questions, let me know.', '', 'Thanks,', sender?.firstName || sender?.name || 'TechnoMed')

  const subject = `TechnoMed kit transfer — ${kit.system} to ${PLACES[to].short} ${shortDate(date || today)}`.trim()
  return { to: toList, cc: ccList, subject, text: lines.join('\n') }
}

function clinicalTeam() {
  return STAFF.filter(s => s.isClinicalTeam || s.email === 'brenton@technomed.com.au').map(s => s.email)
}

/**
 * Step one of a move: what will happen, and the email, held for an hour under
 * an id. Nothing is moved or sent yet.
 */
export async function prepareMove({ kitId, to, trays, date, today, caseDate, surname, note }, sender) {
  if (!PLACES[to]) throw new Error('Choose where the kit is going')
  const kit = (await listKits()).find(k => k.id === kitId)
  if (!kit) throw new Error('No such kit')
  if (kit.at === to) throw new Error(`${kit.name} is already at ${PLACES[to].short}`)
  const validTrays = (trays || []).filter(t => (kit.trays || []).includes(t))
  if ((kit.trays || []).length && !validTrays.length) throw new Error('Tick at least one tray')
  const settings = await getKitSettings()
  const { contacts } = await getNoticeSettings()
  const isReturn = to === kit.home
  const email = isReturn ? null : draftKitEmail({
    kit, from: kit.at, to, trays: validTrays, date, today,
    caseDate: /^\d{4}-\d{2}-\d{2}$/.test(caseDate || '') ? caseDate : '',
    surname: String(surname || '').trim().slice(0, 40),
    note: String(note || '').slice(0, 500), sender, contacts,
    team: clinicalTeam().filter(e => e !== sender?.email)
  })
  const id = `${kitId}-${Date.now().toString(36)}`
  const pending = {
    id, kitId, kitName: kit.name, from: kit.at, to, trays: validTrays, date: date || today,
    note: String(note || '').slice(0, 500), caseDate: caseDate || '', surname: String(surname || '').slice(0, 40),
    email, by: sender?.email
  }
  await redisSetBody(PENDING(id), JSON.stringify(pending))
  await redis('expire', PENDING(id), 3600)
  return { ...pending, emailsOn: settings.emailsOn, isReturn }
}

/**
 * Step two: do it. The location changes only here. With `send`, and emails
 * switched on, the email goes first — a move whose email failed is not
 * recorded, so it can be tried again rather than half-done.
 */
export async function confirmMove({ id, send, text }, sender, sendEmail) {
  const raw = await redis('get', PENDING(id))
  if (!raw) throw new Error('This move has expired — start it again')
  const pending = JSON.parse(raw)
  if (pending.by !== sender?.email) throw new Error('Only the person who started this move can confirm it')
  const settings = await getKitSettings()
  let emailed = false
  if (send && pending.email && settings.emailsOn) {
    const body = String(text || pending.email.text).slice(0, 5000)
    await sendEmail({ ...pending.email, text: body }, sender)
    emailed = true
  }
  const kit = (await getDefs()).find(k => k.id === pending.kitId)
  const isReturn = kit && pending.to === kit.home
  const before = (await getLoc(pending.kitId)) || {}
  const checked = { checkedAt: before.checkedAt || null, checkedBy: before.checkedBy || null }
  await setLoc(pending.kitId, isReturn
    ? { at: pending.to, ...checked }
    : {
      ...checked,
      at: pending.to, since: new Date().toISOString(), by: sender?.email, byName: sender?.firstName,
      trays: pending.trays, caseDate: pending.caseDate, surname: pending.surname, note: pending.note,
      date: pending.date
    })
  await redis('del', PENDING(id))
  await addHistory({
    kind: isReturn ? 'return' : 'move', kitId: pending.kitId, kitName: pending.kitName,
    from: pending.from, to: pending.to, trays: pending.trays, by: sender?.firstName || sender?.email,
    emailed, emailTo: emailed ? pending.email.to : [],
    text: `${isReturn ? 'Returned' : 'Moved'} ${PLACES[pending.from]?.short || pending.from} → ${PLACES[pending.to].short}`
      + (emailed ? ' · hospital emailed' : pending.email ? ' · no email sent' : '')
  })
  return { ok: true, emailed }
}

/** A return: home, no email. */
export async function returnKit(kitId, sender) {
  const kit = (await listKits()).find(k => k.id === kitId)
  if (!kit) throw new Error('No such kit')
  if (!kit.away) throw new Error(`${kit.name} is already home`)
  const before = (await getLoc(kitId)) || {}
  await setLoc(kitId, { at: kit.home, checkedAt: before.checkedAt || null, checkedBy: before.checkedBy || null })
  await addHistory({
    kind: 'return', kitId, kitName: kit.name, from: kit.at, to: kit.home,
    by: sender?.firstName || sender?.email,
    text: `Returned ${PLACES[kit.at]?.short || kit.at} → ${PLACES[kit.home].short}`
  })
}
