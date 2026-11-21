// ─── A tray list as a PDF, for an iPhone's share sheet (Brent, 21 Nov 2026) ──
// "Print button still not working." An iPhone running the portal from its
// Home Screen does nothing when a page asks it to print. What it will do is
// share a file — and its share sheet has Print, AirDrop, Mail and Save to
// Files. So on an iPhone, Print makes the same sheet as a PDF: the kit and
// where it is, each tray with its photo, code, description, type, quantity
// and a box to count or tick, and the "Checked by" line at the foot.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PLACES = { office: 'TM office / Warehouse', CLV: 'Calvary', RHH: 'RHH' }
const A4 = [595.28, 841.89]
const M = 36
const NAVY = rgb(0.016, 0.153, 0.275)
const GREY = rgb(0.29, 0.36, 0.41)
const LINE = rgb(0.85, 0.88, 0.9)

/** Only what the built-in font can draw; the rest becomes its nearest plain form. */
function plain(font, s) {
  const swapped = String(s ?? '').replace(/[✓✔]/g, 'ok').replace(/[‐‑‒–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/\s+/g, ' ')
  let out = ''
  for (const ch of swapped) {
    try { font.encodeText(ch); out += ch } catch { out += '?' }
  }
  return out
}

function wrap(font, size, text, width) {
  const words = String(text || '').split(' ')
  const lines = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  // A single unbroken word wider than the column is cut by characters.
  return lines.flatMap(l => {
    if (font.widthOfTextAtSize(l, size) <= width) return [l]
    const parts = []; let p = ''
    for (const ch of l) { if (font.widthOfTextAtSize(p + ch, size) > width && p) { parts.push(p); p = ch } else p += ch }
    if (p) parts.push(p)
    return parts
  })
}

/**
 * @param photos { [trayName]: Uint8Array } JPEG or PNG bytes, optional.
 * @returns Uint8Array, the PDF.
 */
export async function trayListPdf(kit, list, { only = '', printedBy = '', at = new Date(), photos = {} } = {}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  doc.setTitle(`${kit?.name || 'Tray list'} - tray list`)
  const trays = (list?.trays || []).filter(t => !only || t.name === only)
  const W = A4[0] - 2 * M
  // Columns: code, description, type, qty, count box.
  const cols = [0.22, 0.43, 0.13, 0.08, 0.14].map(f => f * W)
  const xs = cols.reduce((a, w, i) => [...a, a[i] + w], [M]).slice(0, 5)

  let page = doc.addPage(A4)
  let y = A4[1] - M
  const text = (s, x, yy, { size = 10, f = font, colour = rgb(0.06, 0.12, 0.17), right = 0 } = {}) => {
    const t = plain(f, s)
    page.drawText(t, { x: right ? right - f.widthOfTextAtSize(t, size) : x, y: yy, size, font: f, color: colour })
  }
  const newPage = () => { page = doc.addPage(A4); y = A4[1] - M }
  const head = () => {
    const h = 14
    ;['Code', 'Description', 'Type', 'Qty', 'Count / tick'].forEach((c, i) =>
      text(c.toUpperCase(), xs[i] + 3, y - 10, { size: 7.5, f: bold, colour: GREY, right: i >= 3 ? xs[i] + cols[i] - 3 : 0 }))
    y -= h
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.8, color: rgb(0.58, 0.63, 0.68) })
  }

  // Title
  text(kit?.name || 'Tray list', M, y - 16, { size: 16, f: bold, colour: NAVY })
  y -= 22
  const sub = [kit?.at ? `At ${PLACES[kit.at] || kit.at}` : '', list?.source?.file ? `From ${list.source.file}` : ''].filter(Boolean).join(' - ')
  if (sub) { text(sub, M, y - 10, { size: 9.5, colour: GREY }); y -= 14 }
  y -= 4
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1.6, color: NAVY })
  y -= 12

  for (const tray of trays) {
    if (y < M + 120) newPage()
    text(tray.name, M, y - 12, { size: 12, f: bold })
    y -= 18
    const bytes = photos[tray.name]
    if (bytes) {
      try {
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
        const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
        const maxH = 240
        const s = Math.min(W / img.width, maxH / img.height)
        const w = img.width * s, h = img.height * s
        if (y - h < M + 60) newPage()
        page.drawImage(img, { x: M, y: y - h, width: w, height: h })
        y -= h + 6
      } catch { /* printed without it */ }
    }
    const implants = tray.lines.filter(l => l.kind === 'implant').length
    text(`${tray.lines.length} lines - ${implants} implant${implants === 1 ? '' : 's'} counted - instruments ticked`, M, y - 9, { size: 8.5, colour: GREY })
    y -= 14
    head()
    for (const l of tray.lines) {
      const size = 9.5
      const f = l.kind === 'implant' ? bold : font
      const desc = wrap(f, size, plain(f, l.description), cols[1] - 6)
      const code = wrap(f, size, plain(f, l.code || '-'), cols[0] - 6)
      const rows = Math.max(desc.length, code.length)
      const h = rows * 12 + 6
      if (y - h < M + 24) { newPage(); head() }
      code.forEach((c, i) => text(c, xs[0] + 3, y - 12 - i * 12, { size, f }))
      desc.forEach((c, i) => text(c, xs[1] + 3, y - 12 - i * 12, { size, f }))
      text(l.kind === 'implant' ? 'Implant' : 'Instrument', xs[2] + 3, y - 12, { size, f })
      text(String(l.qty ?? ''), 0, y - 12, { size, f, right: xs[3] + cols[3] - 3 })
      page.drawRectangle({ x: xs[4] + 4, y: y - h + 3, width: cols[4] - 6, height: h - 6, borderColor: rgb(0.58, 0.63, 0.68), borderWidth: 0.8 })
      y -= h
      page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: LINE })
    }
    y -= 16
  }
  if (!trays.length) { text('No trays on this list.', M, y - 12); y -= 20 }

  const when = at.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Hobart' })
  if (y < M + 20) newPage()
  text(`Printed ${when}${printedBy ? ` by ${printedBy}` : ''} from the TechnoMed portal - Checked by ____________ - Date ____________`, M, Math.max(M, y - 10), { size: 8, colour: rgb(0.58, 0.63, 0.68) })
  return doc.save()
}

/** An iPhone or iPad (an iPad says it is a Mac, but has a touch screen). */
export const isAppleMobile = (nav = typeof navigator !== 'undefined' ? navigator : null) =>
  Boolean(nav) && (/iP(hone|ad|od)/.test(nav.userAgent || '') || (/Macintosh/.test(nav.userAgent || '') && (nav.maxTouchPoints || 0) > 1))
