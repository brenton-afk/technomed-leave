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

// Staffing and on-call entries are often coded Graphite, which officially
// belongs to Dubey. Reported per the standing check, but worded as a probable
// convention rather than an error.
const STAFFING_PATTERN = /on\s*call|late start|early finish|reduced hours|wfh|day off|leave\b/i

/**
 * Checks one event's colour against the booking guide.
 * @returns {null | {kind, severity, eventId, title, date, expected, actual, message}}
 */
export function checkEventColour({ id, title, date, colorId, surgeon, isCase, surgeonsWithCases = [] }) {
  const actual = colourNameFor(colorId)

  // 1. A surgical case with no colour at all.
  if (isCase && !actual) {
    const expected = SURGEON_COLOUR_NAMES[surgeon] || null
    return {
      kind: 'missingColour',
      severity: 'error',
      eventId: id,
      title,
      date,
      surgeon,
      expected,
      actual: null,
      message: expected
        ? `COLOUR-CODING: no calendar colour set — should be ${expected}`
        : 'COLOUR-CODING: no calendar colour set'
    }
  }

  // 2. A surgical case coloured as somebody else.
  if (isCase && actual) {
    const expected = SURGEON_COLOUR_NAMES[surgeon]
    if (expected && actual.toLowerCase() !== expected.toLowerCase()) {
      return {
        kind: 'wrongColour',
        severity: 'error',
        eventId: id,
        title,
        date,
        surgeon,
        expected,
        actual,
        message: `COLOUR-CODING: coloured ${actual} — should be ${expected} for ${surgeon}`
      }
    }
    return null
  }

  // 3. A non-surgical entry wearing a surgeon's colour. Note it; never relabel
  //    it as that surgeon's case.
  if (!isCase && actual) {
    const owner = surgeonForColourName(actual)
    if (!owner) return null

    const benign = STAFFING_PATTERN.test(title || '')
    const ownerHasNoCase = !surgeonsWithCases.includes(owner)
    if (benign) {
      return {
        kind: 'staffingConvention',
        severity: 'info',
        eventId: id,
        title,
        date,
        surgeon: owner,
        expected: null,
        actual,
        message: `COLOUR-CODING: coded ${actual} (officially ${owner}'s colour) — likely an established `
          + `staffing/on-call convention rather than a mistake`
          + (ownerHasNoCase ? `, flagged since ${owner} has no case this window to confirm against` : '')
      }
    }
    return {
      kind: 'surgeonColourOnNonCase',
      severity: 'warn',
      eventId: id,
      title,
      date,
      surgeon: owner,
      expected: null,
      actual,
      message: `COLOUR-CODING: non-surgical entry coloured ${actual} (${owner}'s colour) — probably an accidental pick`
    }
  }

  return null
}

// The §6.7 roll-up: what's wrong, what it should be, and confirmation that the
// rest are right.
export function summariseColourFindings(findings, cases) {
  const errors = findings.filter(f => f.severity === 'error')
  const notes = findings.filter(f => f.severity !== 'error')
  const flaggedIds = new Set(errors.map(f => f.eventId))
  const correct = cases.filter(c => !flaggedIds.has(c.id) && c.calendarColorName)

  const parts = []
  if (errors.length === 0) {
    parts.push(cases.length
      ? 'All cases correctly coded.'
      : 'No surgical cases to check this week.')
  } else {
    parts.push(`${errors.length === 1 ? 'One booking' : `${errors.length} bookings`} `
      + `${errors.length === 1 ? 'is' : 'are'} coded incorrectly — `
      + errors.map(f => {
        const day = f.date ? ` (${f.date})` : ''
        return f.expected
          ? `${f.title}${day}, should be ${f.expected}`
          : `${f.title}${day}`
      }).join('; ') + '.')
  }

  if (correct.length) {
    parts.push('Correctly coded: '
      + correct.map(c => `${c.patient}/${c.surgeon} ${c.calendarColorName}`).join(', ') + '.')
  }
  for (const note of notes) parts.push(note.message.replace(/^COLOUR-CODING:\s*/, '') + '.')

  return parts.join(' ')
}
