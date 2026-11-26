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

// The sharper 2400-pixel copy goes to Dropbox and the distributor, while the
// request stays under Vercel's 4.5MB limit.
describe('filingPages', async () => {
  const { filingPages } = await import('../UsageScan.jsx')
  const page = (data, full) => ({ mediaType: 'image/jpeg', data, full })
  it('sends the sharper copy where there is one', () => {
    expect(filingPages([page('small', 'sharp')])).toEqual([{ mediaType: 'image/jpeg', data: 'sharp' }])
  })
  it('falls back to the reading copy once the request would grow too large', () => {
    const big = 'x'.repeat(1_500_000)
    const out = filingPages([page('a', big), page('b', big), page('c', big)])
    expect(out.map(p => p.data.length)).toEqual([1_500_000, 1_500_000, 1])
  })
  it('uses the reading copy for a page that has no sharper one', () => {
    expect(filingPages([page('only', null)])[0].data).toBe('only')
  })
})

// Brent, 26 Nov 2026: a long scan's reading copies on top of the sharper ones
// went past Vercel's 4.5MB and an iPhone said "The string did not match the
// expected pattern." The whole request is now kept under the budget.
describe('the whole request stays under the budget', async () => {
  const { filingPages, fitPages, readJson, BODY_BUDGET } = await import('../UsageScan.jsx')
  const page = (data, full) => ({ mediaType: 'image/jpeg', data, full })
  const total = ps => ps.reduce((s, p) => s + p.data.length, 0)
  it('counts the reading copies of later pages too', () => {
    const pages = Array.from({ length: 7 }, () => page('r'.repeat(400_000), 's'.repeat(1_100_000)))
    expect(total(filingPages(pages))).toBeLessThanOrEqual(BODY_BUDGET)
  })
  it('makes the pages smaller when even the reading copies are too much', async () => {
    const pages = Array.from({ length: 12 }, () => page('r'.repeat(400_000), null))
    const out = await fitPages(pages, async d => d.slice(0, d.length / 2))
    expect(total(out)).toBeLessThanOrEqual(BODY_BUDGET)
  })
  it('turns a plain-text refusal into a sentence', async () => {
    const res = new Response('Request Entity Too Large', { status: 413 })
    expect((await readJson(res)).error).toMatch(/too large/)
  })
})
