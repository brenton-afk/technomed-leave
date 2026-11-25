// Print: one label or a queue of several, each with a quantity, into one PDF
// — one label per page at its own size (a label printer: the Epson for 68 ×
// 21) or laid out on A4 sheets (any printer) — then Print, Download or Open.

import React, { useState } from 'react'
import { Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius, face, border } from '../design/tokens.js'
import { useBackLayer } from '../backButton.js'
import LabelSvg from './LabelSvg.jsx'
import { makeLabelPdf, printPdf, downloadPdf, openPdf, pdfName } from './print.js'
import { shareReady } from '../kit/share.js'
import { hasOwnSize, sizeText, sheetLayout } from './model.js'

const btn = { ...text('bodyStrong'), padding: `${space.sm + 2}px ${space.lg}px`, borderRadius: radius.control, cursor: 'pointer', font: 'inherit' }
const fieldStyle = { ...text('field'), width: 64, padding: '6px 8px', textAlign: 'center', border: border.hairline, borderRadius: radius.control }

export default function PrintSheet({ jobs, logos, onChange, onClose }) {
  useBackLayer(true, onClose)
  const [busy, setBusy] = useState('')
  const [pdf, setPdf] = useState(null)
  const [error, setError] = useState('')
  const [needsTap, setNeedsTap] = useState(false)
  const total = jobs.reduce((s, j) => s + (Number(j.qty) || 0), 0)
  // Sheet labels start on A4; implant labels on the label printer, as before.
  const [layout, setLayout] = useState(() => (jobs.some(j => hasOwnSize(j.label)) ? 'sheet' : 'label'))
  const [start, setStart] = useState(1)
  const firstSheet = jobs[0] ? sheetLayout(jobs[0].label) : null
  const places = firstSheet?.slots.length || 1
  const sizes = [...new Set(jobs.map(j => sizeText(j.label)))]
  const pick = v => { setPdf(null); setLayout(v) }

  const setQty = (i, qty) => { setPdf(null); onChange(jobs.map((j, k) => (k === i ? { ...j, qty: Math.max(0, Math.min(999, Math.floor(Number(qty) || 0))) } : j))) }
  const remove = i => { setPdf(null); onChange(jobs.filter((_, k) => k !== i)) }

  async function make() {
    setError(''); setPdf(null)
    try {
      const blob = await makeLabelPdf(jobs, logos, { onProgress: setBusy, layout, start: layout === 'sheet' ? start : 1 })
      setPdf(blob)
      return blob
    } catch (err) {
      setError(err.message || 'The PDF could not be made')
      return null
    } finally { setBusy('') }
  }
  async function print() {
    const blob = pdf || await make()
    if (!blob) return
    const out = await printPdf(blob, pdfName(jobs)).catch(err => { setError(err.message); return '' })
    setNeedsTap(out === 'needs-tap')
  }
  async function download() {
    const blob = pdf || await make()
    if (blob) downloadPdf(blob, pdfName(jobs))
  }
  async function open() {
    const blob = pdf || await make()
    if (blob) openPdf(blob)
  }

  return (
    <Overlay>
      <div data-label-print-sheet role="dialog" aria-label="Print labels"
        style={{ position: 'fixed', inset: 0, zIndex: 3400, background: 'rgba(15,30,43,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="tm-sheet" style={{ background: colour.surface, width: '100%', maxWidth: 640, maxHeight: '92dvh', overflowY: 'auto', overflowX: 'hidden', borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, padding: space.lg, boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.md }}>
            <div style={{ ...text('title'), color: colour.ink, flex: 1 }}>Print {jobs.length === 1 ? 'label' : `${jobs.length} labels`}</div>
            <button onClick={onClose} aria-label="Close" style={{ ...btn, ...face.secondary, padding: '6px 12px' }}>✕</button>
          </div>
          {!jobs.length && <div style={{ ...text('body'), color: colour.inkFaint }}>The print queue is empty — tick labels in the library to add them.</div>}
          {jobs.map((j, i) => (
            <div key={`${j.label.id || 'new'}-${i}`} data-print-job style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: space.md, alignItems: 'center', padding: `${space.sm}px 0`, borderBottom: border.hairlineSoft }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ border: border.hairline, borderRadius: 4, overflow: 'hidden', maxWidth: 300 }}><LabelSvg label={j.label} logos={logos} /></div>
                <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.label.name}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button aria-label="One fewer" onClick={() => setQty(i, j.qty - 1)} style={{ ...btn, ...face.secondary, padding: '6px 12px' }}>−</button>
                <input aria-label={`How many of ${j.label.name}`} data-print-qty inputMode="numeric" value={j.qty} onChange={e => setQty(i, e.target.value)} style={fieldStyle} />
                <button aria-label="One more" onClick={() => setQty(i, j.qty + 1)} style={{ ...btn, ...face.secondary, padding: '6px 12px' }}>+</button>
                {jobs.length > 1 && <button aria-label="Take off the queue" onClick={() => remove(i)} style={{ ...btn, background: 'transparent', border: 'none', color: colour.inkFaint, padding: '6px 8px' }}>✕</button>}
              </div>
            </div>
          ))}
          <div data-print-layout role="radiogroup" aria-label="How to print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: space.sm, marginTop: space.md }}>
            {[['label', 'Label printer', `One label per page, ${sizes.length === 1 ? sizes[0] : 'each at its own size'}`],
              ['sheet', 'A4 sheet', firstSheet ? `${firstSheet.name} — any office printer` : 'Any office printer']].map(([v, title, sub]) => (
              <button key={v} role="radio" aria-checked={layout === v} data-print-layout-pick={v} onClick={() => pick(v)}
                style={{ ...btn, textAlign: 'left', padding: `${space.sm}px ${space.md}px`, ...(layout === v ? face.navy : face.secondary) }}>
                <div>{title}</div>
                <div style={{ ...text('caption'), fontWeight: 400, opacity: 0.85 }}>{sub}</div>
              </button>
            ))}
          </div>
          {layout === 'sheet' && places > 1 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginTop: space.sm, ...text('caption'), color: colour.inkMuted }}>
              Start at place
              <input data-print-start aria-label="Start at place on the sheet" inputMode="numeric" value={start}
                onChange={e => { setPdf(null); setStart(Math.max(1, Math.min(places, Math.floor(Number(e.target.value) || 1)))) }} style={fieldStyle} />
              of {places} (1 is top left, across then down) — to use up a part-used sheet.
            </label>
          )}
          <div style={{ ...text('caption'), color: colour.inkFaint, margin: `${space.md}px 0` }}>
            {total} label{total === 1 ? '' : 's'}{layout === 'label'
              ? <> · one per page. Load the printer with {sizes.length === 1 ? sizes[0] : 'the matching'} labels (the Epson CW-C4010A for 68 × 21 mm), and print at <strong>100% / Actual size</strong> — never “Fit to page”.</>
              : <> · on A4 label sheets. In the print dialog choose your printer, A4, and <strong>100% / Actual size</strong> — never “Fit to page”. Print one on plain paper first and hold it against a sheet to check it lines up.</>}
          </div>
          {busy && <div role="status" style={{ ...text('caption'), color: colour.accentDeep, marginBottom: space.sm }}>{busy}</div>}
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
          {needsTap && (
            <button data-print-ready onClick={async () => { setNeedsTap(false); await shareReady() }} style={{ ...btn, ...face.primary, width: '100%', marginBottom: space.sm }}>PDF ready — tap to print or share</button>
          )}
          <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
            <button data-print-go disabled={!total || Boolean(busy)} onClick={print} style={{ ...btn, ...face.primary, flex: '2 1 160px', opacity: !total || busy ? 0.5 : 1 }}>Print {total || ''}</button>
            <button data-print-download disabled={!total || Boolean(busy)} onClick={download} style={{ ...btn, ...face.secondary, flex: '1 1 120px' }}>Download PDF</button>
            <button disabled={!total || Boolean(busy)} onClick={open} style={{ ...btn, ...face.secondary, flex: '1 1 120px' }}>Open PDF</button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
