import { describe, it, expect } from 'vitest'
import { reorder } from './pageList.js'

// Page order decides how the form reads and how the merged PDF comes out, so
// the arithmetic of moving one is worth being exact about. The component this
// came out of cannot be rendered in a test — turning a photograph into a page
// needs createImageBitmap and a canvas, and jsdom has neither.

const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const ids = list => list.map(p => p.id)

describe('reorder', () => {
  it('moves a page later', () => {
    expect(ids(reorder(pages, 'a', 1))).toEqual(['b', 'a', 'c'])
  })

  it('moves a page earlier', () => {
    expect(ids(reorder(pages, 'c', -1))).toEqual(['a', 'c', 'b'])
  })

  it('moves across the whole list', () => {
    expect(ids(reorder(pages, 'a', 2))).toEqual(['b', 'c', 'a'])
  })

  it('never drops or duplicates a page', () => {
    // The failure that would matter: a page quietly disappearing between the
    // scan and the distributor's sheet.
    for (const id of ['a', 'b', 'c']) {
      for (const by of [-2, -1, 1, 2]) {
        const out = reorder(pages, id, by)
        expect(out).toHaveLength(3)
        expect([...ids(out)].sort()).toEqual(['a', 'b', 'c'])
      }
    }
  })

  it('leaves the list alone at the ends', () => {
    expect(reorder(pages, 'a', -1)).toBe(pages)
    expect(reorder(pages, 'c', 1)).toBe(pages)
  })

  it('leaves the list alone for a page that is not there', () => {
    expect(reorder(pages, 'nope', 1)).toBe(pages)
  })

  it('does not mutate what it was given', () => {
    // setPages would not re-render on a list mutated in place, so the move
    // would happen and the screen would not show it.
    const before = ids(pages)
    reorder(pages, 'a', 1)
    expect(ids(pages)).toEqual(before)
  })

  it('survives nonsense', () => {
    expect(reorder(undefined, 'a', 1)).toEqual([])
    expect(reorder(pages, 'a', 0)).toBe(pages)
    expect(() => reorder([null, { id: 'a' }], 'a', -1)).not.toThrow()
  })
})
