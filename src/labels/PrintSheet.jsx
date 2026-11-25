// Print: one label or a queue of several, each with a quantity, into one PDF
// — one label per page at its own size (a label printer: the Epson for 68 ×
// 21) or laid out on A4 sheets (any printer) — then Print, Download or Open.

import React, { useEffect, useRef, useState } from 'react'
import { Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius, face, border } from '../design/tokens.js'
import { useBackLayer } from '../backButton.js'
import LabelSvg from './LabelSvg.jsx'
import { makeLabelPdf, printPdf, downloadPdf, openPdf, pdfName, sheetFor } from './print.js'
import { STOCKS, stocksFor, fitInSlot } from './sheetStocks.js'
import { shareReady } from '../kit/share.js'
import { hasOwnSize, sizeText, trimSize } from './model.js'

const remembered = (key, fallback) => { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v) } catch { return fallback } }
const remember = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* private window */ } }

/** A small picture of the sheet: every place, the ones this print fills in teal. */
function SheetPicture({ sheet, start, count }) {
  const { page, slots, slot } = sheet
  return (
    <svg data-sheet-picture viewBox={`0 0 ${page.w} ${page.h}`} style={{ width: 96, height: 'auto', background: '#ffffff', border: border.hairline, borderRadius: 3, flexShrink: 0 }} aria-hidden="true">
      {slots.map((p, i) => {
        const used = i >= start - 1 && i < start - 1 + count
        return <rect key={i} x={p.x} y={p.y} width={slot.w} height={slot.h} rx={1.5} fill={used ? '#189a85' : '#eef2f5'} stroke={used ? '#127a69' : '#c9d2da'} strokeWidth={0.6} />
      })}
    </svg>
  )
}

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
  // Which blank sheet: '' is the label's own Avery layout (or as many as fit on A4).
  const [stock, setStockState] = useState(() => remembered(`tm_label_stock:${jobs[0]?.label.id || 'new'}`, ''))
  const [fill, setFill] = useState(() => remembered('tm_label_fill', false))
  const [offset, setOffset] = useState(() => remembered('tm_label_offset', { x: 0, y: 0 }))
  const firstSheet = jobs[0] ? sheetFor(jobs[0].label, stock) : null
  const places = firstSheet?.slots.length || 1
  const sizes = [...new Set(jobs.map(j => sizeText(j.label)))]
  const design = jobs[0] ? trimSize(jobs[0].label) : null
  const fitted = firstSheet && design ? fitInSlot(design, firstSheet.slot, { fill }) : null
  const pick = v => { setPdf(null); setLayout(v) }
  const setStock = v => { setPdf(null); setStockState(v); setStart(1); remember(`tm_label_stock:${jobs[0]?.label.id || 'new'}`, v) }
  const touched = useRef(false)
  const fillSheet = () => { setPdf(null); onChange(jobs.map((j, k) => (k === 0 ? { ...j, qty: Math.max(1, places - start + 1) } : j))) }
  // One label on A4: fill the sheet from the start place, until a quantity is typed.
  useEffect(() => {
    if (layout === 'sheet' && jobs.length === 1 && !touched.current && jobs[0].qty !== places - start + 1) fillSheet()
  }, [layout, stock, start, places]) // eslint-disable-line react-hooks/exhaustive-deps
  const sheetsNeeded = layout === 'sheet' && jobs.length === 1 ? Math.ceil((start - 1 + total) / places) : 0

  const setQty = (i, qty) => { touched.current = true; setPdf(null); onChange(jobs.map((j, k) => (k === i ? { ...j, qty: Math.max(0, Math.min(999, Math.floor(Number(qty) || 0))) } : j))) }
  const remove = i => { setPdf(null); onChange(jobs.filter((_, k) => k !== i)) }

  async function make() {
    setError(''); setPdf(null)
    try {
      const blob = await makeLabelPdf(jobs, logos, { onProgress: setBusy, layout, start: layout === 'sheet' ? start : 1, stock, fill, offset })
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
          {layout === 'sheet' && firstSheet && (
            <div data-sheet-controls style={{ marginTop: space.md, display: 'grid', gap: space.sm }}>
              <label style={{ ...text('caption'), color: colour.inkMuted, display: 'grid', gap: 4 }}>
                Label sheet
                <select data-print-stock aria-label="Label sheet" value={stock} onChange={e => setStock(e.target.value)}
                  style={{ ...text('field'), padding: '8px 10px', border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }}>
                  <option value="">{jobs[0]?.label.sheet ? `Its own: ${jobs[0].label.sheet.name}` : `As many as fit on A4 (${sheetFor(jobs[0].label, '').slots.length})`}</option>
                  {(design ? stocksFor(design) : STOCKS).map(st => {
                    const ok = design && design.w <= st.label.w + 0.5 && design.h <= st.label.h + 0.5
                    return <option key={st.id} value={st.id}>{st.name}{ok ? '' : ' — design shrunk to fit'}</option>
                  })}
                </select>
              </label>
              <div style={{ display: 'flex', gap: space.md, alignItems: 'flex-start' }}>
                <SheetPicture sheet={firstSheet} start={start} count={jobs.length === 1 ? Math.min(total, places - start + 1) : Math.min(total, places)} />
                <div style={{ display: 'grid', gap: space.sm, ...text('caption'), color: colour.inkMuted, minWidth: 0 }}>
                  <div>{places} label{places === 1 ? '' : 's'} a sheet{firstSheet.slot ? ` · ${firstSheet.slot.w} × ${firstSheet.slot.h} mm` : ''}{fitted && fitted.scale !== 1 ? ` · design drawn at ${Math.round(fitted.scale * 100)}%` : ''}{sheetsNeeded > 1 ? ` · ${sheetsNeeded} sheets` : ''}</div>
                  {firstSheet.check && <div style={{ color: colour.warning }}>Layout not from Avery&rsquo;s template — print one on plain paper and hold it against a sheet first.</div>}
                  {places > 1 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                      Start at place
                      <input data-print-start aria-label="Start at place on the sheet" inputMode="numeric" value={start}
                        onChange={e => { setPdf(null); setStart(Math.max(1, Math.min(places, Math.floor(Number(e.target.value) || 1)))) }} style={fieldStyle} />
                      of {places}
                    </label>
                  )}
                  {jobs.length === 1 && <button data-print-fill onClick={() => { touched.current = false; fillSheet() }} style={{ ...btn, ...face.secondary, padding: '6px 12px', justifySelf: 'start' }}>Fill the sheet ({places - start + 1})</button>}
                  {design && firstSheet.slot && (design.w < firstSheet.slot.w - 0.5 || design.h < firstSheet.slot.h - 0.5) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="checkbox" checked={fill} onChange={e => { setPdf(null); setFill(e.target.checked); remember('tm_label_fill', e.target.checked) }} style={{ width: 18, height: 18, fontSize: 16 }} />
                      Enlarge the design to fill each label
                    </label>
                  )}
                  <details>
                    <summary style={{ cursor: 'pointer' }}>Line up with the sheet{offset.x || offset.y ? ` (moved ${offset.x} mm, ${offset.y} mm)` : ''}</summary>
                    <div style={{ display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                      {[['x', 'Right'], ['y', 'Down']].map(([k, l]) => (
                        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {l}
                          <input data-print-offset={k} aria-label={`Move ${l.toLowerCase()} mm`} inputMode="decimal" value={offset[k]}
                            onChange={e => { const v = Math.max(-10, Math.min(10, Number(e.target.value) || 0)); const o = { ...offset, [k]: v }; setPdf(null); setOffset(o); remember('tm_label_offset', o) }} style={fieldStyle} />
                          mm
                        </label>
                      ))}
                      <span>If a test print sits off the labels, move it here (− is left / up). Kept for next time.</span>
                    </div>
                  </details>
                </div>
              </div>
            </div>
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
