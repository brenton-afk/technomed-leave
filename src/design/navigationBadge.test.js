import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SURGEON_ACCENTS, NAVIGATION_ACCENT, contrastRatio, inkOn, readableOn
} from '../clinicalPlan/theme.js'

// ─── The AIRO badge, on a card that is now a solid colour ────────────────────
// "Change the colour of the AIRO badge. Since we changed the background colours
// of the bookings to being more solid, the purple AIRO badge is not really
// clear and the black AIRO text gets lost."
//
// Both halves of that are measurable, which is why this is arithmetic rather
// than a source scan. The cards went solid; the badge did not follow; and the
// numbers say exactly how far it fell behind.

/** The floor for text somebody has to read. WCAG AA, small text. */
const READABLE = 4.5

/** The floor for one block of colour being seen as separate from another. */
const SEPARATE = 3

const fills = Object.entries(SURGEON_ACCENTS)

describe('the badge text', () => {
  it('can be read on the purple', () => {
    // It used to be the card's own ink — near-black on most cards — against
    // #4a1c96, which is 1.57. That is the "black AIRO text gets lost".
    const on = readableOn(NAVIGATION_ACCENT)
    expect(contrastRatio(on, NAVIGATION_ACCENT)).toBeGreaterThanOrEqual(READABLE)
  })

  it('was unreadable the old way, on nearly every card', () => {
    // Kept as the record of what was wrong. If this ever stops being true the
    // accents have changed enough that the whole badge wants rethinking.
    const lost = fills.filter(([, fill]) =>
      contrastRatio(inkOn(fill).ink, NAVIGATION_ACCENT) < READABLE)
    expect(lost.length).toBeGreaterThan(fills.length / 2)
  })
})

describe('the badge itself', () => {
  it('separates from every card colour there is', () => {
    // The ring is the card's own ink, which inkOn chose precisely because it
    // contrasts with that fill — so this holds for any accent added later,
    // not only the nine that exist today.
    for (const [surgeon, fill] of fills) {
      expect(contrastRatio(inkOn(fill).ink, fill), surgeon)
        .toBeGreaterThanOrEqual(READABLE)
    }
  })

  it('could not have been fixed by picking another fixed colour', () => {
    // The reason the ring adapts instead. A dark purple pill disappears on
    // Fowler's purple card and Garg's blue; a white one disappears on
    // Ibbett's banana. There is no single colour that reads on all nine.
    const purpleFails = fills.filter(([, fill]) =>
      contrastRatio(NAVIGATION_ACCENT, fill) < SEPARATE)
    const whiteFails = fills.filter(([, fill]) =>
      contrastRatio('#ffffff', fill) < SEPARATE)
    expect(purpleFails.length).toBeGreaterThan(0)
    expect(whiteFails.length).toBeGreaterThan(0)
  })

  it('keeps the purple, which is what navigation is here and in the calendar', () => {
    expect(NAVIGATION_ACCENT).toBe('#4a1c96')
  })
})

describe('both cards wear it', () => {
  // "You need a rule built in that the changes you make in one version MUST
  // correspond to both versions." The badge lived on the phone card only, so a
  // colour fixed there would not have shown up on the desktop to be judged.
  const source = readFileSync(
    join(__dirname, '..', 'pages', 'CaseWeek.jsx'), 'utf8')
  const phone = source.slice(
    source.indexOf('function CaseCard'), source.indexOf('function WeekCase'))
  const week = source.slice(source.indexOf('function WeekCase'))

  it('on the phone', () => expect(phone).toMatch(/<NavigationBadge\b/))
  it('on the desktop', () => expect(week).toMatch(/<NavigationBadge\b/))

  it('as one component, so the two cannot drift apart', () => {
    // The previous badge was styled inline. Two copies of a style is how the
    // rep, the system line and the solid fill all ended up on one card only.
    const component = source.slice(source.indexOf('function NavigationBadge'))
    expect(component).toMatch(/background: filled \? NAVIGATION_ACCENT/)
    expect(component).toMatch(/color: filled \? readableOn\(NAVIGATION_ACCENT\)/)
    expect(component).toMatch(/border: `1px solid \$\{ink\.ink\}`/)
    // The old styling, which is what was wrong.
    expect(phone).not.toMatch(/background: spare \? 'transparent' : NAVIGATION_ACCENT/)
  })
})
