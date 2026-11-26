// ─── "Patient label covered" on the scan review (Brent, 26 Nov 2026) ──────────
// Every page as it will be filed and sent — the label painted out, the kept
// details printed in its place — with the details themselves to correct, and
// a page to tap to move, grow or add a covering. A page where the reader found
// no label has to be looked at and ticked before the scan can be filed.
// Rules: src/scanner/redactRules.js; painting: src/scanner/redact.js.

import React, { useRef, useState } from 'react'
import { useBackLayer } from '../../backButton.js'
import { stampLines, pagesToCheck, stampBoxIndex } from '../../scanner/redactRules.js'
import { Overlay } from '../../design/Shell.jsx'
import { colour } from '../../design/tokens.js'

const NAVY = colour.navy
const TEAL = colour.accent
const MUTED = '#5b6b78'
const BORDER = '#d9e0e6'
const AMBER = '#9a5b00'

const field = { width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 9, fontSize: 16, fontFamily: 'inherit', color: NAVY }

export default function RedactPanel({ pages, originals, redaction, label, surgeon, onLabel, onBoxes, checked, onChecked, busy }) {
  const [editing, setEditing] = useState(null)
  if (!redaction) return null
  const unsure = pagesToCheck(redaction)
  const dtbv = redaction.pages.some(p => p.dtbv)
  const set = (k, v) => onLabel({ ...label, [k]: v })
  return (
    <div data-redact-panel style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Patient label covered</div>
      <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, marginBottom: 10 }}>
        Only these covered pages are filed and sent. Tap a page to move or add a covering. The photo with the label showing stays on this phone and is wiped when you finish.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8, marginBottom: 12 }}>
        {pages.map((p, i) => (
          <button key={p.id || i} type="button" data-redact-page={i} disabled={busy || !originals?.[i]}
            onClick={() => setEditing(i)}
            style={{ padding: 0, border: `2px solid ${unsure.includes(i) ? AMBER : BORDER}`, borderRadius: 8, background: 'white', cursor: originals?.[i] ? 'pointer' : 'default', overflow: 'hidden', textAlign: 'left' }}>
            {p.preview
              ? <img src={p.preview} alt={`Page ${i + 1} as it will be sent`} style={{ display: 'block', width: '100%', height: 120, objectFit: 'cover', objectPosition: 'top' }} />
              : <div style={{ height: 120 }} />}
            <div style={{ fontSize: 11.5, padding: '4px 6px', color: unsure.includes(i) ? AMBER : NAVY, fontWeight: 600 }}>
              Page {i + 1}{redaction.pages[i]?.dtbv ? ' · DTBV' : ''}{unsure.includes(i) ? ' · no label found' : ''}
            </div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, marginBottom: 6 }}>Printed in place of the label</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        <label style={{ fontSize: 12, color: MUTED }}>First name<input data-redact-first value={label.firstName || ''} onChange={e => set('firstName', e.target.value)} style={field} /></label>
        <label style={{ fontSize: 12, color: MUTED }}>Surname<input data-redact-surname value={label.surname || ''} onChange={e => set('surname', e.target.value)} style={field} /></label>
        <label style={{ fontSize: 12, color: MUTED }}>UR<input data-redact-ur value={label.ur || ''} onChange={e => set('ur', e.target.value)} style={field} /></label>
        {dtbv && <label style={{ fontSize: 12, color: MUTED }}>Date of birth<input data-redact-dob value={label.dob || ''} placeholder="YYYY-MM-DD" onChange={e => set('dob', e.target.value)} style={field} /></label>}
        {dtbv && <label style={{ fontSize: 12, color: MUTED }}>Sex<input data-redact-sex value={label.sex || ''} onChange={e => set('sex', e.target.value)} style={field} /></label>}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>
        Surgeon comes from the surgeon above.{dtbv ? ' Date of birth and sex are printed on the DTBV form only.' : ''}
      </div>
      {unsure.length > 0 && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: NAVY, marginTop: 12, lineHeight: 1.45 }}>
          <input type="checkbox" data-redact-checked checked={Boolean(checked)} onChange={e => onChecked(e.target.checked)}
            style={{ width: 18, height: 18, fontSize: 16, flex: 'none', marginTop: 1 }} />
          No label was found on page {unsure.map(i => i + 1).join(', ')}. I've looked — no patient details are showing (or I've covered them).
        </label>
      )}
      {editing != null && originals?.[editing] && (
        <BoxEditor
          original={originals[editing]}
          page={redaction.pages[editing]}
          lines={stampLines(label, surgeon, { dtbv: redaction.pages[editing]?.dtbv })}
          index={editing}
          onDone={boxes => { onBoxes(editing, boxes); setEditing(null) }}
          onCancel={() => setEditing(null)} />
      )}
    </div>
  )
}

