// The Events page's photos: only the hand-picked ones are ever opened, and
// the page is never told where they live.
import { describe, it, expect } from 'vitest'
import { gallery, photoById, PHOTOS, ALBUMS } from './_eventPhotos.js'

describe('event photos', () => {
  it('tells the page ids, captions and albums — never Dropbox paths', () => {
    const g = gallery()
    expect(g.photos.length).toBe(PHOTOS.length)
    expect(JSON.stringify(g)).not.toMatch(/Education, Presentation|\.jpg|\.JPG/)
    for (const p of g.photos) expect(ALBUMS.some(a => a.id === p.album)).toBe(true)
  })
  it('opens only listed photos', () => {
    expect(photoById('party-0156')?.path).toMatch(/10 Year Anniversary Party/)
    expect(photoById('../../Admin/anything')).toBeNull()
    expect(photoById('')).toBeNull()
  })
  it('never reaches into the usage tree', () => {
    for (const p of PHOTOS) expect(p.path.toLowerCase().startsWith('/all surgeon usage')).toBe(false)
  })
  it('has photos for the hero', () => {
    expect(gallery().photos.filter(p => p.hero).length).toBeGreaterThanOrEqual(3)
  })
})
