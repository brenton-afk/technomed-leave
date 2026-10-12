import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDES, COMING } from './guides.js'
import { PREFERENCE_SECTIONS } from '../src/clinicalPlan/preferences.js'
import { DISTRIBUTORS } from './_distributors.js'

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

// ─── The guides Aimee rebuilt, October 2026 ──────────────────────────────────
// Nine arrived by email and were installed as they were, except for one thing:
// every one of them linked out to Google Fonts. A theatre guide is read on a
// phone in a building with no signal, and a webfont that cannot load is a page
// that reflows while somebody is reading it — so the link tags were removed and
// the font stacks fall back to the system face, which is what they were going
// to do in theatre anyway.
//
// "reaches nowhere but the page itself" above is what caught it. It stopped at
// the first guide in the list; all nine had it.
describe('the October rebuild', () => {
  // All ten. Athlet + Ascot came a day later, from Aimee's second email, and
  // is the only one of them that arrived with no webfont link already — which
  // is why it was installed exactly as sent. It is held to the same rule
  // regardless, because the next export of it may not be.
  const INSTALLED = [
    'athlet-ascot', 'dakota', 'firebird-forza', 'global-plif', 'lonestar',
    'mariner', 'reform-poct', 'truprofile', 'xcore-vbr', 'surgeon-preferences'
  ]

  it.each(INSTALLED)('%s has no webfont to wait for', slug => {
    const guide = GUIDES.find(g => g.slug === slug)
    const html = readFileSync(join(ROOT, guide.file), 'utf8')
    expect(html).not.toMatch(/fonts\.googleapis\.com/)
    expect(html).not.toMatch(/fonts\.gstatic\.com/)
  })

  it('still carries a section for every surgeon the app jumps to', () => {
    // The booking's Preferences button opens this guide at `p-<surgeon>`. A
    // rebuilt file that renamed its sections would send somebody to the top of
    // the page, or to the wrong card — and the file came back a fifth of its
    // old size, so this is not a theoretical worry.
    const guide = GUIDES.find(g => g.slug === 'surgeon-preferences')
    const html = readFileSync(join(ROOT, guide.file), 'utf8')
    for (const who of PREFERENCE_SECTIONS) {
      expect(html, `anchor for ${who}`).toMatch(new RegExp(`id=["']p-${who}["']`, 'i'))
    }
  })

  it('lists XCore under the distributor that actually supplies it', () => {
    // NuVasive, which _distributors.js routes under the globus key — it calls
    // that one "Nuvasive/Globus". A wrong distributor on a guide is a wrong
    // phone call at seven in the morning.
    const xcore = GUIDES.find(g => g.slug === 'xcore-vbr')
    expect(xcore).toBeTruthy()
    expect(xcore.maker).toBe('NuVasive')
    expect(xcore.distributor).toBe('globus')
    expect(DISTRIBUTORS[xcore.distributor]).toBeTruthy()
  })

  it('finds XCore by what it is for, not only by its name', () => {
    // Its own title is "XCore Corpectomy Guide" while the team says "XCore".
    const xcore = GUIDES.find(g => g.slug === 'xcore-vbr')
    expect(xcore.keywords).toMatch(/corpectomy/i)
  })
})

// ─── A rebuilt guide has to actually arrive ──────────────────────────────────
// "Are you sure they updated? The Diplomat card still looks the same."
//
// Diplomat was right — Aimee did not send one. But the question was the right
// one to ask, because the content was cached for an hour on the reasoning that
// "a slug's content never changes". That held for about a fortnight. Eight
// guides were rebuilt under the same slugs in October, and anybody who had
// opened one in the previous hour kept the old file with nothing on screen to
// say so.
describe('serving a guide that has been rebuilt', () => {
  // ROOT here means the guides directory, not the repo.
  const source = readFileSync(join(__dirname, 'guides.js'), 'utf8')

  it('does not hold the old one for an hour', () => {
    // The header that is set, not any mention of it. The first version of
    // this matched the comment above it explaining what used to be wrong,
    // which passes whatever the code does.
    const headers = [...source.matchAll(/setHeader\('Cache-Control', '([^']+)'\)/g)]
      .map(m => m[1])
    expect(headers.length).toBeGreaterThan(0)
    expect(headers.filter(h => /max-age=(?!0\b)\d+/.test(h))).toEqual([])
  })

  it('makes the browser check before using what it has', () => {
    // It still holds the megabyte — these are one to two of them and nobody
    // wants to pay that twice for flicking back. It just asks first, and the
    // asking costs a 304 with no body.
    expect(source).toMatch(/must-revalidate/)
    expect(source).toMatch(/res\.setHeader\('ETag', etag\)/)
  })

  it('answers 304 when the file has not changed', () => {
    expect(source).toMatch(/if-none-match/)
    expect(source).toMatch(/status\(304\)/)
  })

  it('keys the tag on the file, so a rebuild changes it', () => {
    // Not on the slug, which is the thing that stayed the same, and not on a
    // date, which is the thing a redeploy resets.
    expect(source).toMatch(/createHash\('sha1'\)\.update\(html\)/)
  })

  it('leaves the list itself unstored, which is a separate fix', () => {
    // "I can't see it under orthopaedics" — the list was cached for five
    // minutes and a new guide took that long to appear.
    expect(source).toMatch(/Cache-Control', 'no-store'/)
  })
})
