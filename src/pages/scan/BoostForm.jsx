import React, { useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'

// ─── The Boost tracking form, scanned on its own (Brent, 9 Nov 2026) ─────────
// "We will scan the boost form separately … That form can then go to Boost
// email. And the standard usage goes to device just for boost resupply." The
// usage has already gone to Device's spine/ortho desk; this sends only the
// tracking form, to boost@device.com.au, copied to admin@, marked tracking
// only — and files it in the case's Dropbox folder. `toPage` is UsageScan's
// own page maker, so the photos are sized exactly like a usage scan's.

export default function BoostForm({ usageId, user, toPage, sentAt, onClose, onSent }) {
  const [pages, setPages] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)

  async function add(files) {
    setError('')
    try {
      const made = await Promise.all([...files].map(f => toPage(f)))
      setPages(list => [...list, ...made].slice(0, 8))
    } catch (err) { setError(err.message || 'That photo could not be read') }
  }

  async function send({ testOnly = false, again = false } = {}) {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/usage/agent?action=boost-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token || ''}` },
        body: JSON.stringify({
          usageId, testOnly, confirmRepeat: again,
          pages: pages.map(p => ({ mediaType: p.mediaType, data: p.full || p.data }))
        })
      })
      const data = await res.json().catch(() => ({ error: `The server answered ${res.status}` }))
      if (!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'That did not send'), { held: data.held })
      setDone(data)
      if (!testOnly) onSent?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const button = primary => ({
    flex: 1, minHeight: 44, cursor: busy ? 'default' : 'pointer', borderRadius: radius.control, ...text('bodyStrong'),
    border: primary ? 'none' : `1px solid ${colour.line}`, background: primary ? colour.accent : colour.surface,
    color: primary ? 'white' : colour.ink, opacity: busy ? 0.6 : 1, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center'
  })
  const picker = (label, capture) => (
    <label style={button(false)}>
      {label}
      <input type="file" accept="image/*,application/pdf" multiple {...(capture ? { capture: 'environment' } : {})}
        style={{ display: 'none', fontSize: 16 }} onChange={e => { add(e.target.files || []); e.target.value = '' }} />
    </label>
  )

  return (
    <div data-boost-form style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md, marginBottom: space.md }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: space.xs }}>
        <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Boost tracking form</span>
        {onClose && <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', ...text('body'), color: colour.inkFaint, minHeight: 44 }}>Close</button>}
      </div>
      <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
        Scan the Boost form on its own. It goes to boost@device.com.au only (admin@ copied), marked tracking only — the usage has gone to Device for resupply.
        {sentAt && !done && <div style={{ color: colour.warning, marginTop: 4 }}>Already sent to the Boost team for this case — scan it again only if it was missed.</div>}
      </div>

      {done ? (
        <div style={{ ...text('caption'), color: colour.accentDeep }}>
          ✓ {done.test ? 'Test sent to you' : 'Sent to the Boost team, tracking only'}{done.filed ? ' · filed in Dropbox' : ''}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: space.sm, marginBottom: space.sm }}>
            {picker('Take photos', true)}
            {picker('Choose a file', false)}
          </div>
          {pages.length > 0 && (
            <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginBottom: space.sm }}>
              {pages.map((p, i) => (
                <div key={p.id} style={{ position: 'relative' }}>
                  {p.preview
                    ? <img src={p.preview} alt={`Page ${i + 1}`} style={{ width: 56, height: 72, objectFit: 'cover', borderRadius: radius.control, border: `1px solid ${colour.line}` }} />
                    : <div style={{ width: 56, height: 72, borderRadius: radius.control, border: `1px solid ${colour.line}`, ...text('micro'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>PDF</div>}
                  <button type="button" aria-label={`Remove page ${i + 1}`} onClick={() => setPages(list => list.filter(x => x !== p))}
                    style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: 'none', background: colour.ink, color: 'white', cursor: 'pointer', ...text('micro') }}>×</button>
                </div>
              ))}
            </div>
          )}
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
          <div style={{ display: 'flex', gap: space.sm }}>
            <button type="button" disabled={busy || !pages.length} onClick={() => send({ again: Boolean(sentAt) })} data-send-boost
              style={{ ...button(true), opacity: busy || !pages.length ? 0.5 : 1 }}>
              {busy ? 'Sending…' : sentAt ? 'Send again' : 'Send to Boost'}
            </button>
            <button type="button" disabled={busy || !pages.length} onClick={() => send({ testOnly: true })} style={{ ...button(false), opacity: busy || !pages.length ? 0.5 : 1 }}>Test to me</button>
          </div>
        </>
      )}
    </div>
  )
}
