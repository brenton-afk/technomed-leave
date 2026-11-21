import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { cachedDoc, keepDoc, downloadWithProgress, dropboxAppLink } from './docCache.js'
import { typeOfName } from './share.js'
import { useBackLayer } from '../backButton.js'

// ─── Read a kit's document in the portal (Brent, 11 Nov 2026) ───────────────
// "The kit room needs a viewer built in so you don't need to download the
// consignment agreement, you should be able to view it in the portal."
//
// Rebuilt 19 Nov 2026 (Brent, from an iPhone: "I can only move the page
// around, I can't actually view it easily … make it a seamless viewer like on
// Dropbox or Google Drive … glance at the document, scroll through it …
// download and print etc at the press of a button"):
//
// - Everything is laid out to the screen's width and scrolls one way, down.
//   A Word document was in a frame inside a scroller, wider than the phone, so
//   the page itself panned about; its frame now takes its content's height and
//   never scrolls or catches a touch of its own.
// - Zoom is the viewer's own: pinch, double-tap (fit ↔ 2×), or − / + on a
//   computer. The phone's page zoom stays locked (lockZoom.js); this zooms the
//   document only, and a PDF's pages are drawn again, sharp, at the new size.
// - A page counter ("3 / 12") while a PDF scrolls.
// - One bar at the bottom: Share, Download, Print, Dropbox — each one tap,
//   using the copy already on the phone (no second download).
// - Print puts the document alone on the page (a print-only copy laid in the
//   page and window.print()); a PDF is drawn page by page for it first.

export function viewKind(name = '') {
  const ext = String(name).toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image'
  if (['txt', 'csv'].includes(ext)) return 'text'
  return ''
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
export const clampZoom = z => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(z) ? z : 1))

/** Which page is on screen: the last sheet whose top is above the middle of the view. Pure. */
export function pageAt(tops, scrollTop, viewHeight) {
  const line = scrollTop + viewHeight / 3
  let page = 1
  for (let i = 0; i < tops.length; i++) if (tops[i] <= line) page = i + 1
  return page
}

// A Word document's HTML, reduced to plain formatting: mammoth writes only
// simple tags, but a link in a document can say anything, so only the tags and
// attributes below survive, and an image only from inside the document.
const KEEP = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'br', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'a', 'span', 'div', 'blockquote', 'pre', 'code'])
export function cleanWordHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const walk = node => {
    for (const el of [...node.children]) {
      const tag = el.tagName.toLowerCase()
      if (!KEEP.has(tag)) {
        if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'].includes(tag)) { el.remove(); continue }
        el.replaceWith(...el.childNodes)
        continue
      }
      for (const attr of [...el.attributes]) {
        const keep = (tag === 'img' && attr.name === 'src' && /^data:image\//i.test(attr.value))
          || (tag === 'img' && attr.name === 'alt') || ((tag === 'td' || tag === 'th') && /^(colspan|rowspan)$/.test(attr.name))
        if (!keep) el.removeAttribute(attr.name)
      }
      walk(el)
    }
  }
  walk(doc.body)
  return doc.body.firstElementChild.innerHTML
}

const WORD_CSS = `html,body{margin:0;background:#fff}
body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1d2b36;padding:20px 18px;overflow:hidden;word-wrap:break-word;overflow-wrap:anywhere}
*{max-width:100%;box-sizing:border-box}
table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #ccd5dc;padding:4px 6px;vertical-align:top}
img{height:auto}h1,h2,h3{line-height:1.25}`

