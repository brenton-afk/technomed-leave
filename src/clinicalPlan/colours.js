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
  Atallah: 'Tangerine'
}

export const OTHER_COLOUR_NAMES = {
  Brainlab: 'Blueberry',
  'General alerts': 'Tomato'
}

const COLOUR_TO_SURGEON = Object.entries(SURGEON_COLOUR_NAMES)
  .reduce((acc, [surgeon, colour]) => {
    acc[colour.toLowerCase()] = surgeon
    return acc
  }, {})

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
