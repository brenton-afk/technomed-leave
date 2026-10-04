import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { withAlpha, washFor } from '../clinicalPlan/theme.js'
import { SURGEON_ACCENTS } from '../clinicalPlan/theme.js'

// ─── The surgeon's colour, over the whole card ───────────────────────────────
// A booking used to carry a 5px strip of its surgeon's colour down one edge.
// In a 200px week column that is 2% of the card and reads as nothing, so the
// card itself takes the colour now, washed right out.
//
// Guarded structurally as well as behaviourally, because jsdom has no layout:
// a test can assert a background is set and still not notice the card went
// back to white. The source scan is what catches somebody reinstating
// colour.surface during an unrelated tidy-up.

const caseWeek = readFileSync(join(__dirname, '..', 'pages', 'CaseWeek.jsx'), 'utf8')

const bodyOf = name => {
  const from = caseWeek.indexOf(`function ${name}(`)
  expect(from, `${name} should exist`).toBeGreaterThan(-1)
  return caseWeek.slice(from, from + 2600)
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

describe('the cards actually use it', () => {
  it('washes the day card instead of standing it on a white surface', () => {
    const body = bodyOf('CaseCard')
    expect(body).toMatch(/background: wash\b/)
    expect(body).not.toMatch(/background: colour\.surface/)
  })

  it('washes the week column card too', () => {
    // The view the change was asked for. A strip at 3px wide is invisible.
    expect(bodyOf('WeekCase')).toMatch(/background: off \? 'transparent' : washFor\(/)
  })

  it('washes the also-on rows in their own calendar colour', () => {
    expect(bodyOf('ItemRow')).toMatch(/background: hex \? withAlpha\(hex,/)
  })

  it('leaves a cancelled case uncoloured', () => {
    // Struck through and grey already. Washing it in the surgeon's colour
    // would make a cancelled case look as live as the one under it.
    expect(bodyOf('CaseCard')).toMatch(/const wash = off \? 'transparent'/)
  })

  it('borders each card in a stronger pull of the same colour', () => {
    // Against a tinted fill a grey hairline reads as dirt. The edge has to
    // come from the same hue or the card loses its outline entirely.
    expect(bodyOf('CaseCard')).toMatch(/withAlpha\(bar, 0\.35\)/)
    expect(bodyOf('WeekCase')).toMatch(/withAlpha\(accentForCase\(surgicalCase\), 0\.35\)/)
  })
})
