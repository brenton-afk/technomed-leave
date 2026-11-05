import { describe, it, expect } from 'vitest'
import { cornersOnStill } from './stillMapping.js'

describe('an outline from the video, on a photograph of another shape', () => {
  const page = [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }, { x: 0.9, y: 0.8 }, { x: 0.1, y: 0.8 }]

  it('maps a narrow 886x1920 portrait stream into a 3060x4080 portrait photo', () => {
    // The video is the photo's full height and a central band of its width.
    const out = cornersOnStill(page, 886, 1920, 3060, 4080)
    const band = (886 / 1920) / (3060 / 4080)
    expect(out[0].y).toBeCloseTo(0.2)
    expect(out[0].x).toBeCloseTo((1 - band) / 2 + 0.1 * band)
    expect(out[1].x).toBeCloseTo((1 - band) / 2 + 0.9 * band)
  })

  it('leaves an outline alone when the shapes match', () => {
    const out = cornersOnStill(page, 1440, 1920, 3060, 4080)
    out.forEach((c, i) => { expect(c.x).toBeCloseTo(page[i].x); expect(c.y).toBeCloseTo(page[i].y) })
  })

  it('refuses a photo the other way up', () => {
    expect(cornersOnStill(page, 1080, 1920, 4080, 3060)).toBeNull()
  })
})
