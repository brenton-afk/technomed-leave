// @vitest-environment node
// Fit to box (25 Nov 2026): imported text keeps to its Vistaprint box width.
import { describe, it, expect } from 'vitest'
import { fitFactors, naturalWidth, MIN_CONDENSE, MM_PER_PT, sanitiseLabel, blankLabel } from './model.js'
import { itemToSpec, objectToItem } from './fabricAdapter.js'
import { SEED_LABELS } from '../../api/_labelSeed.js'

describe('fitting imported text to its Vistaprint box', () => {
  it('leaves a line that fits, condenses one a little too long, and shrinks past 85%', () => {
    expect(fitFactors(50, 60)).toEqual({ sx: 1, sy: 1 })
    expect(fitFactors(64, 60).sx).toBeCloseTo(60 / 64, 6)
    expect(fitFactors(64, 60).sy).toBe(1)
    const f = fitFactors(80, 60)
    expect(f.sx).toBeCloseTo(0.75, 6)
    expect(f.sy).toBeCloseTo(0.75 / MIN_CONDENSE, 6)
    expect(fitFactors(0, 60)).toEqual({ sx: 1, sy: 1 })
  })

  it('measures the widest line, letter spacing included', () => {
    const item = { ls: 100, runs: [{ text: 'ab\nabcd', size: 8 }] }
    expect(naturalWidth(item, t => t.length)).toBeCloseTo(4 + 4 * 0.1 * 8 * MM_PER_PT, 6)
  })

  it('is on for every imported text box, kept by a save, off for new labels', () => {
    for (const l of SEED_LABELS) for (const i of l.items) if (i.t === 'txt') expect(i.fit, l.name).toBe(true)
    expect(sanitiseLabel({ items: [{ t: 'txt', fit: true, runs: [] }] }).items[0].fit).toBe(true)
    expect(sanitiseLabel({ items: [{ t: 'txt', runs: [] }] }).items[0].fit).toBeUndefined()
    expect(blankLabel().items.some(i => i.fit)).toBe(false)
  })

  it('reads a fitted box back at its own size — the squeeze is not a resize', () => {
    const item = { id: 'f', t: 'txt', x: 8, y: 17, w: 59.62, h: 3.38, rot: 0, ha: 'left', va: 'top', lh: 1.2, ls: 0, fit: true,
      runs: [{ text: 'Ref: 71-AL-85....   Rebate Code: EY034', font: 'Mulish', size: 8, color: '#000000', underline: false, bold: false, italic: false }] }
    const spec = itemToSpec(item)
    expect(spec.props.tmFit).toBe(true)
    const at = (scaleX, scaleY) => objectToItem({ ...spec.props, text: spec.text, height: 3.38, scaleX, scaleY, tmFitX: 0.9, tmFitY: 1 })
    expect(at(0.9, 1)).toMatchObject({ x: 8, w: 59.62, fit: true })
    expect(at(0.9, 1).runs[0].size).toBe(8)
    // A handle dragged on top of the fit is a real change of size.
    expect(at(1.8, 2).runs[0].size).toBe(16)
  })
})
