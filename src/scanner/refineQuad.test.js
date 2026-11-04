import { describe, it, expect } from 'vitest'
import { refineQuad } from './documentDetect.js'
import { scene } from './scenes.js'

// Aimee's stainless bench at RHH (4 Nov 2026): the traced outline is right on
// three sides and wrong on one — glare ate a corner, or a seam pulled one out.
// refineQuad moves each side onto the page edge near it. It reads only
// grey.data / cols / rows, so a plain object stands in for a cv.Mat here.

const W = 240, H = 180
const page = [{ x: 45, y: 24 }, { x: 195, y: 24 }, { x: 195, y: 156 }, { x: 45, y: 156 }]
const greyOf = o => ({ data: scene({ width: W, height: H, quad: page, paper: 234, bench: 180, noise: 3, ...o }), cols: W, rows: H })
const worst = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)))

describe('re-fitting a nearly right outline', () => {
  it('pulls a corner back out of glare', () => {
    const grey = greyOf({ metal: { base: 182, streak: 12, gradient: 30, glare: [{ x: 262, y: 70, r: 70 }] } })
    const rough = [{ x: 45, y: 24 }, { x: 195, y: 36 }, { x: 193, y: 156 }, { x: 45, y: 155 }]
    const once = refineQuad(grey, rough, 50)
    const twice = refineQuad(grey, once, 50) || once
    expect(worst(twice, page)).toBeLessThan(6)
  })

  it('moves a side off a printed rule and onto the paper’s edge', () => {
    const grey = greyOf({ metal: { base: 200, streak: 10, gradient: 20 } })
    const rough = [{ x: 45, y: 24 }, { x: 195, y: 24 }, { x: 195, y: 134 }, { x: 45, y: 134 }]
    const fixed = refineQuad(grey, rough, 50)
    expect(worst(fixed, page)).toBeLessThan(7)
  })

  it('leaves an already right outline where it is', () => {
    const grey = greyOf({ metal: { base: 172, streak: 14, gradient: 40 } })
    expect(worst(refineQuad(grey, page, 50), page)).toBeLessThan(3)
  })

  it('gives up rather than inventing edges on a blank bench', () => {
    const blank = { data: new Uint8Array(W * H).fill(190), cols: W, rows: H }
    expect(refineQuad(blank, page, 50)).toBeNull()
  })
})
