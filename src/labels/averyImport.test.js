// The Avery export's template.json → a Label Studio label.
import { describe, it, expect } from 'vitest'
import { templateToLabel, wrapParagraphs, textHeight, rekey, importedIds } from './averyImport.js'
import { sanitiseLabel, layoutText, MM_PER_PT, trimSize, sheetLayout } from './model.js'

// A fixed-width "font": every character 0.5 × the size, in mm.
const measure = (t, run) => [...t].length * run.size * MM_PER_PT * 0.5

const run = (text, extra = {}) => ({ text, font: 'Arial', sizePt: 10, weight: 'normal', style: 'normal', color: '#000000', underline: false, ...extra })

// The shape of the export (Hilotherm rental sticker, J8162: 99.1 × 33.9, 16 per A4).
const hilotherm = {
  schema: 'technomed-label-template/1.0',
  name: 'Hilotherm Rental stickers',
  source: { system: 'Avery Design & Print Online (AU)', projectId: 'abc123', sku: 'J8162' },
  units: 'mm',
  label: { width: 99.1, height: 33.9, shape: 'rect', cornerRadius: 2, bleed: false },
  sheet: { paper: 'A4', width: 210, height: 297, pages: 1, labelsPerSheet: 16, grid: { marginLeft: 4.65, marginTop: 12.9, pitchX: 101.6, pitchY: 33.9, across: 2, down: 8 } },
  elements: [
    { id: 'PF2', type: 'shape', shape: 'polygon', x: 3.1, y: 3.1, w: 92.9, h: 27.9, rotation: 0, z: 0, visible: true, printable: true, fill: '#ffffff', fillOpacity: 0, stroke: '#60a3be', strokeWidthMm: 1.41, strokeOpacity: 1, points: [[92.9, 27.9], [0, 27.9], [0, 0], [92.9, 0]] },
    { id: 'PF3', type: 'text', x: 6, y: 5, w: 40, h: 20, rotation: 0, z: 1, visible: true, printable: true, valign: 'middle', lineSpacing: 1.2,
      paragraphs: [{ align: 'left', runs: [run('Hilotherm Hilotherapy Device Rental: $400')] }, { align: 'left', runs: [run('Additional daily rate: $35 per day', { sizePt: 8 })] }] },
    { id: 'PF4', type: 'image', x: 70, y: 5, w: 20, h: 10, rotation: 0, z: 2, visible: true, printable: true, src: 'assets/lpi.jpg', fit: 'stretch' },
    { id: 'PF5', type: 'image', x: 70, y: 18, w: 20, h: 10, rotation: 0, z: 3, visible: true, printable: true, src: 'assets/art.pdf', previewSrc: 'assets/art.preview.png', fit: 'stretch' }
  ]
}

describe('wrapping', () => {
  it('breaks a paragraph to its box and keeps paragraphs apart', () => {
    const runs = wrapParagraphs(hilotherm.elements[1].paragraphs, 40, measure)
    const lines = runs.map(r => r.text).join('').split('\n')
    expect(lines.length).toBeGreaterThan(2)
    // Every line's width, each run at its own size.
    const widths = [0]
    for (const r of runs) r.text.split('\n').forEach((part, i) => { if (i) widths.push(0); widths[widths.length - 1] += measure(part, r) })
    for (const w of widths) expect(w).toBeLessThanOrEqual(40.01)
    expect(lines.at(-1)).toMatch(/per day$/)
    // No line starts or ends with a space.
    for (const l of lines) expect(l).toBe(l.trim())
  })
  it('keeps each run its own style', () => {
    const runs = wrapParagraphs(hilotherm.elements[1].paragraphs, 40, measure)
    expect(runs.find(r => r.text.includes('daily')).size).toBe(8)
  })
  it('a hard line break inside a run stays a break', () => {
    const runs = wrapParagraphs([{ align: 'left', runs: [run('TechnoMed Pty Ltd\n295 Elizabeth St')] }], 200, measure)
    expect(runs.map(r => r.text).join('')).toBe('TechnoMed Pty Ltd\n295 Elizabeth St')
  })
  it('measures height the way the label lays it out', () => {
    const item = { x: 0, y: 0, w: 40, h: 99, va: 'top', lh: 1.2, runs: wrapParagraphs(hilotherm.elements[1].paragraphs, 40, measure) }
    const lines = layoutText(item)
    const last = lines.at(-1)
    expect(textHeight(item.runs, 1.2)).toBeCloseTo(last.top + last.size * MM_PER_PT * 1.13, 6)
  })
})

describe('a template becomes a label', () => {
  const { label, assets } = templateToLabel(hilotherm, measure)

  it('at its own size with its Avery sheet', () => {
    expect(trimSize(label)).toEqual({ w: 99.1, h: 33.9 })
    expect(label.sheet).toMatchObject({ across: 2, down: 8, pitchX: 101.6, left: 4.65 })
    expect(sheetLayout(label).slots).toHaveLength(16)
    expect(label.sheet.name).toBe('Avery J8162 · 16 per sheet')
    expect(label.source).toBe('avery')
    expect(label.sourceId).toBe('abc123')
  })
  it('an unfilled rectangle is an outlined box', () => {
    const box = label.items.find(i => i.t === 'rect')
    expect(box).toMatchObject({ x: 3.1, y: 3.1, w: 92.9, h: 27.9, fill: 'none', stroke: { color: '#60a3be', width: 1.41 } })
  })
  it('text is centred in its box as Avery had it', () => {
    const t = label.items.find(i => i.t === 'txt')
    expect(t.y + t.h / 2).toBeCloseTo(5 + 20 / 2, 3)
    expect(t.fit).toBe(true)
  })
  it('pictures keep their asset name until uploaded, PDFs with their PNG stand-in', () => {
    expect(assets).toEqual([{ name: 'lpi.jpg' }, { name: 'art.pdf', preview: 'art.preview.png' }])
    const keyed = rekey(label, { 'lpi.jpg': 'avery-lpi-1a2b3c', 'art.pdf': 'avery-art-4d5e6f' })
    expect(keyed.items.filter(i => i.t === 'img').map(i => i.k)).toEqual(['avery-lpi-1a2b3c', 'avery-art-4d5e6f'])
  })
  it('survives the server unchanged', () => {
    const keyed = rekey(label, { 'lpi.jpg': 'avery-lpi-1a2b3c', 'art.pdf': 'avery-art-4d5e6f' })
    const clean = sanitiseLabel(keyed, { logoKeys: new Set(['avery-lpi-1a2b3c', 'avery-art-4d5e6f']) })
    expect(clean.items).toHaveLength(keyed.items.length)
    expect(clean.trim).toEqual({ w: 99.1, h: 33.9 })
    expect(clean.sheet).toMatchObject({ across: 2, down: 8 })
  })
  it('knows which labels are already in', () => {
    expect(importedIds([{ source: 'avery', sourceId: 'abc123' }, { source: 'vistaprint' }]).has('abc123')).toBe(true)
  })
  it('refuses a file that is not a template', () => {
    expect(() => templateToLabel({ name: 'x' }, measure)).toThrow(/Not a TechnoMed label template/)
  })
})
