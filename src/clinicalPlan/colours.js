// ─── Calendar colour hygiene ──────────────────────────────────────────────────
// The team picks event colours BY NAME in Google Calendar. This module maps
// what the API returns (a numeric colorId) to those names, and reports
// mismatches. It never modifies anything — the calendar stays the source of
// truth and the portal only reports (§5.4, §12).

// Google Calendar's fixed event palette. The API gives colorId; the UI shows
// names, so the guide can only be checked through this table.
export const GOOGLE_COLOR_NAMES = {
  1: 'Lavender',
  2: 'Sage',
  3: 'Grape',
  4: 'Flamingo',
  5: 'Banana',
  6: 'Tangerine',
  7: 'Peacock',
  8: 'Graphite',
  9: 'Blueberry',
  10: 'Basil',
  11: 'Tomato'
}

// The same palette as hexes, for drawing. The calendar is now the source of a
// case's colour — the app shows what the person who made the booking chose — so
// these are what the plan and the day view actually paint with.
export const GOOGLE_COLOR_HEX = {
  1: '#7986cb', // Lavender
  2: '#33b679', // Sage
  3: '#8e24aa', // Grape
  4: '#e67c73', // Flamingo
  5: '#f6c026', // Banana
  6: '#f5511d', // Tangerine
  7: '#039be5', // Peacock
  8: '#616161', // Graphite
  9: '#3f51b5', // Blueberry
  10: '#0b8043', // Basil
  11: '#d50000' // Tomato
}

/** The hex a booking is actually drawn in, or null if it has no colour set. */
export function colourHexFor(colorId) {
  if (colorId == null) return null
  return GOOGLE_COLOR_HEX[Number(colorId)] || null
}

// The booking guide: which colour name each surgeon should be given.
export const SURGEON_COLOUR_NAMES = {
  Hannan: 'Cobalt',
  Dubey: 'Graphite',
  Thani: 'Sage',
  Fowler: 'Grape',
  Ibbett: 'Banana',
  JPW: 'Flamingo',
  Gupta: 'Basil',
  Atallah: 'Tangerine',

  // ── Maxillofacial ──
  //
  // One colour between the five of them, which breaks the one-surgeon-one-colour
  // rule on purpose. Google has eleven colours and the spine guide already uses
  // eight; there are not five distinct ones left to give. And these cases are
  // occasional and nearly always the same job — AIRO support for a post-operative
  // CT — so a colour that reads "Max Fax" at a glance is worth more on a week
  // view than five hues nobody could tell apart.
  //
  // Say the word and they can have their own; it is one line each once Google
  // has the colours to spare.
  Garg: 'Lavender',
  Varidel: 'Lavender',
  Silifent: 'Lavender',
  Ong: 'Lavender',
  Carter: 'Lavender'
}

/**
 * Which service a surgeon belongs to, for the pickers.
 *
 * Grouped because the two lists are chosen from at different moments and by
 * different people, and a flat list of thirteen names makes the common eight
 * harder to find.
 */
export const SURGEON_SERVICES = [
  { service: 'Spine', surgeons: ['Atallah', 'Dubey', 'Fowler', 'Gupta', 'Hannan', 'Ibbett', 'JPW', 'Thani'] },
  { service: 'Max Fax', surgeons: ['Carter', 'Garg', 'Ong', 'Silifent', 'Varidel'] }
]

export const OTHER_COLOUR_NAMES = {
  Brainlab: 'Blueberry',
  'General alerts': 'Tomato'
}

const COLOUR_TO_SURGEON = Object.entries(SURGEON_COLOUR_NAMES)
  .reduce((acc, [surgeon, colour]) => {
    acc[colour.toLowerCase()] = surgeon
    return acc
  }, {})

/**
 * The Google palette id a surgeon's booking should carry, per the guide.
 *
 * The app draws a case in the surgeon's colour whatever the booking says, so
 * this is not for rendering — it is for fixing *Google*. A booking entered with
 * no colour, or the wrong one, looks right in the portal and wrong in the
 * calendar everyone else is reading, and this is what lets the portal offer to
 * put it right.
 */
export function guideColorIdFor(surgeon) {
  const name = SURGEON_COLOUR_NAMES[surgeon]
  if (!name) return null
  const id = Object.keys(GOOGLE_COLOR_NAMES).find(
    key => GOOGLE_COLOR_NAMES[key].toLowerCase() === name.toLowerCase())
  return id || null
}

export function colourNameFor(colorId) {
  if (colorId == null) return null
  return GOOGLE_COLOR_NAMES[Number(colorId)] || null
}

export function surgeonForColourName(name) {
  if (!name) return null
  return COLOUR_TO_SURGEON[String(name).toLowerCase()] || null
}

// checkEventColour and summariseColourFindings lived here and are gone. The plan
// draws each case in the colour its booking carries, so there is nothing to check
// a case against, and the note they produced told the reader something they could
// already see. What remains is the part that does work: reading a surgeon *from* a
// colour, for a booking whose title does not name one.
