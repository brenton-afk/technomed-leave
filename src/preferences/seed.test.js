import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import SEED from './seed.js'

// ─── Nothing on Aimee's card was lost turning it into data ──────────────────
// A preference dropped in transit is a tray set up wrong. So every phrase on
// every surgeon's panel of the HTML card has to be somewhere in the seed.

const HTML = readFileSync(join(process.cwd(), 'theatre-guides/restricted/surgeon-preferences/index.html'), 'utf8')
const decode = s => s.replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/&times;/g, '×').replace(/&deg;/g, '°').replace(/&rarr;/g, '→').replace(/&amp;/g, '&')
  .replace(/&#39;|&rsquo;/g, '’').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ')

const seedText = JSON.stringify(SEED).replace(/\*\*/g, '').replace(/’/g, "'")

describe('the seed', () => {
  it('has all seven surgeons, by the anchors the booking buttons open', () => {
    expect(SEED.surgeons.map(s => s.id)).toEqual(['thani', 'ibbett', 'gupta', 'jpw', 'fowler', 'atallah', 'dubey'])
  })

  it('has every system card', () => {
    const cards = (HTML.match(/class="sys-card"/g) || []).length
    expect(SEED.surgeons.reduce((n, s) => n + s.systems.length, 0)).toBe(cards)
  })

  it('keeps every phrase from every panel', () => {
    const missing = []
    for (const panel of HTML.split('<section class="panel"').slice(1)) {
      const body = panel.split('</section>')[0]
      const phrases = decode(body.replace(/<[^>]+>/g, '\n')).split('\n').map(s => s.trim().replace(/'/g, "'"))
        .filter(s => s.length > 1 && !/^\d+ of \d+ systems documented$/.test(s) && !/^[A-Z]$/.test(s) && !/^id=/.test(s))
      for (const p of phrases) if (!seedText.includes(p.replace(/’/g, "'"))) missing.push(p)
    }
    expect(missing).toEqual([])
  })
})
