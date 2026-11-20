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

// A kit that belongs inside another system's tile (Brent, 20 Nov 2026: the
// Mariner Outrigger "needs to be with the other SeaSpine trays in Calvary").
// Display only: bookings, supplies and moves still use the kit's own system.
const INSIDE = { 'mariner outrigger': 'Mariner' }

/** The system a kit is shown under: its system, else its name without a set number. */
export function systemOf(kit) {
  const s = String(kit?.system || '').trim()
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
  const rank = k => (k.kind === 'floating' ? 10 : 0) + Math.max(0, PLACE_ORDER.indexOf(k.home))
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
  const here = all.filter(k => k.home === place)
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
