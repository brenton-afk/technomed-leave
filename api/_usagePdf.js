// ─── Scan → PDF ───────────────────────────────────────────────────────────────
// The rep may photograph a 2–3 page form or upload a PDF. Dropbox always gets a
// single PDF, so photos are combined and an uploaded PDF passes through as-is.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// ─── The received stamp (Toni, 20 Nov 2026) ─────────────────────────────────
// "Please get portal to date stamp the resupply sheet with date received and
// uploaded by initials." A small boxed line in the top right of the first
// page — "RECEIVED 20 Nov 2026 · TH" — the way the team stamps paper by hand.
async function addStamp(pdf, lines) {
  const page = pdf.getPages()[0]
  if (!page || !lines?.length) return
  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  const size = 9
  const pad = 5
  const width = Math.max(...lines.map(l => font.widthOfTextAtSize(l, size))) + pad * 2
  const height = lines.length * (size + 3) + pad * 2 - 3
  const { width: pw, height: ph } = page.getSize()
  const x = pw - width - 14
  const y = ph - height - 10
  const teal = rgb(0.094, 0.604, 0.522)
  page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1), opacity: 0.92, borderColor: teal, borderWidth: 1.2 })
  lines.forEach((l, i) => page.drawText(l, { x: x + pad, y: y + height - pad - size - i * (size + 3) + 2, size, font, color: teal }))
}

/** "20 Nov 2026" in Hobart, and a person's initials from their name. */
export function stampLines({ at = new Date(), name = '' } = {}) {
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', year: 'numeric' }).format(at)
  const initials = String(name).trim().split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('')
  return [`RECEIVED ${day}`, initials ? `UPLOADED BY ${initials}` : 'UPLOADED BY PORTAL']
}

// pages: [{ mediaType: 'image/jpeg' | 'image/png' | 'application/pdf', data: <base64> }]
// stamp: lines drawn in the top right of the first page (a resupply's received stamp).
export async function buildScanPdf(pages, { stamp } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('No pages to build a PDF from')
  }

  // A single uploaded PDF needs no rebuild — unless it is to be stamped.
  if (pages.length === 1 && pages[0].mediaType === 'application/pdf') {
    if (!stamp) return Buffer.from(pages[0].data, 'base64')
    const one = await PDFDocument.load(new Uint8Array(Buffer.from(pages[0].data, 'base64')), { ignoreEncryption: true })
    await addStamp(one, stamp)
    return Buffer.from(await one.save())
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

  if (stamp) await addStamp(pdf, stamp)
  return Buffer.from(await pdf.save())
}
