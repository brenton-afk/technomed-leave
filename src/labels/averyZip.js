// Reading the Avery export ZIP in the browser, and getting each picture ready
// to be a Label Studio logo: PNG or JPEG under the 2 MB a logo may be. A
// vector PDF artwork is drawn by pdf.js at 300 dpi for the size it is used at
// (lower only if that will not fit in 2 MB); its .preview.png is the
// fall-back. Browser only (JSZip, pdf.js, canvas) — the conversion itself is
// averyImport.js.

import JSZip from 'jszip'

export const MAX_LOGO_BYTES = 2 * 1024 * 1024
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' }
const typeOf = name => TYPES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'

/**
 * The export → { templates: [{ folder, tpl }], file(folder, name) → Blob|null }.
 * Every folder's template.json is read; pictures are read when asked for.
 */
export async function readExport(file) {
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter(f => !f.dir && /(^|\/)template\.json$/.test(f.name))
  if (!entries.length) throw new Error('No label templates in that file — choose the TechnoMed_Label_Templates ZIP')
  const templates = []
  for (const f of entries) {
    try { templates.push({ folder: f.name.replace(/template\.json$/, ''), tpl: JSON.parse(await f.async('string')) } ) } catch { /* a broken template is left out */ }
  }
  const file_ = async (folder, name) => {
    const entry = zip.file(`${folder}assets/${name}`)
    if (!entry) return null
    return new Blob([await entry.async('uint8array')], { type: typeOf(name) })
  }
  return { templates, file: file_ }
}

/** Pixel size of a PNG or JPEG blob. */
export async function pictureSize(blob) {
  const bmp = await createImageBitmap(blob)
  const out = { w: bmp.width, h: bmp.height }
  bmp.close?.()
  return out
}

const canvasBlob = (canvas, type, q) => new Promise(resolve => canvas.toBlob(resolve, type, q))

/** A canvas → PNG if it fits in 2 MB, else JPEG (on white). null if neither fits. */
async function smallest(canvas) {
  const png = await canvasBlob(canvas, 'image/png')
  if (png && png.size <= MAX_LOGO_BYTES) return png
  const jpg = await canvasBlob(canvas, 'image/jpeg', 0.92)
  if (jpg && jpg.size <= MAX_LOGO_BYTES) return jpg
  return null
}

function whiteCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height)
  return { c, ctx }
}

/** A PNG/JPEG over 2 MB, drawn smaller until it fits. */
export async function shrinkPicture(blob) {
  if (blob.size <= MAX_LOGO_BYTES) return blob
  const bmp = await createImageBitmap(blob)
  for (const k of [1, 0.8, 0.65, 0.5, 0.35]) {
    const { c, ctx } = whiteCanvas(bmp.width * k, bmp.height * k)
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    const out = await smallest(c)
    if (out) return out
  }
  throw new Error('A picture is too big to bring in')
}

let pdfjsPromise = null
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })()
  }
  return pdfjsPromise
}

/** A PDF's first page as a picture for a box `mmW` mm wide: 300 dpi, or less to stay under 2 MB. */
export async function drawPdf(blob, mmW) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, isImageDecoderSupported: false, isOffscreenCanvasSupported: false }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    for (const dpi of [300, 250, 200, 150]) {
      const scale = ((Number(mmW) || base.width / 72 * 25.4) / 25.4 * dpi) / base.width
      const viewport = page.getViewport({ scale })
      const { c, ctx } = whiteCanvas(viewport.width, viewport.height)
      await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise
      const out = await smallest(c)
      if (out) return out
    }
    throw new Error('The PDF artwork is too big to bring in')
  } finally {
    doc.destroy?.()
  }
}

export const blobDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result))
  r.onerror = () => reject(new Error('A picture could not be read'))
  r.readAsDataURL(blob)
})
