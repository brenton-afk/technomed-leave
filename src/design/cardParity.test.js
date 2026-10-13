import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── The two cards say the same things, in the same order ────────────────────
// "These changes look great on the phone version (with the reordering of
// information for each booking) but you haven't updated on desktop. We've got
// to keep it consistent across both versions."
//
// The parity rule has been in place since September — "the changes you make in
// one version MUST correspond to both versions" — and it did not catch this,
// because every test written for it asked whether both cards *carried* a thing.
// Both did. They carried them in a different order, and nothing was looking.
//
// So this checks the sequence. It is the cheapest version of the rule that
// could have caught the actual failure, which is the only kind worth having.
//
// ── What is allowed to differ ──
//
// Not everything. A week column is about 200px and the phone card is built for
// 360, so the column drops the free notes and shortens the supply words. Those
// are space decisions. What may not differ is the order of what both do show:
// a reader moving between the two should find the same facts in the same
// places, and that is the whole of what Brent asked for.

const SOURCE = readFileSync(
  join(__dirname, '..', 'pages', 'CaseWeek.jsx'), 'utf8')

/**
 * One function's body, bounded.
 *
 * Not "from here to the next card": helpers live between the two, and a slice
 * that runs to the next function picks them up — which is how the first
 * version of this test decided CaseCard used shortSupply. A guard that reads
 * somebody else's code is a guard that passes for the wrong reason, which has
 * happened twice now.
 */
const bodyOf = name => {
  const from = SOURCE.indexOf(`function ${name}`)
  const next = SOURCE.indexOf('\nfunction ', from + 1)
  return SOURCE.slice(from, next === -1 ? SOURCE.length : next)
}

const phone = bodyOf('CaseCard')
const week = bodyOf('WeekCase')

/**
 * The facts a card shows, in the order it shows them.
 *
 * Matched on the expression that renders each one rather than on wording, so
 * restyling a line does not break this and moving one does.
 */
