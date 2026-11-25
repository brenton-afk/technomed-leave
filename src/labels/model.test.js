import { describe, it, expect } from 'vitest'
import {
  cmykToRgb, toHex, trimOffset, TRIM_W_PT, TRIM_H_PT, MM_PER_PT, textLines, layoutText, cleanRuns, importLabel,
  nameCheck, summarise, matchesSearch, sanitiseLabel, BASELINE, LINE_HEIGHT, fontName, duplicateLabel, blankLabel, pivot
} from './model.js'
import { SEED_LABELS, SEED_LOGOS } from '../../api/_labelSeed.js'

describe('colour', () => {
  it('converts CMYK to screen RGB', () => {
    expect(cmykToRgb(0, 0, 0, 100)).toEqual({ r: 0, g: 0, b: 0 })
    expect(cmykToRgb(0, 0, 0, 0)).toEqual({ r: 255, g: 255, b: 255 })
    expect(cmykToRgb(89, 80, 0, 0)).toEqual({ r: 28, g: 51, b: 255 })
    expect(cmykToRgb(4, 10, 96, 0)).toEqual({ r: 245, g: 230, b: 10 })
  })
  it('reads every colour form in the export', () => {
    expect(toHex('cmyk(0,0,0,100)')).toBe('#000000')
    expect(toHex('cmyk(0, 0, 0, 100)')).toBe('#000000')
    expect(toHex('rgb(76, 212, 59)')).toBe('#4cd43b')
    expect(toHex('rgb(#AAAAAA)')).toBe('#aaaaaa')
    expect(toHex('#FDDB31')).toBe('#fddb31')
    expect(toHex('#abc')).toBe('#aabbcc')
    expect(toHex('javascript:alert(1)')).toBeNull()
  })
})

describe('trim', () => {
  it('centres 68 × 21 on both Vistaprint canvases', () => {
    expect(trimOffset({ w: 70.7, h: 23 })).toEqual({ x: 1.35, y: 1.0 })
    expect(trimOffset({ w: 70.7, h: 24 })).toEqual({ x: 1.35, y: 1.5 })
    expect(trimOffset({ w: 72, h: 25 })).toEqual({ x: 2, y: 2 })
  })
  it('is 192.756 × 59.528 pt', () => {
    expect(TRIM_W_PT).toBeCloseTo(192.756, 3)
    expect(TRIM_H_PT).toBeCloseTo(59.528, 3)
    expect(MM_PER_PT).toBeCloseTo(0.3528, 4)
  })
})

describe('text layout', () => {
  const item = { t: 'txt', x: 10, y: 5, w: 30, h: 8, ha: 'center', va: 'top', runs: [
    { text: 'K-Wire (Nitinol)\n', font: 'Mulish', size: 8 }, { text: '1.8 x 500mm', font: 'Mulish', size: 10 }] }
  it('splits runs into lines, each as tall as its largest type', () => {
    const lines = textLines(item)
    expect(lines.map(l => l.segments.map(s => s.text).join(''))).toEqual(['K-Wire (Nitinol)', '1.8 x 500mm'])
    expect(lines.map(l => l.size)).toEqual([8, 10])
  })
  it('anchors by alignment and steps lines by size × line spacing (Fabric\'s layout)', () => {
    const [a, b] = layoutText(item)
    expect(a.anchorX).toBe(25)
    expect(a.anchor).toBe('middle')
    expect(a.baseline).toBeCloseTo(5 + BASELINE * 8 * MM_PER_PT, 6)
    expect(b.top).toBeCloseTo(5 + 8 * MM_PER_PT * LINE_HEIGHT, 6)
    expect(layoutText({ ...item, ha: 'right' })[0].anchorX).toBe(40)
    expect(layoutText({ ...item, ha: 'left' })[0].anchor).toBe('start')
    expect(layoutText({ ...item, lh: 2 })[1].top).toBeCloseTo(5 + 8 * MM_PER_PT * 2, 6)
  })
  it('keeps an empty line at the size it was typed in', () => {
    const lines = textLines({ runs: [{ text: 'A\n', size: 8 }, { text: '\n', size: 12 }, { text: 'B', size: 8 }] })
    expect(lines.map(l => l.size)).toEqual([8, 12, 8])
  })
  it('turns text about its anchor and shapes about their centre', () => {
    expect(pivot({ t: 'txt', x: 10, y: 5, w: 30, ha: 'center' })).toEqual([25, 5])
    expect(pivot({ t: 'rect', x: 10, y: 5, w: 30, h: 10 })).toEqual([25, 10])
  })
})