const wordPage = body => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${WORD_CSS}</style>${body}`

async function wordBody(buffer) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.js')
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer })
  return cleanWordHtml(value)
}

// Speed (Brent, 12 Nov 2026: "We can't be waiting 5 minutes"): a blank sheet
// per page is laid out at once, page 1 is drawn straight away and the rest
// only as they scroll near, at no more than 1.5× (×zoom when zoomed in).
const MAX_PAGES = 400
const SHARPNESS = 1.5

const SLOW_MS = 12000
const GIVE_UP_MS = 90000

/** Resolves with the element once it exists (up to ~3s), else null. */
export async function waitForElement(get, isLive = () => true, tries = 180) {
  for (let i = 0; i < tries && isLive(); i++) {
    const el = get()
    if (el) return el
    await new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)))
  }
  return get() || null
}

/** The promise, or an error once `ms` has passed. */
export function withDeadline(promise, ms) {
  let t
  return Promise.race([
    promise,
    new Promise((_, no) => { t = setTimeout(() => no(new Error('This document took too long to open here')), ms) })
  ]).finally(() => clearTimeout(t))
}

async function openPdf(buffer) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  // pdf.js decodes pictures itself: left to choose, it hands them to the
  // browser's own decoder on anything but Chrome — an iPhone included — and a
  // signed, scanned agreement then sat on its first page for minutes there
  // (Brent, 21 Nov 2026). Same for drawing pictures off the main thread.
  return pdfjs.getDocument({ data: buffer, isImageDecoderSupported: false, isOffscreenCanvasSupported: false }).promise
}

async function layoutPdf(doc, into, scroller, isLive) {
  const width = Math.min(into.clientWidth || 360, 900)
  const first = await doc.getPage(1)
  const firstBase = first.getViewport({ scale: 1 })
  const count = Math.min(doc.numPages, MAX_PAGES)
  let zoom = 1

  const sheets = []
  for (let n = 1; n <= count; n++) {
    const sheet = document.createElement('div')
    sheet.dataset.page = String(n)
    sheet.setAttribute('aria-label', `Page ${n}`)
    sheet.style.cssText = `width:${width}px;aspect-ratio:${firstBase.width} / ${firstBase.height};margin:0 auto 10px;background:white;border-radius:3px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.35)`
    into.appendChild(sheet)
    sheets.push(sheet)
  }

  const drawnAt = new Map()
  const draw = async n => {
    if (!isLive() || drawnAt.get(n) === zoom) return
    const at = zoom
    drawnAt.set(n, at)
    const page = n === 1 ? first : await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const ratio = Math.min((window.devicePixelRatio || 1) * at, SHARPNESS * Math.min(at, 2.5))
    const viewport = page.getViewport({ scale: (width / base.width) * Math.max(ratio, 1) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.cssText = 'width:100%;height:auto;display:block'
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    if (!isLive() || drawnAt.get(n) !== at) return
    const sheet = sheets[n - 1]
    sheet.style.aspectRatio = `${base.width} / ${base.height}`
    sheet.replaceChildren(canvas)
  }

  await draw(1)
  if (count > 1) draw(2).catch(() => {})
  let observer = null
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) draw(Number(e.target.dataset.page)).catch(() => {})
    }, { root: scroller || null, rootMargin: '1200px 0px' })
    sheets.forEach(s => observer.observe(s))
  } else {
    for (let n = 2; n <= count; n++) await draw(n)
  }
  return {
    total: doc.numPages,
    sheets,
    stop: () => observer?.disconnect(),
    // Zoomed: the pages near the view are drawn again at the new sharpness.
    rescale: z => {
      zoom = Math.round(z * 4) / 4
      if (!observer) return
      sheets.forEach(s => { observer.unobserve(s); observer.observe(s) })
    }
  }
}

/** Every page of a PDF as pictures, for printing. */
async function pdfPictures(doc, onPage) {
  const out = []
  const count = Math.min(doc.numPages, MAX_PAGES)
  for (let n = 1; n <= count; n++) {
    onPage(n, count)
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 1240 / base.width }) // about 150 dpi on A4
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    out.push(canvas.toDataURL('image/jpeg', 0.85))
  }
  return out
}

/** Puts `node` alone on the printed page, prints, and tidies up afterwards. */
export function printAlone(node, win = window) {
  const doc = win.document
  doc.getElementById('tm-print-root')?.remove()
  const root = doc.createElement('div')
  root.id = 'tm-print-root'
  const style = doc.createElement('style')
  style.textContent = `#tm-print-root{display:none}
