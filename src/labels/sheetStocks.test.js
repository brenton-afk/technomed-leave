// The blank A4 label sheets the portal prints onto.
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { STOCKS, stockById, stockLayout, fitInSlot, stocksFor } from './sheetStocks.js'
import { buildLabelPdf } from './pdf.js'

describe('label sheets', () => {
  it('every place on every sheet is on the A4 page, none overlapping', () => {
    for (const s of STOCKS) {
      const { slots, slot, page } = stockLayout(s)
      expect(slots).toHaveLength(s.across * s.down)
      for (const p of slots) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.x + slot.w).toBeLessThanOrEqual(page.w + 0.01)
        expect(p.y + slot.h).toBeLessThanOrEqual(page.h + 0.01)
      }
      if (s.across > 1) expect(s.pitchX).toBeGreaterThanOrEqual(s.label.w)
      if (s.down > 1) expect(s.pitchY).toBeGreaterThanOrEqual(s.label.h - 0.01)
    }
  })
  it('the gloss 8-up is Avery L7765 (the courier label size)', () => {
    const s = stockById('L7765')
    expect(s.gloss).toBe(true)
    expect(stockLayout(s).slots[7]).toEqual({ x: 106.25, y: 216.19 })
  })
  it('a design that fits prints at actual size, centred', () => {
    expect(fitInSlot({ w: 68, h: 21 }, { w: 99.1, h: 38.1 })).toMatchObject({ scale: 1, w: 68, h: 21 })
    const f = fitInSlot({ w: 68, h: 21 }, { w: 99.1, h: 38.1 })
    expect(f.dx).toBeCloseTo(15.55, 3)
    expect(f.dy).toBeCloseTo(8.55, 3)
  })
  it('a design too big is shrunk, proportions kept; fill enlarges', () => {
    const shrunk = fitInSlot({ w: 99.1, h: 67.7 }, { w: 63.5, h: 38.1 })
    expect(shrunk.scale).toBeLessThan(1)
    expect(shrunk.w / shrunk.h).toBeCloseTo(99.1 / 67.7, 6)
    expect(fitInSlot({ w: 68, h: 21 }, { w: 99.1, h: 38.1 }, { fill: true }).w).toBeCloseTo(99.1, 6)
  })
  it('offers sheets the design fits first, closest size first', () => {
    expect(stocksFor({ w: 99.1, h: 67.7 })[0].label).toEqual({ w: 99.1, h: 67.7 })
    expect(stocksFor({ w: 99.1, h: 33.9 })[0].id).toBe('J8162')
  })
  it('places labels by the sheet, nudged by the line-up offset', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    const sheet = stockLayout(stockById('L7163'))
    const job = { png, qty: 15, size: { w: 68, h: 21 }, sheet, fit: fitInSlot({ w: 68, h: 21 }, sheet.slot) }
    const doc = await PDFDocument.load(await buildLabelPdf([job], { layout: 'sheet', offset: { x: 1, y: -0.5 } }))
    // 14 a sheet: 15 labels take two sheets.
    expect(doc.getPageCount()).toBe(2)
  })
})
