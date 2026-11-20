// ─── The kit room by system (Brent, 20 Nov 2026) ─────────────────────────────
// "For all systems remove the multiple kit options, like Diplomat 1, 2 and 3.
// What we want is a system tab and then you open that and within that you have
// the individual trays listed." Then: "We will just have Diplomat and then
// under that we will label each tray as Diplomat Pedicle Screws 1-5 … No set
// numbers." Each hospital set is still its own record underneath — that is
// what knows where a tray physically is — but the room shows one tile per
// system and a person never sees "Diplomat 2".

export const PLACE_ORDER = ['CLV', 'RHH', 'office']

/** The system a kit belongs to: its system, else its name without a set number. */
export function systemOf(kit) {
  const s = String(kit?.system || '').trim()
  if (s) return s
  return String(kit?.name || '').replace(/\s*\(TM loan\)\s*$/i, '').replace(/\s+\d+$/, '').trim()
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

/** Trays at each place, counting trays that have travelled on their own. */
export function traysByPlace(kits) {
  const out = {}
  for (const k of kits || []) {
    const moved = new Set(k.away?.trays || [])
    for (const t of k.trays || []) {
      const at = k.away && (!moved.size || moved.has(t)) ? k.at : k.home
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
  const here = all.filter(k => k.home === place)
  const kit = here.find(k => k.kind !== 'floating') || here[0]
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
