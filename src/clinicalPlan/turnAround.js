// ─── What happens to a kit after the case (Brent, 21 Nov 2026) ──────────────
// "We need an option to 'turn a kit around' … When we do usage with a loan kit
// that is at a hospital, or … a kit that is being reused the next day, I want
// the portal to look ahead and ask … 'Are you holding onto the kit for pt xyz,
// and do you need to let Sharon and Calvary loans know to hold onto it and
// turn it around?' … prompt the staff member to put priority tags on the kit
// if it is being used the next day … If the portal can't see a booking in the
// future requiring the loan kit, it can ask 'what's happening with the kit
// after the case? Is it being returned to distributor or the office?'
// Distributor loan kits go back to distributor and only our TM office kits
// come back to us."
//
// Pure: given the case and the bookings after it, which kits need a question,
// and the wording of the hospital email. Nothing is sent from here.

import { inventoryFor, siteCode, suggestSupply } from './inventory.js'
import { parseKitSupplies, formatKitSupplies } from './kitSupply.js'

export const DISTRIBUTOR_NAMES = { e4: 'E4 Surgical', signus: 'Signus', device: 'Device Technologies', kt: 'KT Medical', globus: 'Globus Medical' }
const SITE_NAMES = { CLV: 'Calvary', RHH: 'RHH' }
const LOAN_KIND = { 'Distributor Loan': 'distributor', 'TM Loan': 'tm', 'Calvary Loan': 'hospital', 'RHH Loan': 'hospital' }
export const LOOK_AHEAD_DAYS = 28

