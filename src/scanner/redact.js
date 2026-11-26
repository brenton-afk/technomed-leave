// ─── Painting the covering into the page (Brent, 26 Nov 2026) ─────────────────
// The rules are in redactRules.js. This draws them: the photograph onto a
// canvas, a solid white block with a navy edge over every box, and in the
// biggest block the details that are kept. The result is a new JPEG — the
// label's pixels are gone from it, not hidden under a layer anyone could
// lift off in a PDF reader.
//
// The photograph as taken stays only in the phone's memory (`originals` in the
// scan screens) so a box can be moved and the page painted again, and is let
// go once the scan is filed or abandoned.

import { stampLines, stampBoxIndex } from './redactRules.js'
import { release } from './blankCheck.js'

const NAVY = '#042746'
const JPEG = 0.9

function loadImage(base64, mediaType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The page could not be drawn to cover the patient label.'))
    img.src = `data:${mediaType};base64,${base64}`
  })
}

/** Lines of text fitted inside a box: largest size that fits, never tiny. */
function drawStamp(ctx, box, lines) {
  const pad = Math.max(4, Math.round(Math.min(box.w, box.h) * 0.08))
  const innerW = box.w - pad * 2
  const innerH = box.h - pad * 2
  if (innerW <= 0 || innerH <= 0) return
  let size = Math.floor(innerH / (lines.length * 1.3))
  const widest = s => {
    ctx.font = `600 ${s}px Helvetica, Arial, sans-serif`
    return Math.max(...lines.map(l => ctx.measureText(l).width))
  }
  while (size > 6 && widest(size) > innerW) size -= 1
  size = Math.max(6, size)
  ctx.font = `600 ${size}px Helvetica, Arial, sans-serif`
  ctx.fillStyle = NAVY
  ctx.textBaseline = 'top'
  const lineH = size * 1.3
  const top = box.y + pad + Math.max(0, (innerH - lineH * lines.length) / 2)
  lines.forEach((line, i) => {
    // Squeezed rather than cut off when even the smallest size is too wide.
    const w = ctx.measureText(line).width
    if (w > innerW) {
      ctx.save()
      ctx.translate(box.x + pad, top + i * lineH)
      ctx.scale(innerW / w, 1)
      ctx.fillText(line, 0, 0)
      ctx.restore()
    } else {
      ctx.fillText(line, box.x + pad, top + i * lineH)
    }
  })
}

/**
 * One image, covered. `boxes` are fractions of the page; `lines` go in the
 * biggest box. Returns base64 JPEG (no data: prefix).
 */
export async function coverImage(base64, boxes, lines, mediaType = 'image/jpeg') {
  const img = await loadImage(base64, mediaType)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const px = boxes.map(b => ({
    x: Math.floor(b.x * canvas.width),
    y: Math.floor(b.y * canvas.height),
    w: Math.ceil(b.w * canvas.width),
    h: Math.ceil(b.h * canvas.height)
  }))
  const edge = Math.max(2, Math.round(canvas.width / 500))
  for (const b of px) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(b.x, b.y, b.w, b.h)
    ctx.strokeStyle = NAVY
    ctx.lineWidth = edge
    ctx.strokeRect(b.x + edge / 2, b.y + edge / 2, b.w - edge, b.h - edge)
  }
  const at = stampBoxIndex(boxes)
  if (at >= 0 && lines?.length) drawStamp(ctx, px[at], lines)
  const out = canvas.toDataURL('image/jpeg', JPEG).split(',')[1]
  release(canvas)
  return out
}

/**
 * A scan page covered: both its reading copy and its sharper filing copy,
 * painted from the photograph as taken (`original`). A page with nothing to
 * cover is the photograph itself.
 */
export async function coverPage(original, { boxes = [], dtbv = false }, label, surgeon) {
  const base = {
    ...original,
    redacted: true
  }
  if (!boxes.length) return base
  const lines = stampLines(label, surgeon, { dtbv })
  const data = await coverImage(original.data, boxes, lines, original.mediaType)
  const full = original.full ? await coverImage(original.full, boxes, lines, original.mediaType) : null
  return { ...base, data, full, preview: `data:image/jpeg;base64,${data}`, mediaType: 'image/jpeg' }
}

/** Every page of a scan covered, in order. */
export async function coverPages(originals, redaction, label, surgeon) {
  const out = []
  for (let i = 0; i < originals.length; i += 1) {
    out.push(await coverPage(originals[i], redaction.pages[i] || { boxes: [] }, label, surgeon))
  }
  return out
}

// ─── A PDF uploaded instead of photographed ──────────────────────────────────
// A PDF cannot have a label painted out of it, so each page is drawn as a
// picture first and handled like a photograph.

const READ_DIM = 1568
const FILE_DIM = 2400

export async function pdfToPages(file) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false
  }).promise
  const pages = []
  for (let n = 1; n <= Math.min(doc.numPages, 12); n += 1) {
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const draw = async dim => {
      const scale = dim / Math.max(base.width, base.height)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const url = canvas.toDataURL('image/jpeg', dim === READ_DIM ? 0.85 : 0.92)
      release(canvas)
      return url
    }
    const reading = await draw(READ_DIM)
    const full = await draw(FILE_DIM)
    pages.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mediaType: 'image/jpeg',
      data: reading.split(',')[1],
      full: full.split(',')[1],
      preview: reading,
      name: `${(file.name || 'document').replace(/\.pdf$/i, '')}-page-${n}.jpg`
    })
  }
  return pages
}