@media print{html.tm-printing,html.tm-printing body{height:auto!important;overflow:visible!important;background:#fff!important}
html.tm-printing body>*:not(#tm-print-root){display:none!important}
html.tm-printing #tm-print-root{display:block;font:11pt/1.45 Arial,sans-serif;color:#000}
#tm-print-root img.tm-print-page{display:block;width:100%;height:auto;page-break-after:always;break-after:page}
#tm-print-root img{max-width:100%}#tm-print-root table{border-collapse:collapse;width:100%}
#tm-print-root td,#tm-print-root th{border:1px solid #999;padding:3px 5px;vertical-align:top}
#tm-print-root pre{white-space:pre-wrap}}`
  root.append(style, node)
  doc.body.appendChild(root)
  doc.documentElement.classList.add('tm-printing')
  const done = () => {
    doc.documentElement.classList.remove('tm-printing')
    root.remove()
    win.removeEventListener('afterprint', done)
  }
  win.addEventListener('afterprint', done)
  win.print()
  // Some phones never say printing finished; the copy is invisible on screen anyway.
  setTimeout(done, 120000)
}

export default function DocViewer({ name, url, onClose, onShare, path = '', rev = '' }) {
  useBackLayer(true, onClose) // the phone's back button closes it (src/backButton.js)
  const kind = viewKind(name)
  const pages = useRef(null)
  const scroller = useRef(null)
  const stage = useRef(null)
  const frame = useRef(null)
  const pdf = useRef(null) // { doc, laid }
  const buffer = useRef(null)
  const [state, setState] = useState({ phase: 'loading' })
  const [progress, setProgress] = useState(null) // { got, total } while downloading
  const [blobUrl, setBlobUrl] = useState('')
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const [baseH, setBaseH] = useState(0) // the stage's height at zoom 1
  const [viewW, setViewW] = useState(0) // the viewer's width: the stage is laid out to it
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  useEffect(() => {
    let live = true
    let stop = () => {}
    const isLive = () => live
    ;(async () => {
      if (!kind) { setState({ phase: 'cannot' }); return }
      try {
        // A copy kept on this phone opens at once; otherwise it comes down once,
        // with progress, and is kept for next time (docCache.js).
        let buf = await cachedDoc(path, rev)
        if (!buf) {
          buf = await downloadWithProgress(url, (got, total) => { if (live) setProgress({ got, total }) })
          if (live) setProgress(null)
          keepDoc(path, rev, buf)
        }
        if (!live) return
        buffer.current = buf
        const href = URL.createObjectURL(new Blob([buf], { type: typeOfName(name) }))
        setBlobUrl(href)
        if (kind === 'image') { setState({ phase: 'image', src: href }); return }
        if (kind === 'text') { setState({ phase: 'text', body: new TextDecoder().decode(buf) }); return }
        if (kind === 'docx') {
          const body = await wordBody(buf)
          if (live) setState({ phase: 'word', body })
          return
        }
        setState({ phase: 'pdf' })
        // The container is drawn first, so the pages know how wide to be. A
        // phone can take longer than one tick to draw it — waiting a single
        // tick and giving up left "Opening the first page…" up for ever
        // (Brent, 21 Nov 2026).
        const area = await waitForElement(() => pages.current, isLive)
        if (!live) return
        if (!area) throw new Error('The viewer did not open')
        const opening = (async () => {
          const doc = await openPdf(buf)
          if (!live) return null
          const laid = await layoutPdf(doc, area, scroller.current, isLive)
          return { doc, laid }
        })()
        // A big scan can take a while: say so, and never wait for ever.
        const slow = setTimeout(() => { if (live) setState(st => (st.phase === 'pdf' && !st.done ? { ...st, slow: true } : st)) }, SLOW_MS)
        let opened
        try { opened = await withDeadline(opening, GIVE_UP_MS) } finally { clearTimeout(slow) }
        if (!live || !opened) return
        const { doc, laid } = opened
        pdf.current = { doc, laid }
        stop = laid.stop
        if (live) setState({ phase: 'pdf', done: true, total: laid.total, more: laid.total > MAX_PAGES ? laid.total - MAX_PAGES : 0 })
      } catch (err) {
        if (live) setState({ phase: 'failed', error: err.message })
      }
    })()
    return () => { live = false; stop() }
  }, [kind, url, path, rev, name])

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  // The stage's own height at zoom 1 (a transform does not change it) and the
  // viewer's width, so the scroll area is exactly the zoomed size.
  useEffect(() => {
    const el = stage.current
    const sc = scroller.current
    if (!el || !sc || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => { setBaseH(el.offsetHeight); setViewW(sc.clientWidth) })
    ro.observe(el)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [state.phase])

  // A Word document's frame takes its whole height, so only the viewer scrolls.
  const fitFrame = useCallback(() => {
    const f = frame.current
    const d = f?.contentDocument
    if (!d?.documentElement) return
    f.style.height = `${Math.ceil(d.documentElement.scrollHeight)}px`
  }, [])
  useEffect(() => {
    if (state.phase !== 'word') return undefined
    const t = [200, 800, 2000].map(ms => setTimeout(fitFrame, ms)) // images settle after load
    window.addEventListener('resize', fitFrame)
    return () => { t.forEach(clearTimeout); window.removeEventListener('resize', fitFrame) }
  }, [state.phase, fitFrame])

  // ── Zoom: about a point, so what is under the fingers stays there ──
  const zoomTo = useCallback((next, at) => {
    const sc = scroller.current
    const z0 = zoomRef.current
    const z = clampZoom(next)
    if (!sc || z === z0) return
    const ax = at ? at.x : sc.clientWidth / 2
    const ay = at ? at.y : sc.clientHeight / 3
    const cx = (sc.scrollLeft + ax) / z0
    const cy = (sc.scrollTop + ay) / z0
    zoomRef.current = z
    setZoom(z)
    requestAnimationFrame(() => {
      sc.scrollLeft = cx * z - ax
      sc.scrollTop = cy * z - ay
    })
  }, [])

  // Pages are drawn sharp again once a zoom settles.
  useEffect(() => {
    const t = setTimeout(() => pdf.current?.laid?.rescale(zoom), 250)
    return () => clearTimeout(t)
  }, [zoom])

  useEffect(() => {
    const sc = scroller.current
    if (!sc) return undefined
    let pinch = null
    let lastTap = 0
    const point = (t, box) => ({ x: t.clientX - box.left, y: t.clientY - box.top })
    const start = e => {
      if (e.touches.length === 2) {
        const box = sc.getBoundingClientRect()
        const [a, b] = [point(e.touches[0], box), point(e.touches[1], box)]
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoomRef.current }
      } else if (e.touches.length === 1) {
        const now = Date.now()
        if (now - lastTap < 300) {
          const box = sc.getBoundingClientRect()
          zoomTo(zoomRef.current > 1.05 ? 1 : 2, point(e.touches[0], box))
          lastTap = 0
          e.preventDefault()
        } else lastTap = now
      }
    }
    const move = e => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const box = sc.getBoundingClientRect()
      const [a, b] = [point(e.touches[0], box), point(e.touches[1], box)]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      zoomTo(pinch.z * (d / pinch.d), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    }
    const end = e => { if (e.touches.length < 2) pinch = null }
    const wheel = e => {
      if (!e.ctrlKey) return // trackpad pinch on a computer
      e.preventDefault()
      const box = sc.getBoundingClientRect()
      zoomTo(zoomRef.current * Math.exp(-e.deltaY / 200), { x: e.clientX - box.left, y: e.clientY - box.top })
    }
    const opts = { passive: false }
    sc.addEventListener('touchstart', start, opts)
    sc.addEventListener('touchmove', move, opts)
    sc.addEventListener('touchend', end)
    sc.addEventListener('wheel', wheel, opts)
    return () => {
      sc.removeEventListener('touchstart', start, opts)
      sc.removeEventListener('touchmove', move, opts)
      sc.removeEventListener('touchend', end)
      sc.removeEventListener('wheel', wheel, opts)
    }
  }, [zoomTo])

  // ── Page counter ──
  const onScroll = () => {
    const sheets = pdf.current?.laid?.sheets
    const sc = scroller.current
    if (!sheets?.length || !sc) return
    const z = zoomRef.current
    const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4
    setPage(atEnd ? sheets.length : pageAt(sheets.map(s => s.offsetTop * z), sc.scrollTop, sc.clientHeight))
  }

  // ── The buttons ──
  const say = msg => { setNote(msg); setTimeout(() => setNote(''), 3500) }

  async function share() {
    if (onShare) return onShare()
    const buf = buffer.current
    if (!buf) return say('Still opening — try again in a moment.')
    const file = new File([buf], name, { type: typeOfName(name) })
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name })
      else { download(); say('Sharing is not offered here — downloaded instead.') }
    } catch (err) {
      if (err?.name !== 'AbortError') say('Could not share — try Download.')
    }
  }

  function download() {
    const a = document.createElement('a')
    a.href = blobUrl || url
    a.download = name
    if (!blobUrl) { a.target = '_blank'; a.rel = 'noreferrer' }
    document.body.appendChild(a); a.click(); a.remove()
  }

  async function print() {
    if (busy) return
    try {
      const node = document.createElement('div')
      if (state.phase === 'pdf' && pdf.current?.doc) {
        setBusy('Preparing to print…')
        const pics = await pdfPictures(pdf.current.doc, (n, count) => setBusy(`Preparing page ${n} of ${count}…`))
        for (const src of pics) {
          const img = document.createElement('img')
          img.className = 'tm-print-page'
          img.src = src
          node.appendChild(img)
        }
      } else if (state.phase === 'word') {
        node.innerHTML = state.body // already cleaned (cleanWordHtml)
      } else if (state.phase === 'image') {
        const img = document.createElement('img')
        img.src = state.src
        node.appendChild(img)
      } else if (state.phase === 'text') {
        const pre = document.createElement('pre')
        pre.textContent = state.body
        node.appendChild(pre)
      } else {
        return say('Download it to print it.')
      }
      setBusy('')
      printAlone(node)
    } catch (err) {
      setBusy('')
      say(`Could not print: ${err.message}`)
    }
  }

  const ready = Boolean(blobUrl)
  const top = { ...text('bodyStrong'), color: 'white', background: 'rgba(255,255,255,0.14)', border: 'none', borderRadius: radius.pill, minWidth: 40, height: 40, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', flexShrink: 0 }
  const action = { ...text('micro'), textTransform: 'none', letterSpacing: 0, color: 'white', textDecoration: 'none', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1, minWidth: 0, padding: '6px 0' }
  const icon = d => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  const message = msg => <div style={{ ...text('body'), color: 'white', textAlign: 'center', padding: space.lg }}>{msg}</div>
  const zoomed = zoom > 1.01

  return (
    <Overlay>
      <div data-doc-viewer role="dialog" aria-label={name} style={{
        position: 'fixed', inset: 0, zIndex: 4100, background: '#1f2a36', display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)'
      }}>
        {/* Top: close, the name, zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: space.xs, padding: `${space.xs}px ${space.sm}px`, background: '#16202b' }}>
          <button type="button" onClick={onClose} aria-label="Close" style={top}>✕</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...text('bodyStrong'), color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            {state.phase === 'pdf' && state.total > 0 && (
              <div data-page-count style={{ ...text('caption'), color: 'rgba(255,255,255,0.65)' }}>Page {page} of {state.total}</div>
            )}
          </div>
          <button type="button" aria-label="Zoom out" onClick={() => zoomTo(zoom > 1.01 ? Math.max(1, zoom / 1.5) : 1)} disabled={!zoomed} style={{ ...top, opacity: zoomed ? 1 : 0.4 }}>−</button>
          <button type="button" aria-label="Zoom in" onClick={() => zoomTo(zoom * 1.5)} style={top}>+</button>
        </div>

        {/* The document: fits the width, scrolls down; pinch or double-tap to zoom */}
        <div ref={scroller} data-doc-scroll onScroll={onScroll} style={{
          flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', touchAction: 'pan-x pan-y'
        }}>
          {state.phase === 'loading' && (progress
            ? <div data-doc-progress style={{ maxWidth: 320, margin: `${space.xl}px auto`, color: 'white', textAlign: 'center' }}>
                <div style={{ ...text('body') }}>Downloading{progress.total ? ` ${(progress.got / 1048576).toFixed(1)} of ${(progress.total / 1048576).toFixed(1)} MB` : ` ${(progress.got / 1048576).toFixed(1)} MB`}</div>
                <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.18)', marginTop: space.sm, overflow: 'hidden' }}>
                  <div style={{ height: 6, width: `${progress.total ? Math.min(100, Math.round((progress.got / progress.total) * 100)) : 30}%`, background: colour.accent }} />
                </div>
                <div style={{ ...text('caption'), color: 'rgba(255,255,255,0.6)', marginTop: space.xs }}>Kept on this phone after the first time — next time it opens at once.</div>
              </div>
            : message('Opening…'))}
          {state.phase === 'cannot' && message('This kind of file cannot be shown in the portal — Download it to open it.')}
          {state.phase === 'failed' && message(`${state.error}. Tap Dropbox below to open it in the Dropbox app, or Download it.`)}

          {['image', 'text', 'word', 'pdf'].includes(state.phase) && (
            // The stage is laid out at the screen's width and scaled; the sizer
            // around it is the zoomed size, so the scroll area matches exactly.
            <div style={{ width: viewW ? viewW * zoom : '100%', height: baseH && zoomed ? baseH * zoom : 'auto', overflow: 'hidden' }}>
              <div ref={stage} data-doc-stage style={{
                width: viewW || '100%', padding: `${space.sm}px ${space.sm}px ${space.lg}px`,
                boxSizing: 'border-box', transform: zoomed ? `scale(${zoom})` : 'none', transformOrigin: '0 0'
              }}>
                {state.phase === 'image' && (
                  <img src={state.src} alt={name} style={{ display: 'block', maxWidth: '100%', margin: '0 auto', background: 'white', borderRadius: 3 }} />
                )}
                {state.phase === 'text' && (
                  <pre style={{ ...text('body'), whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'white', color: colour.ink, padding: space.md, borderRadius: 3, margin: '0 auto', maxWidth: 820 }}>{state.body}</pre>
                )}
                {state.phase === 'word' && (
                  // No scripts can run in it (no allow-scripts); same origin only
                  // so the viewer can read its height. It takes no touches: the
                  // viewer scrolls and zooms it like a page.
                  <iframe ref={frame} title={name} sandbox="allow-same-origin" srcDoc={wordPage(state.body)} onLoad={fitFrame}
                    style={{ width: '100%', maxWidth: 820, height: 600, border: 'none', background: 'white', borderRadius: 3, display: 'block', margin: '0 auto', pointerEvents: 'none', boxShadow: '0 1px 3px rgba(0,0,0,.35)' }} />
                )}
                {state.phase === 'pdf' && (
                  <>
                    <div ref={pages} data-pdf-pages style={{ maxWidth: 900, margin: '0 auto' }} />
                    {!state.done && message(state.slow
                      ? 'Still opening — this is a big scanned document. Tap Dropbox below to open it in the Dropbox app, or Download it.'
                      : 'Opening the first page…')}
                    {state.more > 0 && message(`${state.more} more pages — Download to see them all.`)}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {(busy || note) && (
          <div role="status" style={{ ...text('caption'), color: 'white', background: '#16202b', textAlign: 'center', padding: '6px 12px' }}>{busy || note}</div>
        )}

        {/* Bottom: one tap each */}
        <div data-doc-actions style={{
          display: 'flex', background: '#16202b', borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}>
          <button type="button" onClick={share} disabled={!ready && !onShare} style={{ ...action, opacity: ready || onShare ? 1 : 0.45 }}>
            {icon('M12 3v12 M7 8l5-5 5 5 M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6')}Share
          </button>
          <a href={blobUrl || url} download={name} onClick={e => { e.preventDefault(); download() }} style={action}>
            {icon('M12 4v11 M7 10l5 5 5-5 M5 20h14')}Download
          </a>
          <button type="button" onClick={print} disabled={!ready || Boolean(busy)} style={{ ...action, opacity: ready && !busy ? 1 : 0.45 }}>
            {icon('M7 9V3h10v6 M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2 M7 14h10v7H7z')}Print
          </button>
          {path && (
            <a href={dropboxAppLink(path)} target="_blank" rel="noreferrer" style={action}>
              {icon('M7 3l5 3.2L7 9.4 2 6.2z M17 3l5 3.2-5 3.2-5-3.2z M2 12.6l5-3.2 5 3.2-5 3.2z M22 12.6l-5-3.2-5 3.2 5 3.2z M7 17l5 3.2 5-3.2')}Dropbox
            </a>
          )}
        </div>
      </div>
    </Overlay>
  )
}