describe('importing the Vistaprint export', () => {
  it('drops trailing spaces and blank lines, and moves the box down for leading ones', () => {
    const { runs, shift } = cleanRuns([
      ['\n', 'Apertura Web', '8pt', 'cmyk(0,0,0,100)', 'normal', null],
      ['Fascial Blade \n', 'Apertura Web', '8pt', 'cmyk(0,0,0,100)', 'normal', null],
      [' ', 'Apertura Web', '8pt', 'cmyk(0,0,0,100)', 'normal', null]
    ])
    expect(runs).toEqual([{ text: 'Fascial Blade', font: 'Mulish', size: 8, color: '#000000', underline: false, bold: false, italic: false }])
    expect(shift).toBeCloseTo(8 * MM_PER_PT * LINE_HEIGHT, 3)
  })
  it('keeps the spaces inside a line and the coloured, underlined runs', () => {
    const { runs } = cleanRuns([
      ['Ref: 71-AL-85....                 Rebate Code: EY034   ', 'Apertura Web', '8pt', 'cmyk(0,0,0,100)', 'normal', null]
    ])
    expect(runs[0].text).toBe('Ref: 71-AL-85....                 Rebate Code: EY034')
    const green = cleanRuns([['Crosslink 35 X 46 mm ', 'Apertura Web', '8pt', 'cmyk(0,0,0,100)', 'normal'], ['GREEN', 'Apertura Web', '8pt', 'rgb(76, 212, 59)', 'underline']]).runs
    expect(green.map(r => [r.text, r.color, r.underline])).toEqual([['Crosslink 35 X 46 mm ', '#000000', false], ['GREEN', '#4cd43b', true]])
  })
  it('maps Vistaprint fonts to ours', () => {
    expect(fontName('Apertura Web')).toBe('Mulish')
    expect(fontName('Borges Titulo CE Blanca')).toBe('Cormorant Garamond')
    expect(fontName('Alex Brush')).toBe('Alex Brush')
    expect(fontName('Arial')).toBe('Arial')
    expect(fontName('Comic Sans')).toBe('Mulish')
  })
  it('flags a name that disagrees with the label', () => {
    expect(nameCheck('Signus Diplomat K-Wire 1.6 x 500mm', 'K-Wire (Nitinol)\n1.8 x 500mm')).toBe('Name says 1.6, label reads 1.8')
    expect(nameCheck('Signus Diplomat K-Wire 1.6 x 550mm', '1.6 x 550mm')).toBe('')
    expect(nameCheck('Dakota 18x15 cage', '18 x 15mm')).toBe('')
  })
  it('leaves out the white page ground and orders items by z', () => {
    const l = importLabel({ id: 'x', name: ' A  label ', w: 70.7, h: 24, items: [
      { t: 'txt', x: 1, y: 1, w: 5, h: 3, z: 5, ha: 'left', va: 'top', runs: [['B', 'Arial', '8pt', 'cmyk(0,0,0,100)', 'normal']] },
      { t: 'rectangle', x: 0, y: 0, w: 70.7, h: 24, z: -1001, color: 'rgb(#FFFFFF)' },
      { t: 'rectangle', x: 0, y: 0, w: 5, h: 24, z: 2, color: 'cmyk(14,90,0,0)', stroke: '{"color":"rgb(255, 255, 255)","thickness":"0.35mm"}' },
      { t: 'img', k: 'i8', x: 2, y: 2, w: 10, h: 3, z: 9, crop: { t: 0, b: 0, l: 0, r: 0 } }
    ] }, { i8: 'seaspine' })
    expect(l.name).toBe('A label')
    expect(l.items.map(i => i.t)).toEqual(['rect', 'txt', 'img'])
    expect(l.items[0].stroke).toEqual({ color: '#ffffff', width: 0.35 })
    expect(l.items[2]).toMatchObject({ k: 'seaspine' })
    expect(l.items[2].crop).toBeUndefined()
  })
})

