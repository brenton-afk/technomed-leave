// Labels of their own size (the Avery sheet labels) beside the 68 × 21 implant labels.
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { trimSize, trimOffset, hasOwnSize, sheetLayout, sanitiseLabel, blankLabel, duplicateLabel, sizeText, isNoFill } from './model.js'
import { buildLabelPdf, printDpiFor, printPixels } from './pdf.js'
import { tidyLabel } from './tidy.js'
import { itemToSpec, objectToItem } from './fabricAdapter.js'

const greenguard = {
  name: 'Avery-2 per Sheet-500 July', w: 199.6, h: 143.5, trim: { w: 199.6, h: 143.5 },
  sheet: { name: 'Avery 7168 · 2 per sheet', pageW: 210, pageH: 297, left: 5.2, top: 4.975, pitchX: 0, pitchY: 143.53, across: 1, down: 2 },
  items: [{ id: 'a1', t: 'rect', x: 3, y: 3, w: 90, h: 27, rot: 0, fill: 'none', stroke: { color: '#60a3be', width: 1.41 } }],
  source: 'avery', sourceId: '70f0d60a0abd5477b90491acdf206b11'
}

describe('a label with its own size', () => {
  it('an implant label is still 68 × 21 with the Vistaprint bleed', () => {
    expect(hasOwnSize({ w: 70.7, h: 23 })).toBe(false)
    expect(trimSize({ w: 70.7, h: 23 })).toEqual({ w: 68, h: 21 })
    expect(trimOffset({ w: 70.7, h: 23 })).toEqual({ x: 1.35, y: 1.0 })
  })
  it('a sheet label is its own size, with no bleed', () => {
    expect(trimSize(greenguard)).toEqual({ w: 199.6, h: 143.5 })
    expect(trimOffset(greenguard)).toEqual({ x: 0, y: 0 })
    expect(sizeText(greenguard)).toBe('199.6 × 143.5 mm')
  })
  it('keeps its size, sheet and Avery id through saving', () => {
    const clean = sanitiseLabel(greenguard)
    expect(clean.w).toBe(199.6)
    expect(clean.h).toBe(143.5)
    expect(clean.trim).toEqual({ w: 199.6, h: 143.5 })
    expect(clean.sheet).toMatchObject({ across: 1, down: 2, pitchY: 143.53 })
    expect(clean.sourceId).toBe('70f0d60a0abd5477b90491acdf206b11')
    expect(clean.items[0].fill).toBe('none')
  })
  it('an implant label gains no size or sheet when saved', () => {
    const clean = sanitiseLabel({ name: 'x', w: 70.7, h: 23, items: [], sheet: { across: 2, down: 2 } })
    expect(clean.trim).toBeUndefined()
    expect(clean.sheet).toBeUndefined()
  })
  it('a duplicate is not taken for the imported original', () => {
    const d = duplicateLabel({ ...greenguard, id: 'x', version: 3 })
    expect(d.sourceId).toBeUndefined()
    expect(d.trim).toEqual(greenguard.trim)
  })
  it('a new sheet label of any size', () => {
    const b = blankLabel('Box label', { w: 99.1, h: 67.7 })
    expect(trimSize(b)).toEqual({ w: 99.1, h: 67.7 })
    expect(sanitiseLabel(b).trim).toEqual({ w: 99.1, h: 67.7 })
  })
  it('is never tidied into the implant house style', () => {
    expect(tidyLabel(greenguard).changed).toBe(false)
  })
  it('an outlined box round-trips through Fabric as no fill', () => {
    const spec = itemToSpec(greenguard.items[0])
    expect(spec.props.fill).toBe('transparent')
    expect(isNoFill(spec.props.fill)).toBe(true)
    const back = objectToItem({ ...spec.props, tmKind: 'rect', scaleX: 1, scaleY: 1 })
    expect(back.fill).toBe('none')
  })
})

describe('sheets', () => {
  it("uses the label's own Avery layout", () => {
    const s = sheetLayout(greenguard)
    expect(s.page).toEqual({ w: 210, h: 297 })
    expect(s.slots).toEqual([{ x: 5.2, y: 4.975 }, { x: 5.2, y: 148.505 }])
  })
  it('fits as many as A4 takes when the label has no sheet', () => {
    const s = sheetLayout({ w: 70.7, h: 23 })
    // 68 wide: 2 across in 190 mm with 3 mm gaps; 21 high: 11 down in 277 mm.
    expect(s.slots.length).toBe(2 * 11)
    for (const p of s.slots) {
      expect(p.x).toBeGreaterThanOrEqual(10 - 1e-9)
      expect(p.x + 68).toBeLessThanOrEqual(200 + 1e-9)
      expect(p.y + 21).toBeLessThanOrEqual(287 + 1e-9)
    }
  })
})

describe('the print file', () => {
  // A 1×1 white PNG.
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))

  it('a big label is drawn below 600 dpi to keep the picture a sane size', () => {
    expect(printDpiFor({ w: 68, h: 21 })).toBe(600)
    const dpi = printDpiFor({ w: 199.6, h: 143.5 })
    expect(dpi).toBeLessThan(600)
    expect(dpi).toBeGreaterThanOrEqual(300)
    const px = printPixels(dpi, { w: 199.6, h: 143.5 })
    expect(px.width * px.height).toBeLessThanOrEqual(14e6)
  })
  it('one per page at the label size', async () => {
    const bytes = await buildLabelPdf([{ png, qty: 2, size: { w: 99.1, h: 67.7 } }])
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(99.1 * 72 / 25.4, 3)
    expect(height).toBeCloseTo(67.7 * 72 / 25.4, 3)
  })
  it('on sheets, from a chosen starting place', async () => {
    const sheet = sheetLayout(greenguard)
    // Start at place 2 of 2: one on the first sheet, then two on the next.
    const bytes = await buildLabelPdf([{ png, qty: 3, size: trimSize(greenguard), sheet }], { layout: 'sheet', start: 2 })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize().width).toBeCloseTo(210 * 72 / 25.4, 3)
  })
  it('a different sheet starts a new page', async () => {
    const a = { png, qty: 1, size: trimSize(greenguard), sheet: sheetLayout(greenguard) }
    const b = { png, qty: 1, size: { w: 68, h: 21 }, sheet: sheetLayout({ w: 70.7, h: 23 }) }
    const doc = await PDFDocument.load(await buildLabelPdf([a, b], { layout: 'sheet' }))
    expect(doc.getPageCount()).toBe(2)
  })
})