// ─── Moving, growing and adding a covering ───────────────────────────────────

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function BoxEditor({ original, page, lines, index, onDone, onCancel }) {
  const [boxes, setBoxes] = useState(() => (page?.boxes || []).map(b => ({ ...b })))
  const [picked, setPicked] = useState(boxes.length ? 0 : -1)
  const frame = useRef(null)
  const drag = useRef(null)
  useBackLayer(true, onCancel)

  const src = original.preview || `data:${original.mediaType || 'image/jpeg'};base64,${original.data}`

  function start(e, i, mode) {
    e.preventDefault(); e.stopPropagation()
    setPicked(i)
    const rect = frame.current.getBoundingClientRect()
    drag.current = { i, mode, x: e.clientX, y: e.clientY, w: rect.width, h: rect.height, box: { ...boxes[i] } }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function move(e) {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / d.w
    const dy = (e.clientY - d.y) / d.h
    setBoxes(list => list.map((b, i) => {
      if (i !== d.i) return b
      if (d.mode === 'move') {
        return { ...b, x: clamp(d.box.x + dx, 0, 1 - d.box.w), y: clamp(d.box.y + dy, 0, 1 - d.box.h) }
      }
      return { ...b, w: clamp(d.box.w + dx, 0.04, 1 - d.box.x), h: clamp(d.box.h + dy, 0.02, 1 - d.box.y) }
    }))
  }
  const end = () => { drag.current = null }
  const add = () => {
    setBoxes(list => [...list, { x: 0.35, y: 0.06, w: 0.3, h: 0.12 }])
    setPicked(boxes.length)
  }
  const remove = () => {
    if (picked < 0) return
    setBoxes(list => list.filter((_, i) => i !== picked))
    setPicked(-1)
  }

  return (
    <Overlay>
    <div data-redact-editor role="dialog" aria-label={`Covering on page ${index + 1}`}
      style={{ position: 'fixed', inset: 0, zIndex: 3400, background: '#0b1722', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', paddingTop: 'max(10px, env(safe-area-inset-top))', background: NAVY, color: 'white', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', fontSize: 14, fontWeight: 700 }}>Page {index + 1} — cover every patient detail</div>
        <button type="button" data-redact-add onClick={add} style={tool}>+ Cover another area</button>
        <button type="button" data-redact-remove onClick={remove} disabled={picked < 0} style={{ ...tool, opacity: picked < 0 ? 0.5 : 1 }}>Remove</button>
        <button type="button" onClick={onCancel} style={tool}>Cancel</button>
        <button type="button" data-redact-done onClick={() => onDone(boxes)} style={{ ...tool, background: TEAL, borderColor: TEAL }}>Done</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', justifyContent: 'center' }}>
        <div ref={frame} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          onPointerDown={() => setPicked(-1)}
          style={{ position: 'relative', width: 'min(100%, 720px)', alignSelf: 'flex-start', touchAction: 'none' }}>
          <img src={src} alt={`Page ${index + 1}`} draggable={false} style={{ display: 'block', width: '100%', userSelect: 'none' }} />
          {boxes.map((b, i) => (
            <div key={i} data-redact-box={i} onPointerDown={e => start(e, i, 'move')}
              style={{
                position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
                background: 'white', border: `2px solid ${i === picked ? TEAL : NAVY}`, boxSizing: 'border-box',
                cursor: 'move', overflow: 'hidden', fontSize: 10, lineHeight: 1.25, color: NAVY, padding: 3
              }}>
              {i === stampBoxIndex(boxes) && lines.map(l => <div key={l} style={{ whiteSpace: 'nowrap' }}>{l}</div>)}
              <div onPointerDown={e => start(e, i, 'size')} aria-label="Resize"
                style={{ position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, background: i === picked ? TEAL : NAVY, borderTopLeftRadius: 8, cursor: 'nwse-resize' }} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '8px 12px', paddingBottom: 'max(8px, env(safe-area-inset-bottom))', fontSize: 12, color: '#c9d4de', background: NAVY }}>
        Drag a white box to move it, drag its corner to resize. The details are printed in the biggest box.
      </div>
    </div>
    </Overlay>
  )
}

const tool = { fontSize: 13, fontWeight: 600, padding: '8px 12px', minHeight: 40, borderRadius: 9, border: '1px solid rgba(255,255,255,0.35)', background: 'transparent', color: 'white', cursor: 'pointer', fontFamily: 'inherit' }