describe('the seed', () => {
  it('has all 94 labels, the logos once each, and text tidied', () => {
    expect(SEED_LABELS).toHaveLength(94)
    expect(SEED_LOGOS).toHaveLength(10)
    const keys = new Set(SEED_LOGOS.map(l => l.k))
    for (const l of SEED_LABELS) {
      for (const i of l.items) {
        if (i.t === 'img') expect(keys.has(i.k), `${l.name} → ${i.k}`).toBe(true)
        if (i.t === 'txt') for (const line of i.runs.map(r => r.text).join('').split('\n')) expect(line).toBe(line.replace(/\s+$/, ''))
      }
      expect(l.name).toBe(l.name.trim())
    }
  })
  it('imports the K-wire as the label reads and marks it to check', () => {
    const k = SEED_LABELS.find(l => l.name === 'Signus Diplomat K-Wire 1.6 x 500mm')
    const words = k.items.filter(i => i.t === 'txt').map(i => i.runs.map(r => r.text).join('')).join('\n')
    expect(words).toContain('1.8 x 500mm')
    expect(words).toContain('MACNIT18500')
    expect(k.check).toBe('Name says 1.6, label reads 1.8')
    expect(SEED_LABELS.filter(l => l.check)).toHaveLength(1)
  })
  it('reads REF, rebate code and brand for the library', () => {
    const logos = Object.fromEntries(SEED_LOGOS.map(l => [l.k, l]))
    const dakota = SEED_LABELS.find(l => l.name === 'Dakota 18x15 cage')
    expect(summarise(dakota, logos)).toMatchObject({ ref: '71-AL-85....', rebate: 'EY034', brand: 'E4 Surgical' })
    const screw = SEED_LABELS.find(l => l.name === 'Signus Diplomat Set Screw')
    expect(summarise(screw, logos)).toMatchObject({ ref: 'AB0140-55000', rebate: 'QQ742', brand: 'SIGNUS' })
    expect(matchesSearch(screw, logos, 'qq742')).toBe(true)
    expect(matchesSearch(screw, logos, 'signus set')).toBe(true)
    expect(matchesSearch(screw, logos, 'dakota')).toBe(false)
  })
})

describe('what may be saved', () => {
  it('keeps the model and drops the rest', () => {
    const out = sanitiseLabel({ name: '  X ', w: 70.7, h: 23, evil: 1, items: [
      { id: 'a', t: 'txt', x: 1, y: 2, w: 3, h: 4, ha: 'center', lh: 1.4, ls: 50, onclick: 'x', runs: [{ text: 'Hi', font: 'Apertura Web', size: 9, color: 'red', italic: true }] },
      { id: 'b', t: 'img', k: 'nope', x: 0, y: 0, w: 1, h: 1 },
      { id: 'c', t: 'img', k: 'seaspine', x: 0, y: 0, w: 1, h: 1, url: 'https://evil' },
      { id: 'd', t: 'ellipse', x: 0, y: 0, w: 1, h: 1, fill: 'cmyk(0,0,0,100)', locked: true }
    ] }, { logoKeys: new Set(['seaspine']) })
    expect(out.name).toBe('X')
    expect(out.evil).toBeUndefined()
    expect(out.items.map(i => i.id)).toEqual(['a', 'c', 'd'])
    expect(out.items[0]).toMatchObject({ lh: 1.4, ls: 50, runs: [{ text: 'Hi', font: 'Mulish', color: '#000000', italic: true }] })
    expect(out.items[0].onclick).toBeUndefined()
    expect(out.items[1].url).toBeUndefined()
    expect(out.items[2]).toMatchObject({ fill: '#000000', locked: true })
  })
  it('duplicates and starts blank labels at 68 × 21 with bleed', () => {
    const b = blankLabel()
    expect([b.w, b.h]).toEqual([70.7, 23])
    const d = duplicateLabel({ ...b, id: 'x', version: 3, check: 'c' })
    expect(d.id).toBeUndefined()
    expect(d.version).toBeUndefined()
    expect(d.name).toBe('New label (copy)')
    expect(d.items[0].id).not.toBe(b.items[0].id)
  })
})
