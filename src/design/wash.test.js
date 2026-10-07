import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { withAlpha, washFor } from '../clinicalPlan/theme.js'
import { SURGEON_ACCENTS } from '../clinicalPlan/theme.js'

// ─── The surgeon's colour, over the whole card ───────────────────────────────
// A booking carried a 5px strip of its surgeon's colour, then a pale wash, and
// now the solid colour with the writing on top — the way a Google Calendar
// entry is drawn, and the only version in which Sage and Basil are far enough
// apart to tell a Thani case from a Gupta one.
//
// Guarded structurally as well as behaviourally, because jsdom has no layout:
// a test can assert a background is set and still not notice the card went
// back to white. The source scan is what catches somebody reinstating
// colour.surface during an unrelated tidy-up.

const caseWeek = readFileSync(join(__dirname, '..', 'pages', 'CaseWeek.jsx'), 'utf8')

/**
 * One component's source, from its declaration to the next one.
 *
 * Measured rather than guessed at a fixed length: CaseCard is several
 * thousand characters and a slice that stopped short of its end would quietly
 * stop checking most of it, which is the sort of test that passes forever.
 */
const bodyOf = name => {
  const from = caseWeek.indexOf(`function ${name}(`)
  expect(from, `${name} should exist`).toBeGreaterThan(-1)
  const next = caseWeek.indexOf('\nfunction ', from + 1)
  return caseWeek.slice(from, next > from ? next : undefined)
}

