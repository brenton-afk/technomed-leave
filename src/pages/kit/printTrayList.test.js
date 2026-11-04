import { describe, it, expect } from 'vitest'
import { trayListHtml } from './printTrayList.js'

// "Ability to print tray lists from portal" — Brent, 3 Nov 2026.

const KIT = { name: 'Diplomat', at: 'CLV' }
const LIST = {
  source: { file: 'Diplomat CLV.pdf', hospital: 'CLV' },
  trays: [
    { name: 'Pedicle screws 5.5', lines: [
      { code: 'DS-5545', description: 'Screw 5.5 x 45', qty: 6, kind: 'implant' },
      { code: '', description: 'Screwdriver <hex>', qty: 1, kind: 'instrument' }
    ] },
    { name: 'Rods and tulips', lines: [{ code: 'R-1', description: 'Rod 100mm', qty: 4, kind: 'implant' }] }
  ]
}

describe('the printed tray list', () => {
  it('heads with the kit and where it is, and gives every tray its own block', () => {
    const html = trayListHtml(KIT, LIST, { printedBy: 'Brent', at: new Date('2026-11-03T22:00:00Z') })
    expect(html).toContain('<h1>Diplomat</h1>')
    expect(html).toContain('At Calvary · From Diplomat CLV.pdf · Calvary&#39;s copy')
    expect(html.match(/<section class="tray">/g)).toHaveLength(2)
    expect(html).toContain('Screw 5.5 x 45')
    expect(html).toContain('Count / ✓')
    expect(html).toContain('Printed 4 Nov 2026')
    expect(html).toContain('by Brent')
  })

  it('prints one tray when asked', () => {
    const html = trayListHtml(KIT, LIST, { only: 'Rods and tulips' })
    expect(html.match(/<section class="tray">/g)).toHaveLength(1)
    expect(html).not.toContain('Pedicle screws')
  })

  it('never lets a tray list write markup into the page', () => {
    const html = trayListHtml(KIT, LIST)
    expect(html).toContain('Screwdriver &lt;hex&gt;')
    expect(html).not.toContain('<hex>')
  })
})

describe('photos and page breaks on the printout (Brent, 4 Nov 2026)', async () => {
  const { photoLinks } = await import('./printTrayList.js')
  it('puts each tray’s photo under its name', () => {
    const html = trayListHtml(KIT, LIST, { photos: { 'Rods and tulips': 'https://dl.example/p.jpg?a=1&b=2' } })
    expect(html).toContain('<img class="photo" src="https://dl.example/p.jpg?a=1&amp;b=2" alt="Rods and tulips">')
    expect(html.match(/class="photo"/g)).toHaveLength(1)
  })

  it('lets a long tray run onto the next page instead of leaving page 1 blank', () => {
    const html = trayListHtml(KIT, LIST)
    expect(html).not.toMatch(/\.tray \{[^}]*break-inside: avoid/)
    expect(html).toMatch(/tr \{ break-inside: avoid/)
  })

  it('fetches a link per photo, and prints without one that fails', async () => {
    const trays = [{ name: 'A', photo: '/Tray Lists/Tray Photos/K/A.jpg' }, { name: 'B', photo: '/x/B.jpg' }, { name: 'C' }]
    const fetcher = async url => url.includes('A.jpg')
      ? { json: async () => ({ url: 'https://dl.example/a' }) }
      : { json: async () => { throw new Error('no') } }
    expect(await photoLinks(trays, 'tok', fetcher)).toEqual({ A: 'https://dl.example/a' })
  })
})
