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

  useEffect(() => subscribeNotices(s => { setState(s); setResult(null); setStatus('ready') }), [])

  const { notices, sent, failed, error } = state
  if (!notices.length && !sent.length && !failed.length && !error && !result) return null

  async function sendAll() {
    setStatus('sending')
    try {
      const res = await fetch('/api/calendar/today?action=notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
        body: JSON.stringify({ ids: notices.map(n => n.id) })
      })
      const data = await res.json()
      setResult(data.results || [])
    } catch {
      setResult(notices.map(n => ({ name: n.name, ok: false, error: 'No connection — not sent' })))
    }
    setStatus('done')
  }

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
              {result ? 'Supplier notices' : 'These people will be notified'}
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

            {!result && notices.map(n => (
              <div key={n.id} style={{ background: colour.surface, border: `1px solid ${colour.line}`,
                borderRadius: radius.control, padding: space.sm, marginBottom: space.sm }}>
                <div style={{ ...text('bodyStrong'), color: colour.ink }}>{n.name}</div>
                <div style={{ ...text('caption'), color: colour.inkMuted }}>
                  To {n.to.join(', ')}{n.cc?.length ? ` · cc ${n.cc.join(', ')}` : ''}
                </div>
                <div style={{ ...text('caption'), color: colour.ink, marginTop: 4 }}>{n.subject}</div>
                <button type="button" onClick={() => setOpen(open === n.id ? null : n.id)} style={{
                  background: 'none', border: 'none', padding: 0, marginTop: 4, cursor: 'pointer',
                  ...text('caption'), color: colour.accentDeep, textDecoration: 'underline'
                }}>{open === n.id ? 'Hide the email' : 'Show the email'}</button>
                {open === n.id && (
                  <pre style={{ ...text('caption'), whiteSpace: 'pre-wrap', color: colour.ink, margin: `${space.xs}px 0 0`,
                    fontFamily: 'inherit' }}>{n.text}</pre>
                )}
              </div>
            ))}

            {result && result.map((r, i) => (
              <div key={i} style={{ ...text('body'), color: r.ok ? colour.success : colour.danger, marginBottom: 4 }}>
                {r.ok ? `Sent to ${r.name}` : `${r.name || 'Notice'}: ${r.error || 'not sent'}`}
              </div>
            ))}
          </div>
          <div style={{ padding: `${space.sm}px ${space.md}px calc(${space.md}px + env(safe-area-inset-bottom, 0px))`,
            borderTop: `1px solid ${colour.line}`, display: 'flex', gap: space.sm }}>
            {!result && notices.length > 0 ? (
              <>
                <button onClick={close} style={{ flex: 1, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
                  background: 'transparent', color: colour.inkMuted, border: `1px solid ${colour.line}`, borderRadius: radius.control }}>
                  Don't send
                </button>
                <button onClick={sendAll} disabled={status === 'sending'} style={{ flex: 2, padding: space.sm, ...text('bodyStrong'),
                  color: 'white', border: 'none', borderRadius: radius.control, background: colour.accent, cursor: 'pointer' }}>
                  {status === 'sending' ? 'Sending…' : `Send ${notices.length === 1 ? '' : `all ${notices.length}`}`.trim()}
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
