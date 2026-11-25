import { describe, it, expect } from 'vitest'
import { labelFrames, snapTargets, snapBox, alignBoxes, distributeBoxes, createHistory } from './snap.js'

const label = { w: 70.7, h: 23 }

describe('snapping', () => {
  it('knows the trim, safe area and bleed', () => {
    const f = labelFrames(label)
    expect(f.trim).toEqual({ left: 1.35, top: 1, width: 68, height: 21 })
    expect(f.safe.left).toBeCloseTo(2.85)
    expect(f.bleed).toEqual({ left: 0, top: 0, width: 70.7, height: 23 })
  })
  it('snaps a box\'s centre to the label\'s centre', () => {
    const t = snapTargets(label)
    const box = { left: 30, top: 5, width: 10, height: 4 } // centre x 35, label centre 35.35
    const s = snapBox(box, t, 0.5)
    expect(s.dx).toBeCloseTo(0.35)
    expect(s.guides.x).toBeCloseTo(35.35)
  })
  it('snaps to another item\'s edge and leaves far boxes alone', () => {
    const t = snapTargets(label, [{ left: 20, top: 15, width: 5, height: 2 }])
    expect(snapBox({ left: 19.8, top: 8.3, width: 4, height: 1 }, t, 0.3).dx).toBeCloseTo(0.2)
    expect(snapBox({ left: 40.4, top: 7.3, width: 4, height: 1 }, t, 0.1)).toMatchObject({ dx: 0, dy: 0, guides: { x: null, y: null } })
  })
})

describe('align and distribute', () => {
  const frame = { left: 1.35, top: 1, width: 68, height: 21 }
  it('aligns one item to the label', () => {
    expect(alignBoxes([{ left: 10, top: 5, width: 10, height: 2 }], 'hcenter', frame)[0].dx).toBeCloseTo(35.35 - 15)
    expect(alignBoxes([{ left: 10, top: 5, width: 10, height: 2 }], 'right', frame)[0].dx).toBeCloseTo(69.35 - 20)
  })
  it('aligns several to each other', () => {
    const m = alignBoxes([{ left: 10, top: 5, width: 4, height: 2 }, { left: 20, top: 9, width: 4, height: 2 }], 'top')
    expect(m.map(x => x.dy)).toEqual([0, -4])
  })
  it('spaces three or more evenly, ends fixed', () => {
    const m = distributeBoxes([{ left: 0, top: 0, width: 2, height: 1 }, { left: 20, top: 0, width: 2, height: 1 }, { left: 4, top: 0, width: 2, height: 1 }], 'x')
    expect(m.map(x => x.dx)).toEqual([0, 0, 6])
    expect(distributeBoxes([{ left: 0, top: 0, width: 1, height: 1 }], 'x')).toEqual([{ dx: 0, dy: 0 }])
  })
})

describe('undo and redo', () => {
  it('steps back and forward, and a new change clears redo', () => {
    const h = createHistory()
    h.reset('a'); h.push('b'); h.push('c')
    expect(h.push('c')).toBe(false)
    expect(h.undo()).toBe('b')
    expect(h.undo()).toBe('a')
    expect(h.undo()).toBeNull()
    expect(h.redo()).toBe('b')
    h.push('d')
    expect(h.canRedo).toBe(false)
    expect(h.current).toBe('d')
  })
})
