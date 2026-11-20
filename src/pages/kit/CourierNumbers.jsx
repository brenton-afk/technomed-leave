import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'
import { dialable } from '../../kit/couriers.js'

// ─── Courier numbers (Brent, 20 Nov 2026) ────────────────────────────────────
// The couriers offered after a tray move: names, numbers and a short note.
// Admins and the clinical team change it; it is shown on every phone, so no
// account passwords.

export default function CourierNumbers({ couriers, post, onClose, onSaved }) {
  useBackLayer(true, onClose)
  const [rows, setRows] = useState(() => couriers.map(c => ({ ...c })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (i, k, v) => setRows(r => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  async function save() {
    setBusy(true); setError('')
    try { await post('couriers', { couriers: rows }); await onSaved?.(); onClose() } catch (err) { setError(err.message); setBusy(false) }
  }

  const field = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', ...text('field'), border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }
  const btn = on => ({ ...text('bodyStrong'), padding: `${space.sm + 2}px ${space.md}px`, borderRadius: radius.control, cursor: 'pointer', ...(on ? face.primary : face.secondary) })

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label="Courier numbers" className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 520, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column', overflowX: 'hidden'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1, ...text('heading'), color: colour.ink }}>Courier numbers</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden' }}>
            <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
              Offered to call after a tray move. Every phone can see this list — no account passwords.
            </div>
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
            {rows.map((c, i) => (
              <div key={c.id || i} data-courier-row style={{ background: colour.surface, border: border.hairline, borderRadius: radius.control, padding: space.sm, marginBottom: space.sm, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: space.sm }}>
                  <input value={c.name} onChange={e => set(i, 'name', e.target.value)} aria-label={`Courier ${i + 1} name`} placeholder="Name" style={{ ...field, flex: 1, minWidth: 0 }} />
                  <button onClick={() => setRows(r => r.filter((_, j) => j !== i))} aria-label={`Remove ${c.name || 'courier'}`}
                    style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                </div>
                <input value={c.phone} onChange={e => set(i, 'phone', e.target.value)} aria-label={`${c.name || 'Courier'} phone`} placeholder="Phone" inputMode="tel"
                  style={{ ...field, borderColor: c.phone && !dialable(c.phone) ? colour.danger : undefined }} />
                <input value={c.note} onChange={e => set(i, 'note', e.target.value)} aria-label={`${c.name || 'Courier'} note`} placeholder="Note (e.g. around Hobart)" style={field} />
              </div>
            ))}
            <button onClick={() => setRows(r => [...r, { id: '', name: '', phone: '', note: '' }])} style={btn(false)}>+ Add a courier</button>
          </div>
          <div style={{ padding: space.md, borderTop: border.hairline, display: 'flex', gap: space.sm }}>
            <button disabled={busy} onClick={save} style={{ ...btn(true), flex: 2 }}>{busy ? 'Saving…' : 'Save'}</button>
            <button onClick={onClose} style={{ ...btn(false), flex: 1 }}>Cancel</button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
