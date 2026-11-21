// ─── Where each tray is (Brent, 20 Nov 2026) ─────────────────────────────────
// "We mostly just transfer individual trays between hospitals" and "when we
// move the tray to RHH or Calvary … we don't want it to be absorbed into the
// other Diplomat kit block". A hospital set has one place (`at`); a tray that
// has gone somewhere on its own is in `trayAt`, with who moved it and when, and
// is drawn apart as a transferred tray. Pure, shared by api/_kits.js and the
// kit room. The stored location before this held one `trays` list with the set
// away; `placesFromLoc` reads that as the set at home and those trays away.

const META = ['since', 'by', 'byName', 'date', 'note', 'caseDate', 'surname', 'surgeon']
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] != null && o[k] !== '').map(k => [k, o[k]]))

/** { at, away, trayAt } for a kit definition and its stored location. */
export function placesFromLoc(def, loc) {
  const home = def.home
  const trays = def.trays || []
  const at0 = loc?.at || home
  // The old shape: the set "away" with only some of its trays.
  if (at0 !== home && Array.isArray(loc?.trays) && loc.trays.length && trays.some(t => !loc.trays.includes(t))) {
    const trayAt = {}
    for (const t of loc.trays) if (trays.includes(t)) trayAt[t] = { at: at0, ...pick(loc, META) }
    return { at: home, away: null, trayAt }
  }
  const trayAt = {}
  for (const [t, p] of Object.entries(loc?.trayAt || {})) {
    if (trays.includes(t) && p?.at && p.at !== at0) trayAt[t] = p
  }
  return { at: at0, away: at0 !== home ? loc : null, trayAt }
}

/** Where one tray of a kit (from listKits) is now. */
export function trayPlace(kit, tray) {
  return kit?.trayAt?.[tray]?.at || kit?.at || kit?.home
}

/**
 * The stored location after a move. All the set's trays (or a set with none
 * named) moves the set, and any tray that had gone on its own comes back into
 * it; some trays move on their own, and a tray moved to where its set is
 * rejoins it.
 */
export function applyMove(def, loc, { to, trays, meta = {} }) {
  const now = placesFromLoc(def, loc)
  const all = def.trays || []
  const chosen = (trays || []).filter(t => all.includes(t))
  const checked = { checkedAt: loc?.checkedAt || null, checkedBy: loc?.checkedBy || null }
  const whole = !all.length || all.every(t => chosen.includes(t))
  if (whole) {
    return to === def.home ? { at: to, ...checked } : { ...checked, at: to, ...pick(meta, META), trays: all }
  }
  const trayAt = { ...now.trayAt }
  for (const t of chosen) {
    if (to === now.at) delete trayAt[t]
    else trayAt[t] = { at: to, ...pick(meta, META) }
  }
  const setPart = now.away ? { ...pick(now.away, META), trays: all } : {}
  return { ...checked, at: now.at, ...setPart, trayAt }
}

/** Where the chosen trays are coming from (the first one's place). */
export function movingFrom(kit, trays) {
  const first = (trays || []).find(t => (kit.trays || []).includes(t))
  return first ? trayPlace(kit, first) : kit.at
}
