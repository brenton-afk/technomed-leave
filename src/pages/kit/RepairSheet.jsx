import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'

// ─── Send an instrument for repair (Brent, 20 Nov 2026) ─────────────────────
// "When we take an instrument off the kit for repair, it automatically emails
// the respective departments to let them know." Two steps, like a kit move:
// say what is wrong and where the kit is, see the email exactly as it will go
// (recipients come from the server, never typed here), then send — which
// also marks the instrument away in its tray. See api/_kitRepairs.js.

const HOSPITALS = [['RHH', 'RHH'], ['CLV', 'Calvary']]

export default function RepairSheet({ kit, job, headers, onClose, onDone }) {
  useBackLayer(true, onClose) // the phone's back button closes it (src/backButton.js)
  const [hospital, setHospital] = useState(job.at === 'RHH' || job.at === 'CLV' ? job.at : '')
  const [fault, setFault] = useState('')
  const [email, setEmail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const item = job.line.description || job.line.code || 'Instrument'

  async function call(preview) {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/guides?kits=repair', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kitId: kit.id, tray: job.tray, index: job.index, hospital, fault, preview,
          expect: { code: job.line.code, description: job.line.description }
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'Could not send — try again')
      if (preview) setEmail(data.email)
      else onDone(data.list)
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.md}px 0 ${space.xs}px` }
  const pill = on => ({ ...text('bodyStrong'), flex: 1, minHeight: 44, borderRadius: radius.control, cursor: 'pointer',
    border: on ? 'none' : border.hairline, background: on ? colour.navy : colour.surface, color: on ? 'white' : colour.ink })
  const primary = off => ({ ...text('bodyStrong'), width: '100%', padding: space.md, borderRadius: radius.control, border: 'none',
    background: colour.accent, color: 'white', cursor: off ? 'default' : 'pointer', opacity: off ? 0.5 : 1 })

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label={`Send ${item} for repair`} className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 520, maxHeight: '90%', overflowY: 'auto', overflowX: 'hidden',
          borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, padding: space.md, boxSizing: 'border-box'
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...text('heading'), color: colour.ink }}>{email ? 'Check before it goes' : 'Send for repair'}</div>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>{item}{job.line.code && job.line.description ? ` · ${job.line.code}` : ''} · {job.tray} · {kit.name}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>Cancel</button>
          </div>

          {!email && (
            <>
              <div style={label}>Which hospital is the kit at?</div>
              <div style={{ display: 'flex', gap: space.sm }}>
                {HOSPITALS.map(([k, n]) => <button key={k} type="button" onClick={() => setHospital(k)} style={pill(hospital === k)}>{n}</button>)}
              </div>
              <div style={label}>What is wrong with it?</div>
              <textarea value={fault} onChange={e => setFault(e.target.value)} rows={3} maxLength={400} aria-label="What is wrong with it"
                placeholder="e.g. tip bent, ratchet slipping, won't lock"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', ...text('field'), border: border.hairline,
                  borderRadius: radius.control, background: colour.surface, color: colour.ink, resize: 'vertical' }} />
              {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}
              <div style={{ height: space.md }} />
              <button disabled={busy || !hospital || !fault.trim()} onClick={() => call(true)} style={primary(busy || !hospital || !fault.trim())}>
                {busy ? 'Drafting…' : 'Check the email'}
              </button>
            </>
          )}

          {email && (
            <>
              <div style={label}>To</div>
              <div style={{ ...text('caption'), color: colour.ink, overflowWrap: 'anywhere' }}>{email.to.join(', ')}</div>
              <div style={label}>Copied</div>
              <div style={{ ...text('caption'), color: colour.inkMuted, overflowWrap: 'anywhere' }}>{email.cc.join(', ')}</div>
              <div style={label}>Subject</div>
              <div style={{ ...text('bodyStrong'), color: colour.ink }}>{email.subject}</div>
              <div style={{ ...text('body'), color: colour.ink, whiteSpace: 'pre-wrap', background: colour.surface, border: border.hairline,
                borderRadius: radius.control, padding: space.sm, marginTop: space.sm }} data-repair-email>{email.text}</div>
              {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}
              <div style={{ height: space.md }} />
              <button disabled={busy} onClick={() => call(false)} style={primary(busy)}>{busy ? 'Sending…' : 'Send and mark it away for repair'}</button>
              <button onClick={() => setEmail(null)} style={{ ...text('caption'), marginTop: space.sm, background: 'none', border: 'none', color: colour.inkFaint, cursor: 'pointer', textDecoration: 'underline' }}>
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </Overlay>
  )
}
