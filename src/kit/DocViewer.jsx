import React, { useEffect, useRef, useState } from 'react'
import { Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'

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

const MAX_PAGES = 60

async function drawPdf(buffer, into, isLive) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  const width = Math.min(into.clientWidth || 360, 900)
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
    if (!isLive()) return doc.numPages
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: (width / base.width) * ratio })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.cssText = `width:${width}px;max-width:100%;height:auto;display:block;margin:0 auto 10px;background:white;border-radius:4px`
    canvas.setAttribute('aria-label', `Page ${n}`)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    if (!isLive()) return doc.numPages
    into.appendChild(canvas)
  }
  return doc.numPages
}

async function wordHtml(buffer) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.js')
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer })
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1d2b36;margin:16px;word-wrap:break-word}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd5dc;padding:4px 6px;vertical-align:top}
img{max-width:100%;height:auto}h1,h2,h3{line-height:1.25}</style>${value}`
}

export default function DocViewer({ name, url, onClose, onShare }) {
  const kind = viewKind(name)
  const pages = useRef(null)
  const [state, setState] = useState({ phase: 'loading' })

  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  useEffect(() => {
    let live = true
    const isLive = () => live
    ;(async () => {
      if (!kind) { setState({ phase: 'cannot' }); return }
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error('The document could not be fetched')
        if (kind === 'image') {
          const blob = await res.blob()
          if (live) setState({ phase: 'image', src: URL.createObjectURL(blob) })
          return
        }
        if (kind === 'text') {
          const body = await res.text()
          if (live) setState({ phase: 'text', body })
          return
        }
        const buffer = await res.arrayBuffer()
        if (kind === 'docx') {
          const html = await wordHtml(buffer)
          if (live) setState({ phase: 'word', html })
          return
        }
        if (live) setState({ phase: 'pdf' })
        // The container is drawn first, so the pages know how wide to be.
        await new Promise(r => setTimeout(r, 0))
        if (!pages.current) return
        const total = await drawPdf(buffer, pages.current, isLive)
        if (live) setState({ phase: 'pdf', done: true, more: total > MAX_PAGES ? total - MAX_PAGES : 0 })
      } catch (err) {
        if (live) setState({ phase: 'failed', error: err.message })
      }
    })()
    return () => { live = false }
  }, [kind, url])

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
          <a href={url} download={name} style={bar}>Download</a>
          <button type="button" onClick={onClose} aria-label="Close" style={{ ...bar, padding: '8px 12px' }}>✕</button>
        </div>
        <div data-zoomable style={{ flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch', padding: space.sm }}>
          {state.phase === 'loading' && note('Opening…')}
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
              {!state.done && note('Drawing the pages…')}
              {state.more > 0 && note(`${state.more} more pages — Download to see them all.`)}
            </>
          )}
        </div>
      </div>
    </Overlay>
  )
}
