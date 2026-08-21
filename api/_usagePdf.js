// ─── Scan → PDF ───────────────────────────────────────────────────────────────
// The rep may photograph a 2–3 page form or upload a PDF. Dropbox always gets a
// single PDF, so photos are combined and an uploaded PDF passes through as-is.
import { PDFDocument } from 'pdf-lib'

// pages: [{ mediaType: 'image/jpeg' | 'image/png' | 'application/pdf', data: <base64> }]
export async function buildScanPdf(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('No pages to build a PDF from')
  }

  // A single uploaded PDF needs no rebuild.
  if (pages.length === 1 && pages[0].mediaType === 'application/pdf') {
    return Buffer.from(pages[0].data, 'base64')
  }

  const pdf = await PDFDocument.create()
  pdf.setProducer('TechnoMed Staff Portal')
  pdf.setCreationDate(new Date())

  for (const page of pages) {
    const bytes = Buffer.from(page.data, 'base64')

    if (page.mediaType === 'application/pdf') {
      const source = await PDFDocument.load(bytes)
      const copied = await pdf.copyPages(source, source.getPageIndices())
      copied.forEach(p => pdf.addPage(p))
      continue
    }

    const image = page.mediaType === 'image/png'
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes)

    // A4 portrait, image scaled to fit with a small margin.
    const sheet = pdf.addPage([595.28, 841.89])
    const margin = 18
    const maxW = sheet.getWidth() - margin * 2
    const maxH = sheet.getHeight() - margin * 2
    const scale = Math.min(maxW / image.width, maxH / image.height, 1)
    const w = image.width * scale
    const h = image.height * scale
    sheet.drawImage(image, {
      x: (sheet.getWidth() - w) / 2,
      y: (sheet.getHeight() - h) / 2,
      width: w,
      height: h
    })
  }

  return Buffer.from(await pdf.save())
}
