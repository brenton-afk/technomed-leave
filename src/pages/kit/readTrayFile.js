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

// ─── The tray photos ─────────────────────────────────────────────────────────
// "The photo of the tray MUST come across with the upload." Our lists carry a
// photograph of each tray under its heading. Each picture is replaced in the
// text by a marker — [PHOTO 3] — so the reading can say which tray it belongs
// to, and the picture itself stays on the phone (shrunk) until the list is
// saved. Logos and icons are left out by size.

const MIN_PHOTO_SIDE = 220

async function blobToPhoto(blob) {
  const bitmap = await createImageBitmap(blob)
  if (Math.max(bitmap.width, bitmap.height) < MIN_PHOTO_SIDE) return null
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvasToBase64(canvas, 0.8)
}

function base64ToBlob(data, type) {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

async function docxPayload(file) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.js')
  const found = []
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
    convertImage: mammoth.images.imgElement(image => image.read('base64').then(data => {
      found.push({ data, type: image.contentType })
      return { src: `photo:${found.length}` }
    }))
  })
  const photos = []
  const keep = new Map()
  for (let i = 0; i < found.length; i += 1) {
    try {
      const data = await blobToPhoto(base64ToBlob(found[i].data, found[i].type))
      if (data) { photos.push({ n: photos.length + 1, data }); keep.set(i + 1, photos.length) }
    } catch { /* a format the phone cannot draw (EMF) — no photo, the list still reads */ }
  }
  // HTML to text that keeps the table's shape: a row per line, cells split.
  const text = html
    .replace(/<img[^>]*src="photo:(\d+)"[^>]*>/g, (_, n) => (keep.has(Number(n)) ? `\n[PHOTO ${keep.get(Number(n))}]\n` : ''))
    .replace(/<\/(td|th)>/g, ' | ')
    .replace(/<\/(p|tr|h\d|li)>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  if (!text.replace(/\[PHOTO \d+\]/g, '').trim()) throw new Error('That Word document has no text in it to read.')
  return { text, photos }
}

/** The pictures embedded on one PDF page, drawn out as photos. Best effort. */
async function pdfPagePhotos(pdfjs, page) {
  const out = []
  try {
    const ops = await page.getOperatorList()
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue
      const name = ops.argsArray[i][0]
      const img = await new Promise(resolve => {
        const t = setTimeout(() => resolve(null), 3000)
        page.objs.get(name, v => { clearTimeout(t); resolve(v) })
      })
      if (!img || Math.max(img.width, img.height) < MIN_PHOTO_SIDE) continue
      const canvas = document.createElement('canvas')
      canvas.width = img.width; canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0)
      else if (img.data) {
        const rgba = new Uint8ClampedArray(img.width * img.height * 4)
        const src = img.data
        const step = src.length / (img.width * img.height)
        for (let p = 0, q = 0; p < rgba.length; p += 4, q += step) {
          rgba[p] = src[q]; rgba[p + 1] = src[q + (step > 1 ? 1 : 0)]; rgba[p + 2] = src[q + (step > 1 ? 2 : 0)]
          rgba[p + 3] = step === 4 ? src[q + 3] : 255
        }
        ctx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0)
      } else continue
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      const data = blob && await blobToPhoto(blob)
      if (data) out.push(data)
    }
  } catch { /* no photos from this page; the text still reads */ }
  return out
}

async function pdfPayload(file) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise

  // Text first: a PDF saved from Word has its table as text, and text is a
  // few KB however many photographs sit around it.
  const pages = []
  const photos = []
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n)
    const markers = []
    for (const data of await pdfPagePhotos(pdfjs, page)) {
      photos.push({ n: photos.length + 1, data })
      markers.push(`[PHOTO ${photos.length}]`)
    }
    const content = await page.getTextContent()
    // Keep line breaks where the PDF has them, so table rows stay rows.
    let line = ''
    const lines = []
    for (const item of content.items) {
      line += `${item.str}${item.hasEOL ? '' : ' '}`
      if (item.hasEOL) { lines.push(line.trim()); line = '' }
    }
    if (line.trim()) lines.push(line.trim())
    pages.push([`[PAGE ${n}]`, ...markers, ...lines].join('\n'))
  }
  const text = pages.join('\n\n')
  if (text.replace(/\[(PAGE|PHOTO) \d+\]/g, '').replace(/\s+/g, '').length > 200) return { text, photos }

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
      // A scan has no separate pictures: the page is the picture.
      return {
        images,
        photos: images.map((img, i) => ({ n: i + 1, data: img.data })),
        note: doc.numPages > MAX_PAGES ? `Only the first ${MAX_PAGES} of ${doc.numPages} pages were read.` : ''
      }
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
  if (ext === 'docx') return docxPayload(file)
  if (ext === 'pdf') return pdfPayload(file)
  if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) || /^image\//.test(file.type)) {
    const data = await shrinkImage(file)
    return { images: [{ data, mediaType: 'image/jpeg' }], photos: [{ n: 1, data }] }
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
