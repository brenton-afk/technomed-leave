// ─── The print file ───────────────────────────────────────────────────────
// Two ways to lay the labels out (Brent, 25 Nov 2026: "I want to be able to
// print the labels on a printer that works for me"):
//
//   'label'  one label per page, the page exactly the finished label — the
//            Epson ColorWorks CW-C4010A with 68 × 21 mm die-cut media, or any
//            label printer loaded with that size. The original behaviour.
//   'sheet'  labels laid out on a sheet (A4): the label's own Avery layout,
//            else as many as fit (model.sheetLayout). Starting at any place,
//            so a part-used sheet is not wasted. Any office printer.
//
// Each label is a picture of the trimmed label (600 dpi, less for a big one —
// printDpiFor), embedded once however many times it is placed.

import { PDFDocument } from 'pdf-lib'
import { TRIM_W, TRIM_H, PT_PER_MM } from './model.js'

export const PRINT_DPI = 600
/** The most pixels drawn for one label: big sheet labels drop below 600 dpi to stay inside it. */
export const MAX_PRINT_PIXELS = 14e6

/** The dpi a label of `size` mm is drawn at for print: 600, or less to keep under MAX_PRINT_PIXELS. */
export function printDpiFor(size = { w: TRIM_W, h: TRIM_H }) {
  const sqIn = (Number(size.w) / 25.4) * (Number(size.h) / 25.4)
  if (!(sqIn > 0)) return PRINT_DPI
  return Math.min(PRINT_DPI, Math.floor(Math.sqrt(MAX_PRINT_PIXELS / sqIn)))
}

/** Pixels across and down for a trimmed label at `dpi`. */
export function printPixels(dpi = PRINT_DPI, size = { w: TRIM_W, h: TRIM_H }) {
  return { width: Math.round((Number(size.w) / 25.4) * dpi), height: Math.round((Number(size.h) / 25.4) * dpi) }
}

const pt = mm => mm * PT_PER_MM
const clampQty = q => Math.max(0, Math.min(999, Math.floor(Number(q) || 0)))

/**
 * @param jobs [{ png: Uint8Array, qty, name?, size: { w, h } mm, sheet?: { page: { w, h }, slots: [{ x, y }] } }]
 *             size defaults to 68 × 21; sheet is needed for layout 'sheet'.
 * @param layout 'label' | 'sheet'
 * @param start  for 'sheet': the place on the first sheet to start at (1 = top left)
 * @returns Uint8Array — the PDF
 */
export async function buildLabelPdf(jobs, { title = 'TechnoMed labels', at = new Date(), layout = 'label', start = 1 } = {}) {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setCreator('TechnoMed staff portal — Label Studio')
  doc.setCreationDate(at)
  if (layout === 'sheet') await placeOnSheets(doc, jobs, start)
  else {
    for (const job of jobs || []) {
      const qty = clampQty(job.qty)
      if (!qty) continue
      const size = job.size || { w: TRIM_W, h: TRIM_H }
      const W = pt(size.w)
      const H = pt(size.h)
      const image = await doc.embedPng(job.png)
      for (let i = 0; i < qty; i++) {
        const page = doc.addPage([W, H])
        page.setTrimBox(0, 0, W, H)
        page.drawImage(image, { x: 0, y: 0, width: W, height: H })
      }
    }
  }
  if (!doc.getPageCount()) throw new Error('Nothing to print — set a quantity of 1 or more')
  return doc.save()
}

/** Same sheet (page size and places) → keep filling the page; a different one starts a new page. */
const sheetKey = s => JSON.stringify([s.page.w, s.page.h, s.slots.map(p => [p.x, p.y])])

async function placeOnSheets(doc, jobs, start) {
  let page = null
  let key = ''
  let next = 0
  let first = true
  for (const job of jobs || []) {
    const qty = clampQty(job.qty)
    if (!qty) continue
    const sheet = job.sheet
    if (!sheet?.slots?.length) throw new Error(`${job.name || 'A label'} has no sheet layout`)
    const size = job.size || { w: TRIM_W, h: TRIM_H }
    const image = await doc.embedPng(job.png)
    if (sheetKey(sheet) !== key) {
      key = sheetKey(sheet)
      page = null
      next = first ? Math.min(sheet.slots.length, Math.max(1, Math.floor(Number(start) || 1))) - 1 : 0
    }
    first = false
    for (let i = 0; i < qty; i++) {
      if (!page || next >= sheet.slots.length) {
        if (page) next = 0
        page = doc.addPage([pt(sheet.page.w), pt(sheet.page.h)])
      }
      const slot = sheet.slots[next++]
      // PDF measures up from the bottom of the page.
      page.drawImage(image, { x: pt(slot.x), y: pt(sheet.page.h - slot.y - size.h), width: pt(size.w), height: pt(size.h) })
    }
  }
}
