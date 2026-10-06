import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { GUIDES } from './guides.js'

// A guide is a row in GUIDES and a file on disk, and the two can disagree
// silently: a row with no file gives a card that 404s, and a file with no row
// is a guide nobody can reach. Neither shows up anywhere else.

const ROOT = join(__dirname, '..', 'theatre-guides')

describe('every listed guide has its file', () => {
  it.each(GUIDES.map(g => [g.slug, g.file]))('%s', (slug, file) => {
    expect(existsSync(join(ROOT, file)), `${slug} → ${file}`).toBe(true)
  })
})

describe('the proximal tibia guide', () => {
  const guide = GUIDES.find(g => g.slug === 'prox-tib-3.5')

  it('is listed under Orthopaedics', () => {
    expect(guide).toBeTruthy()
    expect(guide.group).toBe('Orthopaedics')
    expect(guide.maker).toBe('DePuy Synthes')
    expect(guide.name).toBe('Proximal Tibia Plates 3.5')
  })

  it('names both source documents', () => {
    // Two plates in one guide, so two revisions. This line is how anybody
    // tells whether the guide still matches what the manufacturer publishes.
    expect(guide.revision).toBe('SE_858604 AA (lateral) · J5954-A (medial)')
  })

  it('carries the search words the card has no room for', () => {
    for (const term of ['Plate selector', 'Technique', 'Screw/drill/torque', 'Trays', 'RHH small frag']) {
      expect(guide.keywords, term).toContain(term)
    }
    expect(guide.keywords).toContain('Lateral VA-LCP and medial LCP plates in one app')
  })

  it('is a whole, self-contained document', () => {
    // It is rendered inside an iframe sandboxed to scripts, with no network
    // and no way back into the app. Anything it tried to fetch would simply
    // not arrive, and the page would be missing pieces with no error.
    const html = readFileSync(join(ROOT, guide.file), 'utf8')
    expect(html.slice(0, 20).toLowerCase()).toContain('<!doctype html>')
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
    expect(html).not.toMatch(/src="https?:|href="https?:[^"]*\.(?:css|js)/)
  })

  it('is big enough to be the guide and not a stub', () => {
    expect(statSync(join(ROOT, guide.file)).size).toBeGreaterThan(500_000)
  })

  it('is reached by slug, never by a path from the request', () => {
    // The file name is looked up in this table rather than joined from what
    // was asked for, which is what stops "../../" being a slug.
    expect(guide.file).toBe('prox-tib-3.5/index.html')
    expect(guide.file).not.toMatch(/\.\./)
  })
})

describe('the guides endpoint serves pages, not downloads', () => {
  it('sets an HTML content type', () => {
    const source = readFileSync(join(__dirname, 'guides.js'), 'utf8')
    expect(source).toMatch(/Content-Type['"]?,\s*'text\/html; charset=utf-8'/)
    // No Content-Disposition anywhere: that header is what turns a page into
    // a download, and a 1MB field guide landing in Downloads is not a guide.
    expect(source).not.toMatch(/Content-Disposition/i)
  })

  it('is bundled with the function that reads it', () => {
    // These files are read off disk at request time. Without includeFiles
    // they are not in the deployment at all and every guide 404s in
    // production while working perfectly here.
    const vercel = JSON.parse(readFileSync(join(__dirname, '..', 'vercel.json'), 'utf8'))
    expect(vercel.functions['api/guides.js'].includeFiles).toBe('theatre-guides/**')
  })
})