const sameSystem = (a, b) => {
  const x = inventoryFor(a)?.system || String(a || '')
  const y = inventoryFor(b)?.system || String(b || '')
  return x.toLowerCase().replace(/\s+/g, ' ').trim() === y.toLowerCase().replace(/\s+/g, ' ').trim()
}
const dayNumber = d => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000)
export const daysApart = (a, b) => dayNumber(b) - dayNumber(a)
export const systemKey = s => String(inventoryFor(s)?.system || s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * The kits on a case that need a decision after it: every loan kit (with the
 * next booking that wants it, or none), and a consignment kit only when it is
 * wanted again the same or next day (priority tags).
 * @param theCase { id, date, hour?, hospital, supplies: [{system, supply}] }
 * @param bookings upcoming bookings in the same shape
 */
export function afterCase(theCase, bookings = []) {
  const site = siteCode(theCase?.hospital)
  if (!theCase || !site) return []
  const out = []
  for (const entry of theCase.supplies || []) {
    const item = inventoryFor(entry.system)
    if (!item) continue
    const supply = entry.supply || suggestSupply(entry.system, theCase.hospital)
    const kind = LOAN_KIND[supply] || (supply === 'Consignment' ? 'consignment' : null)
    if (!kind) continue
    const next = bookings
      .filter(b => b.id !== theCase.id && !b.cancelled && siteCode(b.hospital) === site)
      .filter(b => b.date > theCase.date || (b.date === theCase.date && (b.hour ?? 24) >= (theCase.hour ?? 0)))
      .filter(b => daysApart(theCase.date, b.date) <= LOOK_AHEAD_DAYS)
      .filter(b => (b.supplies || []).some(s => sameSystem(s.system, entry.system)))
      .sort((a, b) => (a.date === b.date ? (a.hour ?? 24) - (b.hour ?? 24) : a.date < b.date ? -1 : 1))[0] || null
    const soon = Boolean(next) && daysApart(theCase.date, next.date) <= 1
    if (kind === 'consignment' && !soon) continue
    const home = kind === 'hospital' ? (supply === 'Calvary Loan' ? 'CLV' : 'RHH') : null
    out.push({
      system: item.system,
      key: systemKey(entry.system),
      supply,
      kind,
      distributor: item.distributor || '',
      distributorName: DISTRIBUTOR_NAMES[item.distributor] || item.distributor || '',
      site,
      siteName: SITE_NAMES[site] || site,
      home,
      homeName: home ? SITE_NAMES[home] : '',
      next: next ? { id: next.id, patient: next.patient, surgeon: next.surgeon, date: next.date, procedure: next.procedure || '' } : null,
      priority: soon
    })
  }
  return out
}

/** Where a kit goes when nothing wants it next: the distributor's, ours, or the other hospital. */
export function returnTo(entry) {
  if (entry.kind === 'distributor') return entry.distributorName || 'the distributor'
  if (entry.kind === 'tm') return 'the TechnoMed office'
  if (entry.kind === 'hospital') return entry.homeName || 'its hospital'
  return ''
}

const longDay = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const what = entry => `${entry.system}${entry.kind === 'distributor' ? ` (${entry.distributorName} loan set)` : entry.kind === 'tm' ? ' (TechnoMed loan set)' : entry.kind === 'hospital' ? ` (borrowed from ${entry.homeName})` : ''}`

/**
 * The email to the hospital's loans team. `outcome`: 'hold' (turn it around
 * for entry.next) or 'return'. Plain text — sendBookingNotice letterheads it.
 */
export function kitAfterEmail({ greeting = 'Loans team', theCase, entry, outcome }) {
  const caseLine = `pt ${theCase.patient}${theCase.surgeon ? ` (${theCase.surgeon}, ${longDay(theCase.date)})` : ` (${longDay(theCase.date)})`}`
  if (outcome === 'hold' && entry.next) {
    const n = entry.next
    const nextLine = `pt ${n.patient}${n.surgeon ? ` with ${n.surgeon}` : ''} on ${longDay(n.date)}`
    const lines = [
      `Hi ${greeting},`,
      '',
      `Please hold on to the ${what(entry)} after ${caseLine} at ${entry.siteName} — we are keeping it on site and turning it around for ${nextLine}.`,
      entry.kind === 'distributor' ? `Please don't send it back to ${entry.distributorName}.` : 'Please keep it here rather than sending it back.',
      entry.priority ? `It is needed again ${daysApart(theCase.date, n.date) === 0 ? 'later today' : 'tomorrow'}, so please process it as a priority.` : '',
      '',
      'Thank you.'
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '')
    return { subject: `Hold the ${entry.system} kit — turn around for pt ${n.patient} ${longDay(n.date)}`, text: lines.join('\n'), label: 'Kit turnaround' }
  }
  const to = returnTo(entry)
  const lines = [
    `Hi ${greeting},`,
    '',
    entry.kind === 'distributor'
      ? `The ${what(entry)} used for ${caseLine} is finished with. Please send it back to ${entry.distributorName} once it is processed.`
      : entry.kind === 'tm'
        ? `The ${what(entry)} used for ${caseLine} is finished with. It comes back to the TechnoMed office — please leave it in our bay once it is processed and we will collect it.`
        : `The ${what(entry)} used for ${caseLine} is finished with. It goes back to ${to} once it is processed.`,
    '',
    'Thank you.'
  ]
  return { subject: `${entry.system} kit after pt ${theCase.patient} — back to ${to}`, text: lines.join('\n'), label: 'Kit return' }
}

// ─── "Which patient was this actually used for?" (Ben, 24 Nov 2026) ─────────
// Two cases at one hospital on one day share a system — one on the hospital's
// consignment set, one on a loan set — and on the day the sets are used the
// other way round (pt Hart had the Calvary Dakota, the TM loan Dakota went to
// the next case). The bookings, and so the kit question and its email, then
// name the wrong patient. These let the person say so: the two bookings swap
// that system's supply, and nothing else on either changes.

/** The other live cases that day, same hospital, same system, a different supply. */
export function swapCandidates(theCase, sameDay = [], system) {
  const site = siteCode(theCase?.hospital)
  const mine = (theCase?.supplies || []).find(s => sameSystem(s.system, system))
  if (!site || !mine) return []
  const minesSupply = mine.supply || suggestSupply(mine.system, theCase.hospital) || ''
  return (sameDay || [])
    .filter(b => b.id !== theCase.id && !b.cancelled && b.date === theCase.date && siteCode(b.hospital) === site)
    .map(b => ({ b, s: (b.supplies || []).find(x => sameSystem(x.system, system)) }))
    .filter(({ s }) => s && (s.supply || '') !== minesSupply)
    .map(({ b, s }) => ({ id: b.id, patient: b.patient, surgeon: b.surgeon || '', supply: s.supply || null, hour: b.hour ?? null }))
}

/**
 * The two kit lines with that system's supply swapped, or null when either
 * line does not carry the system. Every other system and note is kept.
 */
export function swapKitSupply(kitA, kitB, system) {
  const a = parseKitSupplies(kitA)
  const b = parseKitSupplies(kitB)
  const ia = a.findIndex(e => !e.navigation && sameSystem(e.system, system))
  const ib = b.findIndex(e => !e.navigation && sameSystem(e.system, system))
  if (ia < 0 || ib < 0) return null
  const sa = a[ia].supply
  const sb = b[ib].supply
  if ((sa || '') === (sb || '')) return null
  a[ia] = { ...a[ia], supply: sb }
  b[ib] = { ...b[ib], supply: sa }
  return { a: formatKitSupplies(a), b: formatKitSupplies(b), was: { a: sa, b: sb } }
}

/** A title that names the old supply in brackets names the new one; otherwise it is left alone. */
export function retitleSupply(summary, from, to) {
  const text = String(summary || '')
  if (!from) return text
  const re = new RegExp(`\\(\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`, 'i')
  if (!re.test(text)) return text
  return to ? text.replace(re, `(${to})`) : text.replace(new RegExp(`\\s*${re.source}`, 'i'), '')
}