// Each pattern has to match where the fact is *drawn*, not where it is worked
// out. The three parsed values are hoisted to the top of each card now — once
// per card rather than twice — and a pattern that matched `useMemo(() =>
// patientLabel(...))` would find all three of them up there, in declaration
// order, and report an order this screen does not have.
const MARKERS = [
  ['the patient', /\{label\}/],
  ['the operation', /\{surgicalCase\.operation &&/],
  ['the kit and where it comes from', /\{(?:!off && )?supplies[ ?]/],
  ['the implant question', /\{(?:!off && )?question && \(/],
  ['where it is on the list', /place\??\.?\.?headline/],
  ['who attended', /\{surgicalCase\.rep &&|surgicalCase\.rep && !off/]
]

const sequenceIn = source => MARKERS
  .map(([name, pattern]) => ({ name, at: source.search(pattern) }))
  .filter(m => m.at >= 0)
  .sort((a, b) => a.at - b.at)
  .map(m => m.name)

describe('both cards carry the same facts', () => {
  for (const [name, pattern] of MARKERS) {
    it(`shows ${name}, on the phone and on the desktop`, () => {
      expect(phone, `CaseCard — ${name}`).toMatch(pattern)
      expect(week, `WeekCase — ${name}`).toMatch(pattern)
    })
  }
})

describe('and in the same order', () => {
  it('runs patient, operation, kit, question, list place, rep', () => {
    // The order Brent asked for: "patient/surgeon, then the operation
    // description, then the system and loan/consignment, then the information
    // about where it is on the list, then entered by Brent and the rep who
    // attended at the bottom".
    expect(sequenceIn(phone)).toEqual([
      'the patient',
      'the operation',
      'the kit and where it comes from',
      'the implant question',
      'where it is on the list',
      'who attended'
    ])
  })

  it('reads the same on the desktop as on the phone', () => {
    // The rule, restated for two views that are now allowed to differ in how
    // much they show: everything the phone shows, the desktop shows, in the
    // same order. A fact may be left off the smaller screen on purpose; it
    // may not turn up in a different place.
    const onPhone = sequenceIn(phone)
    expect(sequenceIn(week).filter(name => onPhone.includes(name))).toEqual(onPhone)
  })
})

describe('what the phone leaves out, on purpose', () => {
  // "It might be better to have slightly less information on view when you
  // look at it in the portal view (a bit like the Google Calendar view) but
  // still be able to go into each booking and get the extra info... The
  // desktop view can stay consistent because you have a bigger screen."
  //
  // Named here rather than left to drift. Everything on this list is a
  // deliberate omission from the tile and has to be reachable from inside the
  // booking; anything that disappears from the phone without being added here
  // fails the test above.
  const LEFT_OFF = [
    ['the navigation platform', /<NavigationNote\b/],
    ['the preference card', /onPreferences\b/]
  ]

  for (const [name, pattern] of LEFT_OFF) {
    it(`leaves ${name} to the booking and the desktop`, () => {
      expect(phone, `CaseCard still shows ${name}`).not.toMatch(pattern)
      expect(week, `WeekCase should keep ${name}`).toMatch(pattern)
    })
  }

  it('leaves the free notes to the booking on both views', () => {
    // These were never on the column — 200px could not hold "Re do
    // transphenoidal Rathkes/pituitary abscess with drain" — and they are off
    // the tile now too. The booking is where they are read.
    expect(phone).not.toMatch(/surgicalCase\.notes/)
    expect(week).not.toMatch(/surgicalCase\.notes/)
  })

  it('keeps the things that change what somebody does next', () => {
    // Chosen deliberately: cancelled or not-needed, because it decides
    // whether anybody goes; the implant question, because nobody chases a kit
    // they cannot see is missing; and who attended.
    expect(phone).toMatch(/surgicalCase\.cancelled/)
    expect(phone).toMatch(/surgicalCase\.notRequired/)
    expect(phone).toMatch(/implantQuestion\(surgicalCase\)/)
    expect(phone).toMatch(/surgicalCase\.rep\b/)
  })

  it('keeps the list order on the tile, which is a thing you change', () => {
    expect(phone).toMatch(/onSetPlace\b/)
  })
})

describe('what the column is allowed to do differently', () => {
  it('shortens the supply words, because 200px is 200px', () => {
    expect(week).toMatch(/shortSupply\(entry\.supply\)/)
    expect(phone).not.toMatch(/shortSupply/)
  })

  it('shortens nothing on the phone, which has the width for the words', () => {
    // The column abbreviates the supply because 200px is 200px; the tile does
    // not, having the full width of the glass.
    expect(phone).not.toMatch(/shortSupply/)
  })
})

// ─── Worked out once, not twice ──────────────────────────────────────────────
// "It's really laggy at the moment."
//
// Each of these reads the booking with a pattern — the kit line is parsed, the
// operation is scanned for ACDF and its cousins, the surgeon's preferences are
// looked up — and each was written twice in the body of a card: once in the
// guard that decides whether to draw the line, once in the line itself. Across
// a week of cases that is several hundred parses on every render, for an
// answer that cannot change unless the booking does.
describe('the parsing each card does', () => {
  const PARSERS = ['patientLabel', 'suppliesFor', 'implantQuestion']

  const timesIn = (body, name) =>
    body.split(`${name}(surgicalCase)`).length - 1

  for (const [card, body] of [['CaseCard', phone], ['WeekCase', week]]) {
    for (const name of PARSERS) {
      it(`${card} runs ${name} once`, () => {
        expect(timesIn(body, name), `${card} calls ${name}`).toBe(1)
      })
    }

    it(`${card} holds onto the answers`, () => {
      // Once per card is only once per *render* without this.
      for (const name of PARSERS) {
        expect(body, `${card} — ${name}`)
          .toMatch(new RegExp(`useMemo\\(\\(\\) => ${name}\\(surgicalCase\\)`))
      }
    })

    it(`${card} is not redrawn for a booking that has not changed`, () => {
      // All of its callbacks are useCallback or setState, so this holds.
      //
      // Read from SOURCE rather than body: bodyOf slices from `function
      // CaseCard`, and the wrapper sits immediately before that.
      expect(SOURCE).toMatch(new RegExp(`React\\.memo\\(function ${card}\\(`))
    })
  }
})
