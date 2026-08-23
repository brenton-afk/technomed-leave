import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { partitionItems } from './usageReview.js'

// "When you tap 'mark resolved' it's hard to notice that you have tapped that,
// because the screen doesn't adjust — so you think you have tapped mark resolved
// (and the system actually has) but the next one comes up and you think it's
// still the last one."
//
// Resolving cleared `manualReview`, which moved the row out of "Needs review"
// and into "Extracted items" further down the page, and the next flagged row slid
// up into the gap it left. Nothing where you were looking changed, and the count
// above never moved either.

const flagged = (id, extra = {}) => ({ id, manualReview: true, ...extra })
const plain = id => ({ id, manualReview: false })

describe('sorting the rows for review', () => {
  it('keeps a resolved row in the review list, in its place', () => {
    const items = [flagged('a'), flagged('b'), flagged('c')]
    const before = partitionItems(items).inReview.map(i => i.id)

    // The middle one is dealt with.
    items[1] = { id: 'b', manualReview: false, resolved: true }
    const after = partitionItems(items)

    expect(after.inReview.map(i => i.id)).toEqual(before)   // same rows, same order
    expect(after.clean.map(i => i.id)).toEqual([])          // it did not move house
  })

  it('counts down what is left, not what there was', () => {
    const items = [flagged('a'), flagged('b'), flagged('c')]
    expect(partitionItems(items).outstanding).toHaveLength(3)

    items[0] = { id: 'a', manualReview: false, resolved: true }
    const after = partitionItems(items)
    expect(after.outstanding).toHaveLength(2)
    // The denominator has to stay put, or "1 of 2" becomes "1 of 1" and reads as
    // finished when it is not.
    expect(after.inReview).toHaveLength(3)
  })

  it('sends a resolved row, which is the whole point of resolving it', () => {
    const items = [{ id: 'a', manualReview: false, resolved: true }, plain('b')]
    expect(partitionItems(items).sendable.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('still holds back anything left flagged', () => {
    const items = [flagged('a'), plain('b')]
    expect(partitionItems(items).sendable.map(i => i.id)).toEqual(['b'])
  })

  it('never counts a resolved row twice', () => {
    // `clean` used to be "not flagged", which after this change would have
    // included every resolved row and shown it in two sections at once.
    const items = [{ id: 'a', manualReview: false, resolved: true }, plain('b'), flagged('c')]
    const { inReview, clean, excluded } = partitionItems(items)
    const ids = [...inReview, ...clean, ...excluded].map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it('leaves an excluded row out of everything that goes anywhere', () => {
    const items = [{ id: 'a', manualReview: true, excluded: true }]
    const { inReview, outstanding, sendable, excluded } = partitionItems(items)
    expect(inReview).toHaveLength(0)
    expect(outstanding).toHaveLength(0)
    expect(sendable).toHaveLength(0)
    expect(excluded).toHaveLength(1)
  })

  it('copes with nothing at all', () => {
    const empty = partitionItems()
    expect(empty.inReview).toEqual([])
    expect(empty.sendable).toEqual([])
  })
})

describe('the review screen uses it', () => {
  const source = readFileSync(join(process.cwd(), 'src/pages/UsageScan.jsx'), 'utf8')

  it('counts what it will send, not what was never flagged', () => {
    // The Confirm button counted `clean`, so once a row was resolved the count
    // beside "file to Dropbox & email" was short by one — and with every row
    // flagged, the button stayed disabled after all of them had been resolved.
    expect(source).not.toMatch(/clean\.length/)
    expect(source).toMatch(/sendable\.length === 0/)
  })

  it('keeps one surgeon field, and it is the surname', () => {
    // Two fields for one fact, and only the surname reaches the folder name, the
    // Dropbox tree and the email subject. Correcting the other one changed
    // nothing anybody would ever see.
    expect(source).toMatch(/label="Surgeon surname"/)
    expect(source).not.toMatch(/label="Surgeon"/)
    expect(source).not.toMatch(/updateCase\('surgeonName'/)
  })

  it('calls the date what it is', () => {
    expect(source).toMatch(/label="Surgery date"/)
    expect(source).not.toMatch(/label="Date"/)
  })

  it('offers a way back from a tap on the wrong card', () => {
    expect(source).toMatch(/Undo resolve/)
  })
})

describe('banner tones', () => {
  // Every Banner in the usage scanner asked for "error" or "warn". Neither is a
  // tone — Banner's are info, warning and danger — and an unknown name fell
  // through to `info`, so a failed distributor email was drawn in the same
  // friendly teal as the hint beside it. Nine call sites, all of them wrong, and
  // nothing failed.
  const KNOWN = new Set(['info', 'warning', 'danger', 'warn', 'error', 'success'])

  it('are all names Banner actually understands', () => {
    const offenders = []
    for (const entry of readdirSync(join(process.cwd(), 'src/pages'), { withFileTypes: true })) {
      const files = entry.isDirectory()
        ? readdirSync(join(process.cwd(), 'src/pages', entry.name)).map(f => `${entry.name}/${f}`)
        : [entry.name]
      for (const file of files) {
        if (!file.endsWith('.jsx') || file.includes('.test.')) continue
        const text = readFileSync(join(process.cwd(), 'src/pages', file), 'utf8')
        for (const match of text.matchAll(/<Banner[^>]*tone="([a-z]+)"/g)) {
          if (!KNOWN.has(match[1])) offenders.push(`${file}: ${match[1]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('are not silently downgraded to the mildest one available', () => {
    const shell = readFileSync(join(process.cwd(), 'src/design/Shell.jsx'), 'utf8')
    // The aliases exist so the words people reach for land on the right styling
    // rather than on `info`.
    expect(shell).toMatch(/TONE_ALIASES/)
    expect(shell).toMatch(/warn: 'warning'/)
    expect(shell).toMatch(/error: 'danger'/)
  })
})
