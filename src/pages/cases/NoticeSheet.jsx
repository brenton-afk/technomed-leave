import React, { useEffect, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { subscribeNotices, clearNotices } from '../../notices.js'

// ─── "These people will be notified" ─────────────────────────────────────────
// Shown after a booking change that a supplier rule covers. Who it goes to and
// exactly what it says, then Send or Don't send. Nothing reaches a supplier
// from a booking change without this, unless an admin has set that rule to
// send on its own.

export default function NoticeSheet({ user }) {
  const [state, setState] = useState({ notices: [], sent: [], failed: [], error: '' })
  const [status, setStatus] = useState('ready')
  const [result, setResult] = useState(null)
  const [open, setOpen] = useState(null)
  // "I need to be able to see the email drafts going to the distributors and
  // decide whether to send them or not (and ideally be able to edit them)."
  // Each one is ticked to send by default; untick to leave it. Opening one
  // shows the subject and wording as boxes to change. Recipients are fixed.
  const [skip, setSkip] = useState(() => new Set())
  const [edits, setEdits] = useState({})

  useEffect(() => subscribeNotices(s => {
    setState(s); setResult(null); setStatus('ready'); setSkip(new Set()); setEdits({})
  }), [])

  const { notices, sent, failed, error } = state
  if (!notices.length && !sent.length && !failed.length && !error && !result) return null

  const chosen = notices.filter(n => !skip.has(n.id))

  async function sendAll() {
    setStatus('sending')
    try {
      const res = await fetch('/api/calendar/today?action=notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
        body: JSON.stringify({
          ids: chosen.map(n => n.id),
          edits: Object.fromEntries(chosen.filter(n => edits[n.id]).map(n => [n.id, edits[n.id]]))
        })
      })
      const data = await res.json()
      setResult([
        ...(data.results || []),
        ...notices.filter(n => skip.has(n.id)).map(n => ({ name: n.name, ok: null }))
      ])
    } catch {
      setResult(chosen.map(n => ({ name: n.name, ok: false, error: 'No connection — not sent' })))
    }
    setStatus('done')
  }

  const toggle = id => setSkip(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const field = { ...text('field'), width: '100%', boxSizing: 'border-box', padding: '8px 10px',
    border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink, fontFamily: 'inherit' }

  function close() { clearNotices(); setResult(null); setStatus('ready') }

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3100,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label="Supplier notices" className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 460,
          borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: space.md, borderBottom: `1px solid ${colour.line}` }}>
            <div style={{ ...text('heading'), color: colour.ink }}>
              {result ? 'Supplier emails' : 'Emails ready to send — check them first'}
            </div>
          </div>
          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {error && <div style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
            {sent.length > 0 && (
              <div style={{ ...text('caption'), color: colour.success, marginBottom: space.sm }}>
                Sent automatically: {sent.join(', ')}
              </div>
            )}
            {failed.map(f => (
              <div key={f.name} style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>
                {f.name}: not sent — {f.error}
              </div>
            ))}

            {!result && notices.length > 0 && (
              <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
                Untick any you do not want sent. Open one to read it and change the wording.
              </div>
            )}
            {!result && notices.map(n => {
              const on = !skip.has(n.id)
              const edit = edits[n.id] || {}
              return (
                <div key={n.id} style={{ background: colour.surface, border: `1px solid ${on ? colour.accent : colour.line}`,
                  borderRadius: radius.control, padding: space.sm, marginBottom: space.sm, opacity: on ? 1 : 0.6 }}>
                  <label style={{ display: 'flex', gap: space.sm, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(n.id)} aria-label={`Send to ${n.name}`}
                      style={{ width: 20, height: 20, marginTop: 2, fontSize: 16, accentColor: colour.accent }} />
                    <span style={{ flex: 1 }}>
                      <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>{n.name}</span>
                      <span style={{ ...text('caption'), color: colour.inkMuted, display: 'block' }}>
                        To {n.to.join(', ')} · cc {[...(n.cc || []), 'bookings@'].join(', ')}
                      </span>
                      <span style={{ ...text('caption'), color: colour.ink, display: 'block', marginTop: 4 }}>{edit.subject ?? n.subject}</span>
                    </span>
                  </label>
                  <button type="button" onClick={() => setOpen(open === n.id ? null : n.id)} style={{
                    background: 'none', border: 'none', padding: 0, marginTop: 6, cursor: 'pointer',
                    ...text('caption'), color: colour.accentDeep, fontWeight: 600
                  }}>{open === n.id ? 'Close the email' : 'Read or edit the email'}{edit.text != null || edit.subject != null ? ' · edited' : ''}</button>
                  {open === n.id && (
                    <div style={{ marginTop: space.xs }}>
                      <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: 2 }}>Subject</div>
                      <input value={edit.subject ?? n.subject} aria-label={`Subject of the email to ${n.name}`}
                        onChange={e => setEdits(x => ({ ...x, [n.id]: { ...x[n.id], subject: e.target.value } }))} style={field} />
                      <div style={{ ...text('caption'), color: colour.inkFaint, margin: '6px 0 2px' }}>Email</div>
                      <textarea value={edit.text ?? n.text} rows={12} aria-label={`The email to ${n.name}`}
                        onChange={e => setEdits(x => ({ ...x, [n.id]: { ...x[n.id], text: e.target.value } }))}
                        style={{ ...field, resize: 'vertical' }} />
                      <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 4 }}>
                        Your name, role and TechnoMed details are added underneath as the sign-off.
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {result && result.map((r, i) => (
              <div key={i} style={{ ...text('body'), color: r.ok ? colour.success : r.ok === null ? colour.inkMuted : colour.danger, marginBottom: 4 }}>
                {r.ok === null ? `Not sent to ${r.name} — you left it unticked` : r.ok ? `Sent to ${r.name}` : `${r.name || 'Notice'}: ${r.error || 'not sent'}`}
              </div>
            ))}
          </div>
          <div style={{ padding: `${space.sm}px ${space.md}px calc(${space.md}px + env(safe-area-inset-bottom, 0px))`,
            borderTop: `1px solid ${colour.line}`, display: 'flex', gap: space.sm }}>
            {!result && notices.length > 0 ? (
              <>
                <button onClick={close} style={{ flex: 1, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
                  background: 'transparent', color: colour.inkMuted, border: `1px solid ${colour.line}`, borderRadius: radius.control }}>
                  Don't send any
                </button>
                <button onClick={sendAll} disabled={status === 'sending' || !chosen.length} style={{ flex: 2, padding: space.sm, ...text('bodyStrong'),
                  color: 'white', border: 'none', borderRadius: radius.control, background: colour.accent, cursor: 'pointer',
                  opacity: chosen.length ? 1 : 0.5 }}>
                  {status === 'sending' ? 'Sending…'
                    : chosen.length === notices.length ? `Send ${notices.length === 1 ? 'it' : `all ${notices.length}`}`
                      : `Send ${chosen.length} of ${notices.length}`}
                </button>
              </>
            ) : (
              <button onClick={close} style={{ flex: 1, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
                color: 'white', border: 'none', borderRadius: radius.control, background: colour.accent }}>Done</button>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
