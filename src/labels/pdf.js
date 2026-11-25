// ─── The print file: one label per 68 × 21 mm page ───────────────────────
// The Epson ColorWorks CW-C4010A is set to 68 × 21 mm die-cut media, so every
// page of the PDF is exactly that (192.756 × 59.528 pt) and holds one label,
// drawn edge to edge from a 600 dpi picture of the trimmed label. Quantity N
// is N pages; each picture is embedded once however many pages use it.

import { PDFDocument } from 'pdf-lib'
import { TRIM_W_PT, TRIM_H_PT } from './model.js'

export const PRINT_DPI = 600

/**
 * @param jobs [{ png: Uint8Array, qty: number, name? }]
 * @returns Uint8Array — the PDF
 */
export async function buildLabelPdf(jobs, { title = 'TechnoMed labels', at = new Date() } = {}) {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setCreator('TechnoMed staff portal — Label Studio')
  doc.setCreationDate(at)
  for (const job of jobs || []) {
    const qty = Math.max(0, Math.min(999, Math.floor(Number(job.qty) || 0)))
    if (!qty) continue
    const image = await doc.embedPng(job.png)
    for (let i = 0; i < qty; i++) {
      const page = doc.addPage([TRIM_W_PT, TRIM_H_PT])
      page.setTrimBox(0, 0, TRIM_W_PT, TRIM_H_PT)
      page.drawImage(image, { x: 0, y: 0, width: TRIM_W_PT, height: TRIM_H_PT })
    }
  }
  if (!doc.getPageCount()) throw new Error('Nothing to print — set a quantity of 1 or more')
  return doc.save()
}

/** Pixels across and down for a trimmed label at `dpi`. */
export function printPixels(dpi = PRINT_DPI) {
  return { width: Math.round((68 / 25.4) * dpi), height: Math.round((21 / 25.4) * dpi) }
}
