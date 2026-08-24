import { describe, it, expect } from 'vitest'
import { chooseCandidate } from './documentDetect.js'

// "The frame just doesn't really adjust at all to the page on the table."
//
// The detector took the largest quadrilateral it could find, and the surface a
// page is lying on is always a larger quadrilateral than the page — a table shot
// from above, a cutting mat, a desk — and just as four-sided. In the reported
// photograph the outline sat on the table with its corners off the edges of the
// picture. Nothing downstream could help: the answer was confidently wrong rather
// than noisy, so there was nothing for smoothing or a jump gate to reject.
//
// Choosing between candidates is pure, so it is tested here directly rather than
// through OpenCV. That matters for the frame-edge rule in particular: the
// synthetic scenes in scenes.js cannot produce a detected quad clipped by the
// frame — a flat surface running off the picture leaves no closed contour — so the
// bench cannot reach it and this is the only cover it has.

/** A candidate as detectDocument builds them. `mean` is the middle, `ring` the band inside its border. */
const at = (x0, y0, x1, y1, { mean = 200, ring = mean } = {}) => ({
  corners: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  areaFraction: ((x1 - x0) * (y1 - y0)) / (240 * 180),
  mean,
  ring
})

const choose = candidates => chooseCandidate(candidates, 240, 180)

describe('choosing between quadrilaterals', () => {
  it('takes the largest when none contains another', () => {
    // Still the rule in the ordinary case: a bigger page is a better crop.
    const small = at(100, 70, 140, 110)
    const large = at(40, 30, 200, 150)
    expect(choose([small, large])).toBe(large)
  })

  it('finds nothing in nothing', () => {
    expect(choose([])).toBeNull()
  })
})

describe('a page lying on a surface', () => {
  // The reproduction. Measured from the bench's cutting-mat scene: the mat came
  // back at area 0.643 and the page at 0.394, so the mat won on size every time.
  const mat = at(29, 15, 215, 167, { mean: 205, ring: 168 })
  const page = at(48, 30, 191, 149, { mean: 208, ring: 230 })

  it('prefers the page over the surface it is resting on', () => {
    expect(choose([mat, page])).toBe(page)
  })

  it('does not care which order they were found in', () => {
    expect(choose([page, mat])).toBe(page)
  })

  it('judges the surface by its own border band, not its whole interior', () => {
    // This is why the first attempt failed. Most of the mat's interior *is* the
    // page, so measured over the whole thing it read 205 against the page's 208 —
    // three grey levels apart, and no test on those two numbers could separate
    // them. The band inside the mat's own border is the mat, and reads 168.
    const wholeInteriorIsSimilar = at(29, 15, 215, 167, { mean: 205, ring: 205 })
    expect(choose([wholeInteriorIsSimilar, page])).toBe(wholeInteriorIsSimilar)
    // ...and with the band measured properly, the page wins.
    expect(choose([mat, page])).toBe(page)
  })

  it('leaves a darker sheet on a lighter surface alone', () => {
    // A photocopied form on a white bench: the form is darker than the bench, so
    // it is not "a sheet lying on this" by tone and the enclosure rule stays out
    // of it. There is no competing candidate in that scene anyway — a uniform
    // bench with no visible edge produces no contour — so the page wins on size.
    const bench = at(10, 8, 230, 172, { mean: 226, ring: 226 })
    const darkForm = at(48, 30, 191, 149, { mean: 120, ring: 120 })
    expect(choose([bench, darkForm])).toBe(bench)
  })
})

describe('a form with a box printed inside it', () => {
  // The rule has to decline here, and the tone test is what makes it. An earlier
  // version of the detector snapped the outline to the heavy rule under a form's
  // header; preferring any enclosed candidate would bring that straight back.
  const page = at(40, 26, 200, 154, { mean: 210, ring: 232 })
  const printBox = at(56, 60, 184, 140, { mean: 208, ring: 214 })

  it('keeps the whole page, not the box on it', () => {
    // The band inside the page's border is paper, the same tone as the box. So
    // the box is not a sheet lying on the page, and the page is not a surface.
    expect(choose([page, printBox])).toBe(page)
  })
})

describe('a quadrilateral running off the picture', () => {
  // The photographed table: a huge tilted quad with corners past the frame edges.
  // Cropping to it would cut the form off, so it cannot be right whether or not
  // it is the page.
  const table = at(0, 0, 240, 180, { mean: 150, ring: 140 })
  const page = at(70, 40, 175, 145, { mean: 212, ring: 232 })

  it('loses to anything wholly inside the frame', () => {
    expect(choose([table, page])).toBe(page)
  })

  it('loses even when the enclosure rule cannot see it', () => {
    // Two independent reasons, deliberately. A table need not enclose the page —
    // the page can overhang its edge — and it need not be darker either, on a
    // white bench under a lamp.
    const clipped = at(0, 0, 240, 120, { mean: 215, ring: 215 })
    const inside = at(30, 130, 120, 175, { mean: 200, ring: 200 })
    expect(choose([clipped, inside])).toBe(inside)
  })

  it('is still offered when there is nothing else', () => {
    // Every tier falls back rather than rejecting. A page held so close that it
    // overfills the frame should get an outline and a "move back", not nothing —
    // losing the outline entirely reads as the scanner having broken.
    const only = at(0, 0, 240, 180, { mean: 215 })
    expect(choose([only])).toBe(only)
  })

  it('picks the largest among several that all run off the edge', () => {
    const smaller = at(0, 0, 120, 180, { mean: 210 })
    const bigger = at(0, 0, 200, 180, { mean: 210 })
    expect(choose([smaller, bigger])).toBe(bigger)
  })
})
