import { describe, it, expect } from 'vitest'
import { edgeSupport } from './documentDetect.js'

// ─── Does this outline sit on anything? ─────────────────────────────────────
// Reported with two photographs of a page on a wooden bench. In the first the
// quad floated above the paper; in the second it ran diagonally across the
// middle of it. Both were convex, both were the right sort of size, both had
// plausible side ratios — every geometric test the detector had, passed.
//
// They were not the shape of anything in the picture, and nothing was asking
// the picture.

/** A grey "Mat": a page of `paper` tone on a bench of `bench` tone. */
const sheet = ({ w = 200, h = 150, x0 = 40, y0 = 30, x1 = 160, y1 = 120,
  paper = 220, bench = 70, print = false } = {}) => {
  const data = new Uint8Array(w * h).fill(bench)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // Print, where asked for: dark bars across the page, which is what a
      // line through the interior actually crosses.
      data[y * w + x] = print && y % 9 < 3 ? 60 : paper
    }
  }
  return { data, cols: w, rows: h }
}

const quad = (x0, y0, x1, y1) =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]

describe('edgeSupport', () => {
  it('is high for the actual edge of the page', () => {
    expect(edgeSupport(sheet(), quad(40, 30, 160, 120))).toBeGreaterThan(0.9)
  })

  it('is low for a quad floating above the page', () => {
    // The first screenshot: the right shape, in the wrong place, entirely on
    // the bench.
    expect(edgeSupport(sheet(), quad(40, 5, 160, 25))).toBeLessThan(0.55)
  })

  it('is low for a quad cutting across the page interior', () => {
    // The second screenshot. Every side is inside the paper, crossing print,
    // which is a step that keeps changing sign.
    const grey = sheet({ print: true })
    expect(edgeSupport(grey, quad(60, 50, 140, 100))).toBeLessThan(0.55)
  })

  it('is high even when the page is darker than the bench', () => {
    // A dark form on a light bench is still a border; it is the step that
    // matters, not which side of it is brighter.
    expect(edgeSupport(sheet({ paper: 60, bench: 215 }), quad(40, 30, 160, 120)))
      .toBeGreaterThan(0.9)
  })

  it('ignores a side lying along the edge of the picture', () => {
    // There are no pixels beyond it to compare against, so it can only score
    // zero however real it is. Counting that sank every page photographed
    // with an edge out of frame — a 27px regression on the bench the day this
    // check was added.
    const grey = sheet({ y1: 150 })   // page runs off the bottom
    expect(edgeSupport(grey, quad(40, 30, 160, 149))).toBeGreaterThan(0.85)
  })

  it('lowers the bar in a flat, low-contrast frame', () => {
    // A white form on a white bench is a real but shallow step. A fixed
    // threshold rejected the page outright, which turned a wrong answer into
    // no answer — not an improvement for somebody holding a phone over a form.
    const faint = sheet({ paper: 205, bench: 190 })
    expect(edgeSupport(faint, quad(40, 30, 160, 120), 18)).toBeGreaterThan(0.9)
  })

  it('says nothing about a quad it cannot measure', () => {
    // All four sides on the frame edge: nothing was measured, so nothing is
    // alleged, and the detector is left exactly as it was before this existed.
    const grey = sheet()
    expect(edgeSupport(grey, quad(0, 0, 199, 149))).toBe(1)
  })

  it('survives a degenerate quad', () => {
    expect(() => edgeSupport(sheet(), quad(50, 50, 50, 50))).not.toThrow()
  })
})
