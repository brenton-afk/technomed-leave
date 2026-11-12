import { describe, it, expect } from 'vitest'
import { toEvict, dropboxAppLink } from './docCache.js'

// Brent, 12 Nov 2026: documents are kept on the phone after the first open,
// so a surgical technique opens at once the second time.
describe('documents kept on the phone', () => {
  it('drops the oldest past the count or the size, newest kept', () => {
    const list = [{ key: 'a', size: 5, at: 1 }, { key: 'b', size: 5, at: 3 }, { key: 'c', size: 5, at: 2 }]
    expect(toEvict(list, { maxDocs: 2, maxBytes: 100 }).map(e => e.key)).toEqual(['a'])
    expect(toEvict(list, { maxDocs: 10, maxBytes: 9 }).map(e => e.key).sort()).toEqual(['a', 'c'])
    expect(toEvict(list, { maxDocs: 10, maxBytes: 100 })).toEqual([])
  })
  it('opens a file in the Dropbox app by its team path', () => {
    expect(dropboxAppLink('/Distributors/E4 Surgical/Dakota ACDF/Dakota_Surgical Technique.pdf'))
      .toBe('https://www.dropbox.com/preview/TECHNOMED/Distributors/E4%20Surgical/Dakota%20ACDF/Dakota_Surgical%20Technique.pdf?role=work')
    expect(dropboxAppLink('')).toBe('')
  })
})
