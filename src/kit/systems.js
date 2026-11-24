// ─── The kit room by system (Brent, 20 Nov 2026) ─────────────────────────────
// "For all systems remove the multiple kit options, like Diplomat 1, 2 and 3.
// What we want is a system tab and then you open that and within that you have
// the individual trays listed." Then: "We will just have Diplomat and then
// under that we will label each tray as Diplomat Pedicle Screws 1-5 … No set
// numbers." Each hospital set is still its own record underneath — that is
// what knows where a tray physically is — but the room shows one tile per
// system and a person never sees "Diplomat 2".

import { trayPlace } from './trayPlaces.js'

export const PLACE_ORDER = ['CLV', 'RHH', 'office']

// The kit room names a system without the operation (Brent, 22 Nov 2026:
// "make Catenary ALIF name just Catenary, and drop PLIF from the Global BMD
// name … system names without the procedure description"). Bookings and the
// inventory keep their own names; this maps between the two.
export const KIT_SYSTEM_NAMES = { 'catenary alif': 'Catenary', 'global bmd plif': 'Global BMD' }
/** The kit room's name for a system named anywhere else ("Catenary ALIF" → "Catenary"). */
export const kitSystemName = s => KIT_SYSTEM_NAMES[String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')] || String(s || '').trim()

// A kit that belongs inside another system's tile (Brent, 20 Nov 2026: the
// Mariner Outrigger "needs to be with the other SeaSpine trays in Calvary").
// Display only: bookings, supplies and moves still use the kit's own system.
const INSIDE = { 'mariner outrigger': 'Mariner' }

/** The system a kit is shown under: its system, else its name without a set number. */
export function systemOf(kit) {
  // "CYLOX Set 2" is a second set of CYLOX, not a system of its own (Brent,
  // 21 Nov 2026: "Cylox and Cylox set 2 should both be put under Cylox").
  const s = String(kit?.system || '').trim().replace(/\s+set\s*\d+$/i, '')
  if (s) return INSIDE[s.toLowerCase()] || s
  return String(kit?.name || '').replace(/\s*\(TM loan\)\s*$/i, '').replace(/\s+\d+$/, '').trim()
}

/** A set's own name where it is not the system it is shown under ("Mariner Outrigger"). */
export function setLabel(kit) {
  const own = String(kit?.system || '').trim()
  return own && INSIDE[own.toLowerCase()] ? own : ''
}

/** One entry per system, its sets in place order (Calvary, RHH, office; TM loan last). */
export function groupSystems(kits) {
  const map = new Map()
  for (const k of kits || []) {
    const name = systemOf(k)
    const key = name.toLowerCase()
    if (!map.has(key)) map.set(key, { key, name, kits: [] })
    map.get(key).kits.push(k)
  }
  // A set shown inside another system's tile (the Mariner Outrigger) comes
  // after that system's own set at the same place (Brent, 21 Nov 2026: "should
  // be underneath the Calvary instrument kit; not listed first").
  const rank = k => (k.kind === 'floating' || k.kind === 'loan' ? 10 : 0) + Math.max(0, PLACE_ORDER.indexOf(k.home)) + (setLabel(k) ? 0.5 : 0)
  for (const g of map.values()) g.kits.sort((a, b) => rank(a) - rank(b))
  return [...map.values()]
}

/**
 * Trays at each place, counting trays that have travelled on their own. A set
 * with no trays named yet still counts its place, at 0 (Brent, 21 Nov 2026:
 * "why does it show only one kit at TM office" — the TM loan sets there had no
 * trays listed, so they counted for nothing).
 */
export function traysByPlace(kits) {
  const out = {}
  for (const k of kits || []) if (!(k.trays || []).length) out[k.at || k.home] = out[k.at || k.home] || 0
  for (const k of kits || []) {
    for (const t of k.trays || []) {
      const at = trayPlace(k, t)
      out[at] = (out[at] || 0) + 1
    }
  }
  return out
}

/**
 * Where a new tray goes: the set of this system that lives at that place
 * (a consignment set before a TM loan one), or a new set when the system has
 * none there. Returns { kit } to save — an existing one with the tray added,
 * or a new one.
 */
export function kitForNewTray(group, { system, place, tray, distributor = '' }) {
  const name = String(tray || '').trim()
  if (!name) throw new Error('Give the tray a name')
  const all = (group?.kits || [])
  if (all.some(k => (k.trays || []).some(t => t.toLowerCase() === name.toLowerCase()))) {
    throw new Error(`${system} already has a tray called "${name}"`)
  }
  // The system's own set there, before a TM loan one or one shown inside it (the Outrigger).
  // Never a distributor's loan set: it goes back to them.
  const here = all.filter(k => k.home === place && k.kind !== 'loan')
  const kit = here.find(k => k.kind !== 'floating' && !setLabel(k)) || here.find(k => !setLabel(k)) || here[0]
  if (kit) {
    const { id, name: kitName, system: sys, distributor: d, kind, home, trays } = kit
    return { kit: { id, name: kitName, system: sys, distributor: d, kind, home, trays: [...(trays || []), name] } }
  }
  const like = all[0]
  return {
    kit: {
      name: system, system,
      distributor: distributor || like?.distributor || '',
      kind: place === 'office' && like?.kind === 'floating' ? 'floating' : (like?.kind === 'technomed' ? 'technomed' : 'consignment'),
      home: place, trays: [name]
    }
  }
}

const SHORT_PLACE = { CLV: 'Calvary', RHH: 'RHH', office: 'the office' }
export const DIST_SHORT = { e4: 'E4', signus: 'Signus', device: 'Device', kt: 'KT', globus: 'Globus' }

/**
 * What of a system is away from home, said as where it is now (Brent, 21 Nov
 * 2026: a TM loan set moved to Calvary read "3 trays on the move" — "I should
 * be able to see the TM loan set at Calvary"). A whole set: "TM loan set at
 * Calvary" / "RHH set at Calvary"; trays gone on their own: "2 trays moved to
 * RHH". A move is done once confirmed; nothing here is "on the move".
 */
/**
 * The case a set or tray was moved for, as the move sheet was told (Brent,
 * 21 Nov 2026: "You need to tell me which case it's for as you asked the
 * question in the portal when I did the move"). "pt … · Gupta · Tue 24
 * Nov"; '' when the move named no case. Pure.
 */
export function caseFor(meta) {
  if (!meta || (!meta.surname && !meta.caseDate)) return ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(meta.caseDate || '')
    ? new Date(`${meta.caseDate}T00:00:00Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
    : ''
  const one = [meta.surname ? `pt ${meta.surname}` : '', meta.surgeon || '', day].filter(Boolean).join(' · ')
  // A loan set turned around: the case it came for, then the next one.
  return meta.then ? `${one}, then ${caseFor(meta.then)}` : one
}

export function awayLines(kits) {
  const lines = []
  const strays = {}
  for (const k of kits || []) {
    const at = k.at || k.home
    if (k.kind === 'loan') {
      // A distributor's loan set is news wherever it is (Brent, 21 Nov 2026).
      const held = k.away?.surname ? k.away : k.heldFor
      lines.push(`${DIST_SHORT[k.distributor] || 'Distributor'} loan set at ${SHORT_PLACE[at] || at}${held?.surname ? ` · for pt ${held.surname}${held.then?.surname ? `, then pt ${held.then.surname}` : ''}` : ''}`)
    } else if (at !== k.home) {
      const who = k.kind === 'floating' ? 'TM loan set' : setLabel(k) || `${SHORT_PLACE[k.home] === 'the office' ? 'Office' : SHORT_PLACE[k.home]} set`
      const forCase = k.away?.surname ? ` · for pt ${k.away.surname}` : ''
      lines.push(`${who} at ${SHORT_PLACE[at] || at}${forCase}`)
    }
    for (const p of Object.values(k.trayAt || {})) {
      if (p?.at && p.at !== at) strays[p.at] = (strays[p.at] || 0) + 1
    }
  }
  for (const [at, n] of Object.entries(strays)) lines.push(`${n} ${n === 1 ? 'tray' : 'trays'} moved to ${SHORT_PLACE[at] || at}`)
  return lines
}
