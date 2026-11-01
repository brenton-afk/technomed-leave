import React, { useState, useEffect, useRef } from 'react'
import { colour, text, space, radius, border } from '../../design/tokens.js'

// ─── A saved tray, being kept up to date ─────────────────────────────────────
// "Need to be able to edit the implant and instrument qtys within the tray
// lists once they are entered into the portal… It needs to be a live
// ecosystem, not a static read only page."
//
// Every change saves as it is made — a quantity a moment after the last tap,
// text when the box is left, a line's removal straight away — so there is no
// Save button to forget on a phone in a corridor. Each change is sent with the
// line it was made against; if somebody else got there first the tray reloads
// and says so (api/_kits.js editTrayList).

function useDebounced(fn, ms) {
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (...args) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), ms)
  }
}

function Row({ line, index, onSet, onRemove, busy }) {
  const [draft, setDraft] = useState(line)
  const [qty, setQty] = useState(line.qty)
  useEffect(() => { setDraft(line); setQty(line.qty) }, [line])
  const sendQty = useDebounced(q => onSet(index, line, { ...line, qty: q }), 700)

  const input = {
    ...text('field'), width: '100%', boxSizing: 'border-box', padding: '6px 8px',
    border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink
  }
  const step = d => {
    const q = Math.max(0, Math.min(999, qty + d))
    setQty(q)
    sendQty(q)
  }
  const commitText = () => {
    if (draft.code === line.code && draft.description === line.description) return
    onSet(index, line, { ...line, code: draft.code, description: draft.description, qty })
  }
  const implant = line.kind === 'implant'
  const stepBtn = {
    width: 32, height: 32, borderRadius: radius.control, border: border.hairline, background: colour.surface,
    ...text('bodyStrong'), color: colour.ink, cursor: 'pointer', padding: 0
  }

  return (
    <div style={{ padding: `${space.sm}px 0`, borderBottom: border.hairlineSoft }}>
      <div style={{ display: 'flex', gap: space.sm, marginBottom: space.xs }}>
        <input value={draft.code} placeholder="Code" aria-label={`Code, line ${index + 1}`}
          onChange={e => setDraft(d => ({ ...d, code: e.target.value }))} onBlur={commitText}
          style={{ ...input, flex: '0 0 34%' }} />
        <input value={draft.description} placeholder="Description" aria-label={`Description, line ${index + 1}`}
          onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} onBlur={commitText}
          style={{ ...input, flex: 1, minWidth: 0 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
        <button onClick={() => onSet(index, line, { ...line, qty, kind: implant ? 'instrument' : 'implant' })} disabled={busy}
          aria-label={`${line.description || line.code} is ${implant ? 'an implant' : 'an instrument'} — change`}
          style={{
            ...text('caption'), fontWeight: 600, padding: '5px 10px', borderRadius: radius.pill, cursor: 'pointer',
            border: implant ? 'none' : border.hairline, background: implant ? colour.accentSoft : colour.surface,
            color: implant ? colour.accentDeep : colour.inkFaint
          }}>{implant ? 'Implant' : 'Instrument'}</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => step(-1)} aria-label={`One fewer ${line.description || line.code}`} style={stepBtn}>−</button>
        <span aria-label={`Quantity of ${line.description || line.code}`}
          style={{ ...text('heading'), minWidth: 36, textAlign: 'center', color: colour.ink }}>{qty}</span>
        <button onClick={() => step(1)} aria-label={`One more ${line.description || line.code}`} style={stepBtn}>+</button>
        <button onClick={() => { if (window.confirm(`Remove ${line.description || line.code} from this tray?`)) onRemove(index, line) }}
          aria-label={`Remove ${line.description || line.code}`} disabled={busy}
          style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer', marginLeft: space.xs }}>Remove</button>
      </div>
    </div>
  )
}

export default function EditableTray({ tray, onEdit, onDone }) {
  const [name, setName] = useState(tray.name)
  const [adding, setAdding] = useState({ code: '', description: '', qty: 1, kind: 'instrument' })
  const [busy, setBusy] = useState(false)
  useEffect(() => { setName(tray.name) }, [tray.name])

  async function run(body) {
    setBusy(true)
    try { await onEdit({ tray: tray.name, ...body }) } finally { setBusy(false) }
  }

  const input = {
    ...text('field'), boxSizing: 'border-box', padding: '6px 8px',
    border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink
  }

  return (
    <div style={{ padding: `0 ${space.sm}px ${space.sm}px` }}>
      <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.sm}px 0 ${space.xs}px` }}>Tray name</div>
      <input value={name} aria-label="Tray name" onChange={e => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name.trim() !== tray.name) run({ op: 'rename', name: name.trim() }) }}
        style={{ ...input, width: '100%' }} />

      <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.md}px 0 0` }}>
        Items · changes save as you go
      </div>
      {tray.lines.map((l, i) => (
        <Row key={`${i}-${l.code}-${l.description}`} line={l} index={i} busy={busy}
          onSet={(index, was, line) => run({ op: 'set', index, expect: { code: was.code, description: was.description }, line })}
          onRemove={(index, was) => run({ op: 'remove', index, expect: { code: was.code, description: was.description } })} />
      ))}

      <div style={{ marginTop: space.md, padding: space.sm, background: colour.canvas, borderRadius: radius.control }}>
        <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, marginBottom: space.xs }}>Add an item</div>
        <div style={{ display: 'flex', gap: space.sm, marginBottom: space.xs }}>
          <input value={adding.code} placeholder="Code" aria-label="New item code"
            onChange={e => setAdding(a => ({ ...a, code: e.target.value }))} style={{ ...input, flex: '0 0 34%' }} />
          <input value={adding.description} placeholder="Description" aria-label="New item description"
            onChange={e => setAdding(a => ({ ...a, description: e.target.value }))} style={{ ...input, flex: 1, minWidth: 0 }} />
        </div>
        <div style={{ display: 'flex', gap: space.sm, alignItems: 'center' }}>
          <select value={adding.kind} aria-label="New item type" onChange={e => setAdding(a => ({ ...a, kind: e.target.value }))} style={input}>
            <option value="instrument">Instrument</option>
            <option value="implant">Implant</option>
          </select>
          <input type="number" min="0" value={adding.qty} aria-label="New item quantity"
            onChange={e => setAdding(a => ({ ...a, qty: e.target.value }))} style={{ ...input, width: 70 }} />
          <button disabled={busy || !(adding.code.trim() || adding.description.trim())}
            onClick={async () => { await run({ op: 'add', line: adding }); setAdding({ code: '', description: '', qty: 1, kind: adding.kind }) }}
            style={{ ...text('bodyStrong'), flex: 1, padding: '8px 12px', borderRadius: radius.control, border: 'none',
              background: colour.accent, color: 'white', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>Add</button>
        </div>
      </div>

      <button onClick={onDone} style={{
        ...text('bodyStrong'), width: '100%', marginTop: space.md, padding: space.md, borderRadius: radius.control,
        border: border.hairline, background: colour.surface, color: colour.ink, cursor: 'pointer'
      }}>Done</button>
    </div>
  )
}
