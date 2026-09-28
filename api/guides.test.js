import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDES, COMING } from './guides.js'

// The guides arrive as a folder drop — eleven of them, in parts, rebuilt when a
// manufacturer revises a technique document. The list and the files on disk are
// maintained separately and will drift unless something says so.

const ROOT = 'theatre-guides'

describe('the guide list and the files', () => {
  it('has a file for every guide it offers', () => {
    // A listed guide with no file is a card that opens onto an error.
    for (const guide of GUIDES) {
      expect(existsSync(join(ROOT, guide.file)), guide.slug).toBe(true)
    }
  })

  it('offers every guide that is on disk', () => {
    // The other direction: a folder nobody listed is a guide nobody can reach,
    // which is how part two of a drop goes unnoticed.
    const listed = new Set(GUIDES.map(g => g.file.split('/')[0]))
    const onDisk = readdirSync(ROOT, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
    expect(onDisk.filter(d => !listed.has(d))).toEqual([])
  })

  it('does not list the same guide twice', () => {
    const slugs = GUIDES.map(g => g.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('does not list something as coming that has already arrived', () => {
    const here = new Set(GUIDES.map(g => g.name))
    expect(COMING.filter(c => here.has(c.name))).toEqual([])
  })
})

describe('what the guides may reach out to', () => {
  // Every page is self-contained, which is what lets them open on a hospital
  // network that blocks most of the internet — and what makes it safe to inline
  // one into a sandboxed frame. A rebuilt guide that quietly picks up a CDN font
  // would break both without anyone noticing until theatre.
  const ALLOWED = /^https?:\/\/(www\.w3\.org|technomed\.com\.au)/

  it('reaches nowhere but the page itself', () => {
    for (const guide of GUIDES) {
      const html = readFileSync(join(ROOT, guide.file), 'utf8')
      const external = [...html.matchAll(/https?:\/\/[a-zA-Z0-9.-]+/g)]
        .map(m => m[0])
        .filter(url => !ALLOWED.test(url))
      expect([...new Set(external)], guide.slug).toEqual([])
    }
  })
})

describe('the restricted guide', () => {
  it('is marked as restricted', () => {
    // Everything is behind the login today, so this changes only the wording on
    // screen. It is here so that if the others are ever opened up, the one that
    // names individual surgeons is not opened up with them by accident.
    const preferences = GUIDES.find(g => g.slug === 'surgeon-preferences')
    expect(preferences?.restricted).toBe(true)
  })

  it('is the only one that is', () => {
    expect(GUIDES.filter(g => g.restricted).map(g => g.slug)).toEqual(['surgeon-preferences'])
  })
})
