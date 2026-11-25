import { describe, it, expect } from 'vitest'
import { tidyLabel, tidySize, writeIn, diameterOf, logoHeight } from './tidy.js'
import { SEED_LABELS, SEED_LOGOS } from '../../api/_labelSeed.js'
import { summarise, sanitiseLabel, trimOffset } from './model.js'

const logos = Object.fromEntries(SEED_LOGOS.map(l => [l.k, l]))
const byName = n => SEED_LABELS.find(l => l.name === n)
const texts = l => l.items.filter(i => i.t === 'txt').map(i => i.runs.map(r => r.text).join(''))
const band = l => l.items.filter(i => i.t === 'rect' && i.x === 0).map(i => i.fill)

describe('Tidy all labels (Brent, 25 Nov 2026)', () => {
  it('tidies every seeded label, and tidying again changes nothing', () => {
    for (const l of SEED_LABELS) {
      const t = tidyLabel(l, logos)
      expect(sanitiseLabel(t.label).items).toHaveLength(t.label.items.length)
      expect(tidyLabel(t.label, logos).label.items).toEqual(t.label.items)
    }
  })

  it('never loses or invents a REF or rebate code', () => {
    for (const l of SEED_LABELS) {
      const was = summarise(l)
      const now = summarise(tidyLabel(l, logos).label)
      expect(now.rebate).toBe(was.rebate)
      const words = texts(tidyLabel(l, logos).label).join(' ').replace(/[._]/g, '')
      expect(words).toContain(was.ref.replace(/[._]/g, ''))
      expect(Boolean(now.ref)).toBe(Boolean(was.ref))
    }
  })

  it('takes the Device logo off every label', () => {
    for (const l of SEED_LABELS) {
      expect(tidyLabel(l, logos).label.items.some(i => i.k === 'device')).toBe(false)
    }
  })

  it('lays every label out the same way: TechnoMed left, maker right, name in its colour, REF / REBATE', () => {
    const t = tidyLabel(byName('Mariner set screw'), logos).label
    const off = trimOffset(t)
    const imgs = t.items.filter(i => i.t === 'img')
    expect(imgs.map(i => i.k)).toEqual(['technomed', 'seaspine'])
    expect(imgs[0].x).toBeCloseTo(off.x + 1.8)
    expect(imgs[1].crop).toBeTruthy()
    expect(texts(t)).toEqual(['SEASPINE MARINER MIS', 'Set Screw- Point Lock', 'REF  SEA-MD1-100016', 'REBATE  DE666'])
    const name = t.items.find(i => i.t === 'txt')
    expect(name.runs[0]).toMatchObject({ font: 'Mulish', size: 8, bold: true, color: '#e8641c' })
    expect(t.items.filter(i => i.t === 'txt').every(i => i.fit)).toBe(true)
  })

  it('shows REF only where there is no rebate code — fascial blades, K-wires, guidewires', () => {
    for (const n of ['Mariner Fascial Blade', 'Signus Diplomat K-Wire 1.8 x 470mm', 'Mariner Guidewire', 'Firebird NXG Guide Wire']) {
      expect(texts(tidyLabel(byName(n), logos).label).some(t => /REBATE/.test(t))).toBe(false)
    }
  })

  it('placeholder dots become a write-in line', () => {
    expect(writeIn('AB0955-00....')).toBe('AB0955-00____')
    expect(tidySize(' 14 x 12mm x .......mm')).toBe('14 × 12 mm × ____ mm')
    expect(tidySize(' Ø3.5 X')).toBe('Ø3.5 × ____ mm')
    expect(tidySize('x 10 x 24mm')).toBe('____ × 10 × 24 mm')
    expect(tidySize('x')).toBe('____ × ____ mm')
    expect(tidySize('     mm')).toBe('____ mm')
    expect(tidySize('4.5 x            mm')).toBe('4.5 × ____ mm')
  })

  it('screw size colours: Diplomat 6.5 Mariner yellow, 7.5 royal blue; every Mariner screw by diameter', () => {
    expect(band(tidyLabel(byName('Signus Diplomat 6.5mm Pedicle Screw'), logos).label)).toEqual(['#fddb31'])
    expect(band(tidyLabel(byName('Signus Diplomat 7.5mm Pedicle Screw'), logos).label)).toEqual(['#2346c8'])
    expect(band(tidyLabel(byName('Mariner 4.5mm Screw'), logos).label)).toEqual(['#4a4f57'])
    expect(band(tidyLabel(byName('Mariner 5.5mm Screw'), logos).label)).toEqual(['#8e1468'])
    expect(band(tidyLabel(byName('Mariner 6.5mm Screw'), logos).label)).toEqual(['#1f2d6e'])
    expect(band(tidyLabel(byName('Mariner 7.5mm Screw'), logos).label)).toEqual(['#2e9b45'])
    expect(band(tidyLabel(byName('Mariner Pelvic Screw 10.5mm'), logos).label)).toEqual(['#4a117d'])
    expect(band(tidyLabel(byName('Mariner set screw'), logos).label)).toEqual([])
    expect(band(tidyLabel(byName('Reform 3.5mm Smooth Shank Screw'), logos).label)).toEqual(['#ff1580', '#4cd43b'])
    expect(diameterOf('6.5 × ____ mm')).toBe(6.5)
  })

  it('logos cover about the same area: KT, nearly square, is taller than TechnoMed', () => {
    expect(logoHeight('kt', logos)).toBeGreaterThan(logoHeight('technomed', logos) * 1.4)
    expect(logoHeight('seaspine', logos)).toBeLessThan(logoHeight('technomed', logos))
  })
})
