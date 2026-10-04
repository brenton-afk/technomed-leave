import { describe, it, expect } from 'vitest'
import { accentForCase, washFor } from './theme.js'
import { hasConfirmedAccent } from './theme.js'
import { SURGEON_COLOUR_NAMES } from './colours.js'

// ─── Can you tell two surgeons apart on a screen? ───────────────────────────
// "The green for thani (sage) and the green for gupta (basil) both look the
// same on the desktop version."
//
// They did, and measuring it said why. Sage and Basil are adjacent greens in
// Google's own palette — 20 apart at full strength, where 40 or more is the
// comfortable range — and they share a hue, differing mainly in lightness. The
// first attempt at a fix flattened lightness to a constant, which threw away
// the only thing separating them and put them 2 apart.
//
// So the distance is measured here rather than judged by eye. CIE76 is a crude
// metric and good enough for the question being asked, which is not "are these
// the same colour" but "could somebody glancing at a week grid confuse them".

const hexToLab = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return null
  const n = parseInt(m[1], 16)
  // eslint-disable-next-line no-bitwise
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255)
  const [r, g, b] = srgb.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

const distance = (a, b) => {
  const [la, lb] = [hexToLab(a), hexToLab(b)]
  if (!la || !lb) return Infinity
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

// Compared by colour rather than by surgeon. Garg, Varidel, Silifent, Ong and
// Carter all render Lavender, deliberately, and Hannan has no confirmed accent
// and falls back to neutral — measuring those as pairs would measure the
// fallback rather than the palette and report a pile of zero distances.
const SURGEONS = Object.keys(SURGEON_COLOUR_NAMES).filter(hasConfirmedAccent)
const accent = name => accentForCase({ surgeon: name })
const wash = name => washFor({ surgeon: name })

/** One representative surgeon per distinct colour, named for the message. */
const DISTINCT = [...new Map(SURGEONS.map(name => [accent(name), name])).values()]
const pairs = DISTINCT.flatMap((a, i) => DISTINCT.slice(i + 1).map(b => [a, b]))

describe('the washes a week grid is read by', () => {
  it('separates every pair by more than the flattened version managed', () => {
    // 2.2 was Sage against Basil when lightness was flattened, and that is
    // indistinguishable. 5 is the floor the current palette can actually hold;
    // it is low, and the test below is where that is said out loud rather than
    // left as a number nobody questions.
    const tight = pairs
      .map(([a, b]) => ({ pair: `${a}/${b}`, d: distance(wash(a), wash(b)) }))
      .filter(x => x.d < 5)
    expect(tight).toEqual([])
  })

  it('keeps the darker of two similar colours darker', () => {
    // Basil is the darker green and has to stay the darker wash, or the only
    // thing separating it from Sage is gone.
    const lightness = name => hexToLab(wash(name))[0]
    expect(lightness('Gupta')).toBeLessThan(lightness('Thani'))
  })

  it('gives every distinct accent a distinct wash', () => {
    // The tint must not collapse two colours into one on its way to pale.
    const washes = DISTINCT.map(wash)
    expect(new Set(washes).size).toBe(DISTINCT.length)
  })
})

describe('what the palette itself can support', () => {
  it('records which surgeon pairs are too close at full strength', () => {
    // Not a failure — a standing note. These are the pairs no rendering can
    // rescue, because the colours they are assigned in Google Calendar are
    // genuinely similar. Fixing one means moving a surgeon to another calendar
    // colour, which is a change to a shared convention and so Brent's to make.
    const close = pairs
      .map(([a, b]) => ({ pair: `${a}/${b}`, d: Math.round(distance(accent(a), accent(b))) }))
      .filter(x => x.d < 25)
      .sort((x, y) => x.d - y.d)

    // Sage against Basil, at 20. If this list ever grows, a surgeon has been
    // given a calendar colour that collides with somebody else's, and no
    // amount of rendering will fix it.
    expect(close.map(c => c.pair)).toEqual(['Thani/Gupta'])
  })
})

describe('a neutral stays neutral', () => {
  // "Why is Dubey's case on Wednesday now red?"
  //
  // Because the tint held saturation up to a floor, and Graphite is #616161 —
  // every channel equal, so its hue reads as 0, and 0 at 80% saturation is
  // red. Dubey came out pink and Hannan's neutral grey came out blue. The
  // floor exists to stop pale colours washing out; applied to a grey it
  // invents a colour that was never there, and on a clinical week grid a red
  // card means something.
  const channels = hex => {
    const n = parseInt(String(hex).slice(1), 16)
    // eslint-disable-next-line no-bitwise
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const spread = hex => {
    const c = channels(hex)
    return Math.max(...c) - Math.min(...c)
  }

  it('leaves Graphite grey', () => {
    // Dubey. Equal channels in, equal channels out.
    expect(spread(wash('Dubey'))).toBeLessThan(10)
  })

  it('does not turn a surgeon with no confirmed colour into one', () => {
    // Hannan falls back to neutral deliberately — the absence of a colour is
    // information, and a blue card says the opposite.
    expect(spread(wash('Hannan'))).toBeLessThan(24)
  })

  it('still lifts a real colour', () => {
    // The floor has to keep doing its job, or this fix has traded one bug for
    // the washed-out palette it replaced.
    expect(spread(wash('Thani'))).toBeGreaterThan(40)
    expect(spread(wash('Gupta'))).toBeGreaterThan(40)
  })
})