describe('withAlpha', () => {
  it('keeps the hue and tone, changing only the strength', () => {
    expect(withAlpha('#FBBC04', 0.1)).toBe('rgba(251, 188, 4, 0.1)')
    expect(withAlpha('#0D9488', 0.35)).toBe('rgba(13, 148, 136, 0.35)')
  })

  it('accepts a hex with or without its hash, in either case', () => {
    expect(withAlpha('2563eb', 0.5)).toBe(withAlpha('#2563EB', 0.5))
  })

  it('falls back to transparent rather than inventing a colour', () => {
    // A case with no confirmed accent should look like one, not like a guess.
    for (const bad of [undefined, null, '', 'teal', '#FFF', '#12345', {}]) {
      expect(withAlpha(bad, 0.1)).toBe('transparent')
    }
  })

  it('reaches every surgeon in the palette', () => {
    for (const [surgeon, hex] of Object.entries(SURGEON_ACCENTS)) {
      expect(withAlpha(hex, 0.1), surgeon).toMatch(/^rgba\(\d+, \d+, \d+, 0\.1\)$/)
    }
  })

  it('washes a case in its own surgeon, not a shared default', () => {
    const ibbett = washFor({ surgeon: 'Ibbett' })
    const garg = washFor({ surgeon: 'Garg' })
    expect(ibbett).not.toBe(garg)
    // A hex now, not rgba. Fading toward white with alpha faded the
    // saturation with it and collapsed two greens into one — see
    // paletteDistance.test.js.
    expect(ibbett).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('stays pale enough to read dark text over', () => {
    // Not decoration. These cards carry a surname, an operation and a kit
    // list, and a tint heavy enough to look pretty is heavy enough to hurt.
    //
    // Measured as contrast rather than as an alpha. The alpha was a proxy for
    // this and a poor one — it also controlled how distinguishable two
    // surgeons were, so the number could not be raised to separate Sage from
    // Basil without this test deciding the text had become unreadable.
    const luminance = hex => {
      const n = parseInt(hex.slice(1), 16)
      // eslint-disable-next-line no-bitwise
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map(v => v / 255)
        .map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (a, b) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    for (const surgeon of ['Atallah', 'Thani', 'Gupta', 'Garg', 'JPW', 'Fowler']) {
      const bg = washFor({ surgeon })
      // Body ink, and the muted grey the operation line is set in. 4.5:1 is
      // the WCAG AA floor for body text; the muted one is the tighter test.
      expect(contrast('#111827', bg), `${surgeon} body text`).toBeGreaterThan(7)
      expect(contrast('#4B5563', bg), `${surgeon} caption text`).toBeGreaterThan(4.5)
    }
  })
})

describe('the phone card and the week card are one thing at two sizes', () => {
  // "You need a rule built in that the changes you make in one version MUST
  // correspond to both versions. I don't want to have to redo every change
  // for both versions."
  //
  // This is that rule, and it has been earned three times: the rep went onto
  // the week and not the phone, the system went onto the week and not the
  // phone, and the solid fill went onto the week and left the phone with the
  // bug the week had just lost — Thani and Gupta still indistinguishable.
  //
  // The two views differ in how much fits on a card. They do not differ in
  // what anything means, and every one of those misses was a meaning that
  // only reached one of them. Where a treatment is about meaning, both carry
  // it, and this fails when only one does.
  const phone = bodyOf('CaseCard')
  const week = bodyOf('WeekCase')

  const both = (what, pattern) => {
    it(what, () => {
      expect(phone, `CaseCard — ${what}`).toMatch(pattern)
      expect(week, `WeekCase — ${what}`).toMatch(pattern)
    })
  }

  both('fills the card with the surgeon own colour, solid',
    /const fill = off \? colour\.surface : accentForCase\(surgicalCase\)/)

  both('writes in whichever ink can be read on that colour', /inkOn\(fill\)/)

  both('draws a cancelled case in grey rather than in colour',
    /off\s*\n?\s*\?\s*\{ ink: colour\.inkFaint/)

  both('needs no border once the card is the colour',
    /off \? colour\.line : 'transparent'/)

  both('names every system with where its kit is coming from',
    /suppliesFor\(surgicalCase\)/)

  // Word boundaries on all of these. Without them a renamed field still
  // matches its own prefix — surgicalCase.repHidden satisfies /\.rep/ — and
  // the rule passes while the card has quietly stopped showing anything.

  both('says who is on the case', /surgicalCase\.rep\b/)

  both('lifts the rep onto a panel so the name is readable on any colour',
    /background: ink\.line, color: ink\.ink, fontWeight: 700/)

  both('offers the list order', /onSetPlace\b/)

  both('offers the preference card', /onPreferences\b/)

  it('leaves neither card reading its text colour from the page palette', () => {
    // A token meant for a white page — inkMuted on a solid green — is the
    // shape every one of these regressions took: right on one card and
    // invisible on the other.
    for (const [name, body] of [['CaseCard', phone], ['WeekCase', week]]) {
      const strays = [...body.matchAll(
        /color: colour\.(ink|inkMuted|inkFaint|inkFainter|accentDeep|warning|danger)\b/g)]
        .map(m => `colour.${m[1]}`)
      expect(strays, `${name} should take its text colour from inkOn`).toEqual([])
    }
  })
})

describe('the cards actually use it', () => {
  it('fills both cards with the accent rather than a pale version of it', () => {
    // Paling moves every hue towards the same near-white, so two colours 20
    // apart at full strength end up about 6 apart on the card. That is the
    // whole reason Sage and Basil looked alike.
    for (const name of ['CaseCard', 'WeekCase']) {
      expect(bodyOf(name), name).toMatch(/background: fill/)
      expect(bodyOf(name), name).not.toMatch(/background: wash\b/)
    }
  })

  it('washes the also-on rows in their own calendar colour', () => {
    // Those are not cases and keep the lighter treatment: a day with six of
    // them should not read as six more bookings.
    expect(bodyOf('ItemRow')).toMatch(/background: hex \? withAlpha\(hex,/)
  })

  it('leaves a cancelled case uncoloured on both', () => {
    for (const name of ['CaseCard', 'WeekCase']) {
      expect(bodyOf(name), name).toMatch(/off \? colour\.surface/)
    }
  })
})
