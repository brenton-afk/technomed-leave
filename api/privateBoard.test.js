import { describe, it, expect } from 'vitest'
import { visibleTo, canSeePrivate, mayTouch } from './_privateBoard.js'

// Brent, 11 Nov 2026: "a private board for Erin and Brent that cannot be
// viewed by other staff". Invented tasks only.
const projects = [{ id: 'p1', name: 'Shared' }, { id: 'p2', name: 'Directors', private: true }]
const items = [{ id: 'a', projectId: 'p1' }, { id: 'b', projectId: 'p2' }, { id: 'c' }]

describe('the private board', () => {
  it('is seen by Brent and Erin only', () => {
    expect(canSeePrivate('brenton@technomed.com.au')).toBe(true)
    expect(canSeePrivate('ERIN@technomed.com.au')).toBe(true)
    expect(canSeePrivate('mat@technomed.com.au')).toBe(false)
    expect(canSeePrivate('')).toBe(false)
  })
  it('leaves the private project and its tasks out for everyone else', () => {
    const mat = visibleTo('mat@technomed.com.au', { projects, items })
    expect(mat.projects.map(p => p.id)).toEqual(['p1'])
    expect(mat.items.map(t => t.id)).toEqual(['a', 'c'])
    const erin = visibleTo('erin@technomed.com.au', { projects, items })
    expect(erin.items).toHaveLength(3)
    expect(mayTouch('mat@technomed.com.au', { projectId: 'p2', projects })).toBe(false)
    expect(mayTouch('mat@technomed.com.au', { projectId: 'p1', projects })).toBe(true)
  })
})
