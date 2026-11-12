import React, { useEffect, useRef, useState } from 'react'
import { Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { cachedDoc, keepDoc, downloadWithProgress, dropboxAppLink } from './docCache.js'

// ─── Read a kit's document in the portal (Brent, 11 Nov 2026) ───────────────
// "The kit room needs a viewer built in so you don't need to download the
// consignment agreement, you should be able to view it in the portal."
//
// - A PDF is drawn page by page with pdf.js (already used for tray lists): a
//   PDF in a frame shows an iPhone only its first page, and nothing else here
//   would be a viewer at all.
// - A Word document (.docx) is turned into formatted text by mammoth (also
//   already here) and shown in a sandboxed frame — no script can run in it.
// - A photo is shown as it is. Pages and photos can be pinched to zoom
//   (`data-zoomable`, see lockZoom.js).
// - Anything else (an old .doc, Excel) says so, with Download.
// Share and Download are in the bar, so viewing never costs a step.

export function viewKind(name = '') {
  const ext = String(name).toLowerCase().split('.').pop()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image'
  if (['txt', 'csv'].includes(ext)) return 'text'
  return ''
}

// Speed (Brent, 12 Nov 2026: "We can't be waiting 5 minutes … stuck on
// 'drawing pages'"): every page used to be drawn, in turn, at full phone
// sharpness before the screen said it was done. Now a blank sheet the size of
// each page is laid out at once, the first page is drawn straight away, and
// the rest are drawn only as they scroll near — a 120-page technique opens as
// fast as a 2-page one. Pages are drawn at no more than 1.5× (sharp enough
// to read, a third of the work of 2×).
const MAX_PAGES = 400
const SHARPNESS = 1.5

async function layoutPdf(buffer, into, scroller, isLive) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  if (!isLive()) return { total: doc.numPages, stop: () => {} }
  const width = Math.min(into.clientWidth || 360, 900)
  const ratio = Math.min(window.devicePixelRatio || 1, SHARPNESS)
  const first = await doc.getPage(1)
  const firstBase = first.getViewport({ scale: 1 })
  const count = Math.min(doc.numPages, MAX_PAGES)

  const sheets = []
  for (let n = 1; n <= count; n++) {
    const sheet = document.createElement('div')
    sheet.dataset.page = String(n)
    sheet.setAttribute('aria-label', `Page ${n}`)
    sheet.style.cssText = `width:${width}px;max-width:100%;aspect-ratio:${firstBase.width} / ${firstBase.height};margin:0 auto 10px;background:white;border-radius:4px;overflow:hidden`
    into.appendChild(sheet)
    sheets.push(sheet)
  }

  const drawn = new Set()
  const draw = async n => {
    if (drawn.has(n) || !isLive()) return
    drawn.add(n)
    const page = n === 1 ? first : await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: (width / base.width) * ratio })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.cssText = 'width:100%;height:auto;display:block'
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    if (!isLive()) return
    const sheet = sheets[n - 1]
    sheet.style.aspectRatio = `${base.width} / ${base.height}`
    sheet.replaceChildren(canvas)
  }

  await draw(1)
  if (count > 1) draw(2)
  let observer = null
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) draw(Number(e.target.dataset.page))
    }, { root: scroller || null, rootMargin: '1200px 0px' })
    sheets.forEach(s => observer.observe(s))
  } else {
    for (let n = 2; n <= count; n++) await draw(n)
  }
  return { total: doc.numPages, stop: () => observer?.disconnect() }
}

