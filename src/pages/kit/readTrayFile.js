// ─── A tray list, turned into something small enough to send ─────────────────
// "Still uploading….." The file used to go up whole, through a separate upload
// service, before anything was read — and a 15MB Word document of photographs
// on hospital wifi, or an upload that never got going, is a spinner for ever.
//
// Now the phone does the unpacking and only what needs reading is sent, in an
// ordinary request:
//   Word        the text (mammoth)
//   PDF         the text where it has some; a scanned PDF has none, so its
//               pages are drawn as images instead (pdf.js)
//   photo       shrunk
//   spreadsheet sent as it is — they are small
//
// Everything stays under BUDGET, which keeps the request inside the 4.5MB a
// Vercel function will accept.

export const BUDGET = 3_600_000 // characters of base64
const MAX_PAGES = 12

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

async function canvasToBase64(canvas, quality) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  return toBase64(await blob.arrayBuffer())
}

async function shrinkImage(file, longSide = 2000) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvasToBase64(canvas, 0.82)
}

async function pdfPayload(file) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise

  // Text first: a PDF saved from Word has its table as text, and text is a
  // few KB however many photographs sit around it.
  const pages = []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    // Keep line breaks where the PDF has them, so table rows stay rows.
    let line = ''
    const lines = []
    for (const item of content.items) {
      line += `${item.str}${item.hasEOL ? '' : ' '}`
      if (item.hasEOL) { lines.push(line.trim()); line = '' }
    }
    if (line.trim()) lines.push(line.trim())
    pages.push(lines.join('\n'))
  }
  const text = pages.join('\n\n')
  if (text.replace(/\s+/g, '').length > 200) return { text }

  // A scan: pictures of pages. Drawn at a size that reads well, and smaller
  // still if the whole set would not fit in one request.
  const count = Math.min(doc.numPages, MAX_PAGES)
  for (const [width, quality] of [[1600, 0.8], [1300, 0.7], [1000, 0.6]]) {
    const images = []
    let size = 0
    for (let n = 1; n <= count; n += 1) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const data = await canvasToBase64(canvas, quality)
      size += data.length
      images.push({ data, mediaType: 'image/jpeg' })
    }
    if (size <= BUDGET) {
      return { images, note: doc.numPages > MAX_PAGES ? `Only the first ${MAX_PAGES} of ${doc.numPages} pages were read.` : '' }
    }
  }
  throw new Error('That scanned PDF is too large to read in one go — split it into a few smaller files.')
}

/**
 * What to send for one tray list file: `{ text }`, `{ images }` or
 * `{ data, mediaType }`. Throws a sentence for a person.
 */
export async function trayFilePayload(file) {
  const ext = String(file.name || '').toLowerCase().split('.').pop()
  if (ext === 'docx') {
    const { default: mammoth } = await import('mammoth/mammoth.browser.js')
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    if (!value.trim()) throw new Error('That Word document has no text in it to read.')
    return { text: value }
  }
  if (ext === 'pdf') return pdfPayload(file)
  if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) || /^image\//.test(file.type)) {
    return { images: [{ data: await shrinkImage(file), mediaType: 'image/jpeg' }] }
  }
  if (ext === 'xlsx') {
    const data = toBase64(await file.arrayBuffer())
    if (data.length > BUDGET) throw new Error('That spreadsheet is too large — save the tray list sheet on its own and try again.')
    return { data, mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  }
  throw new Error('That file type cannot be read. Use a PDF, Word document, spreadsheet or photo.')
}

/** The original file as base64, when it is small enough to send whole. */
export async function originalIfSmall(file) {
  if (file.size * 1.37 > BUDGET) return null
  return toBase64(await file.arrayBuffer())
}
