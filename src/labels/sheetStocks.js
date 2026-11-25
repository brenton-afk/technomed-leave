// ─── Blank label sheets the portal can print onto (Brent, 26 Nov 2026) ────
// "Print these labels onto multi-label glossy sheets … the label printer in
// the portal [should] generate the right number of labels onto the right
// sized sheet." Vistaprint only sells its sheets printed (its return-address
// sheet is 68 × 21 mm, 18 a sheet), so in-house printing uses blank A4 stock.
// These are the standard Avery A4 layouts (Avery's published templates, mm
// from the sheet's top-left). `gloss` marks stock sold in a gloss finish in
// Australia; `check` marks a layout not from Avery's template, to be
// confirmed with a test print on plain paper held against a sheet.

export const STOCKS = [
  { id: 'L7765', name: 'Avery L7765 gloss · 99.1 × 67.7 · 8 per sheet', note: 'Glossy Photo Quality, colour laser (Avery 959765). Same layout as L7165.', gloss: true,
    label: { w: 99.1, h: 67.7 }, across: 2, down: 4, left: 4.65, top: 13.09, pitchX: 101.6, pitchY: 67.7 },
  { id: 'L7123', name: 'Avery 980014 gloss · 80 × 35 · 14 per sheet', note: 'Gloss White, laser or inkjet (Avery 980014, Officeworks / JB Hi-Fi). Layout estimated — test print first.', gloss: true, check: true,
    label: { w: 80, h: 35 }, across: 2, down: 7, left: 20, top: 26, pitchX: 90, pitchY: 35 },
  { id: 'L7165', name: 'Avery L7165 · 99.1 × 67.7 · 8 per sheet', label: { w: 99.1, h: 67.7 }, across: 2, down: 4, left: 4.65, top: 13.09, pitchX: 101.6, pitchY: 67.7 },
  { id: 'L7163', name: 'Avery L7163 · 99.1 × 38.1 · 14 per sheet', note: 'Address labels.', label: { w: 99.1, h: 38.1 }, across: 2, down: 7, left: 4.65, top: 15.15, pitchX: 101.6, pitchY: 38.1 },
  { id: 'J8162', name: 'Avery J8162 / L7162 · 99.1 × 33.9 · 16 per sheet', label: { w: 99.1, h: 33.9 }, across: 2, down: 8, left: 4.65, top: 12.9, pitchX: 101.6, pitchY: 33.9 },
  { id: 'L7160', name: 'Avery L7160 · 63.5 × 38.1 · 21 per sheet', note: 'Address labels.', label: { w: 63.5, h: 38.1 }, across: 3, down: 7, left: 7.21, top: 15.15, pitchX: 66.04, pitchY: 38.1 },
  { id: 'L7169', name: 'Avery L7169 · 99.1 × 139 · 4 per sheet', label: { w: 99.1, h: 139 }, across: 2, down: 2, left: 4.65, top: 9.5, pitchX: 101.6, pitchY: 139 },
  { id: 'L7168', name: 'Avery L7168 · 199.6 × 143.5 · 2 per sheet', label: { w: 199.6, h: 143.5 }, across: 1, down: 2, left: 5.2, top: 5, pitchX: 0, pitchY: 143.5 },
  { id: 'L7651', name: 'Avery L7651 · 38.1 × 21.2 · 65 per sheet', label: { w: 38.1, h: 21.2 }, across: 5, down: 13, left: 4.75, top: 10.7, pitchX: 40.64, pitchY: 21.2 }
]

export const stockById = id => STOCKS.find(s => s.id === id) || null

/** Where each label of a stock sits on its sheet. */
export function stockLayout(stock) {
  const slots = []
  for (let r = 0; r < stock.down; r++) {
    for (let c = 0; c < stock.across; c++) slots.push({ x: +(stock.left + c * stock.pitchX).toFixed(3), y: +(stock.top + r * stock.pitchY).toFixed(3) })
  }
  return { page: { w: 210, h: 297 }, slots, slot: { ...stock.label }, name: stock.name, check: Boolean(stock.check), id: stock.id }
}

/**
 * How big a design of `size` mm is drawn in a label of `slot` mm: actual size
 * when it fits (within 0.5 mm), else shrunk to fit; `fill` scales it up or
 * down to fill the label. Proportions are always kept; it is centred.
 */
export function fitInSlot(size, slot, { fill = false } = {}) {
  const k = Math.min(slot.w / size.w, slot.h / size.h)
  const fits = size.w <= slot.w + 0.5 && size.h <= slot.h + 0.5
  const s = fill ? k : fits ? 1 : k
  const w = size.w * s
  const h = size.h * s
  return { w, h, dx: (slot.w - w) / 2, dy: (slot.h - h) / 2, scale: s }
}

/** Stocks to offer for a design of `size`, best first: the ones it fits at actual size, closest first. */
export function stocksFor(size) {
  const waste = s => (s.label.w * s.label.h) - size.w * size.h
  const fits = s => size.w <= s.label.w + 0.5 && size.h <= s.label.h + 0.5
  return [...STOCKS].sort((a, b) => (fits(b) - fits(a)) || (fits(a) ? waste(a) - waste(b) : 0) || (b.gloss - a.gloss))
}