async function wordHtml(buffer) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.js')
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer })
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1d2b36;margin:16px;word-wrap:break-word}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd5dc;padding:4px 6px;vertical-align:top}
img{max-width:100%;height:auto}h1,h2,h3{line-height:1.25}</style>${value}`
}

export default function DocViewer({ name, url, onClose, onShare, path = '', rev = '' }) {
  const kind = viewKind(name)
  const pages = useRef(null)
  const scroller = useRef(null)
  const [state, setState] = useState({ phase: 'loading' })
  const [progress, setProgress] = useState(null) // { got, total } while downloading

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
        let buffer = await cachedDoc(path, rev)
        if (!buffer) {
          buffer = await downloadWithProgress(url, (got, total) => { if (live) setProgress({ got, total }) })
          if (live) setProgress(null)
          keepDoc(path, rev, buffer)
        }
        if (kind === 'image') {
          if (live) setState({ phase: 'image', src: URL.createObjectURL(new Blob([buffer])) })
          return
        }
        if (kind === 'text') {
          if (live) setState({ phase: 'text', body: new TextDecoder().decode(buffer) })
          return
        }
        if (kind === 'docx') {
          const html = await wordHtml(buffer)
          if (live) setState({ phase: 'word', html })
          return
        }
        if (live) setState({ phase: 'pdf' })
        // The container is drawn first, so the pages know how wide to be.
        await new Promise(r => setTimeout(r, 0))
        if (!pages.current) return
        const laid = await layoutPdf(buffer, pages.current, scroller.current, isLive)
        stop = laid.stop
        if (live) setState({ phase: 'pdf', done: true, more: laid.total > MAX_PAGES ? laid.total - MAX_PAGES : 0 })
      } catch (err) {
        if (live) setState({ phase: 'failed', error: err.message })
      }
    })()
    return () => { live = false; stop() }
  }, [kind, url, path, rev])

  useEffect(() => () => { if (state.src) URL.revokeObjectURL(state.src) }, [state.src])

  const bar = { ...text('bodyStrong'), color: 'white', textDecoration: 'none', padding: '8px 14px', borderRadius: radius.pill, background: 'rgba(255,255,255,0.16)', border: 'none', cursor: 'pointer' }
  const note = msg => <div style={{ ...text('body'), color: 'white', textAlign: 'center', padding: space.lg }}>{msg}</div>

  return (
    <Overlay>
      <div data-doc-viewer role="dialog" aria-label={name} style={{
        position: 'fixed', inset: 0, zIndex: 4100, background: colour.navyDeep || '#04101e', display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.xs, padding: space.sm }}>
          <span style={{ ...text('caption'), color: 'white', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {onShare && <button type="button" onClick={onShare} style={bar}>Share</button>}
          {path && <a href={dropboxAppLink(path)} target="_blank" rel="noreferrer" style={bar}>Open in Dropbox</a>}
          {url && <a href={url} download={name} style={bar}>Download</a>}
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...bar, padding: '8px 12px' }}>✕</button>
        </div>
        <div ref={scroller} data-zoomable style={{ flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch', padding: space.sm }}>
          {state.phase === 'loading' && (progress
            ? <div data-doc-progress style={{ maxWidth: 320, margin: `${space.xl}px auto`, color: 'white', textAlign: 'center' }}>
                <div style={{ ...text('body') }}>Downloading{progress.total ? ` ${(progress.got / 1048576).toFixed(1)} of ${(progress.total / 1048576).toFixed(1)} MB` : ` ${(progress.got / 1048576).toFixed(1)} MB`}</div>
                <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.18)', marginTop: space.sm, overflow: 'hidden' }}>
                  <div style={{ height: 6, width: `${progress.total ? Math.min(100, Math.round((progress.got / progress.total) * 100)) : 30}%`, background: colour.accent }} />
                </div>
                <div style={{ ...text('caption'), color: 'rgba(255,255,255,0.6)', marginTop: space.xs }}>Kept on this phone after the first time — next time it opens at once.</div>
              </div>
            : note('Opening…'))}
          {state.phase === 'cannot' && note('This kind of file cannot be shown in the portal — Download it to open it.')}
          {state.phase === 'failed' && note(`${state.error}. Download it instead.`)}
          {state.phase === 'image' && (
            <img src={state.src} alt={name} style={{ display: 'block', maxWidth: '100%', margin: '0 auto', background: 'white', borderRadius: 4 }} />
          )}
          {state.phase === 'text' && (
            <pre style={{ ...text('body'), whiteSpace: 'pre-wrap', background: 'white', color: colour.ink, padding: space.md, borderRadius: 4, margin: 0 }}>{state.body}</pre>
          )}
          {state.phase === 'word' && (
            // sandbox with nothing allowed: the document's text, never its code.
            <iframe title={name} sandbox="" srcDoc={state.html}
              style={{ width: '100%', height: '100%', minHeight: 400, border: 'none', background: 'white', borderRadius: 4, display: 'block' }} />
          )}
          {state.phase === 'pdf' && (
            <>
              <div ref={pages} data-pdf-pages style={{ maxWidth: 900, margin: '0 auto' }} />
              {!state.done && note('Opening the first page…')}
              {state.more > 0 && note(`${state.more} more pages — Download to see them all.`)}
            </>
          )}
        </div>
      </div>
    </Overlay>
  )
}
