// Instrument trays and implant trays, each group in the kit's own order
// (Brent, 21 Nov 2026: "group instrument trays and implant trays together.
// With the order of trays").
//
// A tray is an implant tray when most of its lines are implants. A tray with
// nothing listed yet goes by its name: words for instruments first (a "Screw
// Removal" tray holds drivers, not screws), then words for implants.

const INSTRUMENT_WORDS = /\b(instrument|insertion|inserter|driver|removal|retractor|reduction|torque|dilator|distractor|compressor|tower|tap|power|nav|navigation|drill|handle|bender)/i
const IMPLANT_WORDS = /\b(implant|screws?|rods?|tulips?|heads?|cages?|plates?|set screws?|caps?|connectors?|hooks?|graft)\b/i

export function trayKind(tray) {
  const lines = tray?.lines || []
  if (lines.length) {
    const implants = lines.filter(l => l.kind === 'implant').length
    return implants * 2 > lines.length ? 'implant' : 'instrument'
  }
  const name = String(tray?.name || '')
  if (INSTRUMENT_WORDS.test(name)) return 'instrument'
  if (IMPLANT_WORDS.test(name)) return 'implant'
  return 'instrument'
}

// Sterile implants apart, at the bottom (Brent, 21 Nov 2026: "Sterile
// implants for Shoreline, Catenary ALIF, Global PLIF, MOBIS and Athlet need
// to be listed separately at the bottom of the trays in their own section").
// For those systems every implant tray is the sterile stock; anywhere else a
// tray that says "sterile" in its name is.
export const STERILE_SYSTEMS = /shoreline|catenary|\balif\b|global|\bbmd\b|mobis|athlet/i
export function isSterileTray(tray, system = '') {
  const name = String(tray?.name || '')
  if (/sterile/i.test(name)) return true
  if (!STERILE_SYSTEMS.test(`${system} ${name}`)) return false
  return trayKind(tray) === 'implant' || /\b(implants?|interbod(y|ies)|cages?)\b/i.test(name)
}

/** The trays as groups — instruments, implants, then sterile implants — each in the order given. */
export function groupTrays(trays, { system = '' } = {}) {
  const groups = [
    { kind: 'instrument', label: 'Instrument trays', trays: [] },
    { kind: 'implant', label: 'Implant trays', trays: [] },
    { kind: 'sterile', label: 'Sterile implants', trays: [] }
  ]
  for (const t of trays || []) {
    if (isSterileTray(t, system)) groups[2].trays.push(t)
    else groups[trayKind(t) === 'implant' ? 1 : 0].trays.push(t)
  }
  return groups.filter(g => g.trays.length)
}
