import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDE } from './guide.js'

// The guide is an operating procedure. A phrase quietly dropped or mangled on
// its way out of the artifact is a duty nobody performs — so rather than trust
// the extraction, this checks it.
//
// guide.source.txt holds every phrase of the artifact as published. Each one has
// to survive into the data module. It catches three things: an extraction that
// silently skips a markup shape it does not recognise, a hand-edit to guide.js
// (which the artifact would overwrite on the next sync anyway), and a re-sync
// that loses content.

function allText(node, into = []) {
  if (typeof node === 'string') into.push(node)
  else if (Array.isArray(node)) for (const child of node) allText(child, into)
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      // Machine fields, not prose.
      if (['type', 'id', 'tone', 'tagKind', 'kind', 'key', 'b'].includes(key)) continue
      allText(value, into)
    }
  }
  return into
}

const rendered = allText(GUIDE).join(' ').replace(/\s+/g, ' ')

const phrases = readFileSync(join(process.cwd(), 'src/teamLeader/guide.source.txt'), 'utf8')
  .split('\n')
  .filter(line => line.trim() && !line.startsWith('#'))

describe('the ported guide against the artifact', () => {
  it('has something to check', () => {
    // Guards against the fixture being emptied and the real assertion below
    // passing vacuously. 231 phrases at the time of the port.
    expect(phrases.length).toBeGreaterThan(200)
  })

  it('keeps every phrase the artifact publishes', () => {
    const missing = phrases.filter(phrase => !rendered.includes(phrase))
    expect(missing, 'phrases lost between the artifact and the app').toEqual([])
  })

  it('states the amended evening sweep, not the original', () => {
    // The one thing the co-writers changed. The copy that had been sitting on
    // disk since August still said 10pm.
    expect(rendered).toContain('7:00pm')
    expect(rendered).not.toContain('10:00pm')
  })
})
