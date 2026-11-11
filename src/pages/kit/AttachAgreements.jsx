import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'

// ─── Every kit's agreement from Dropbox in one pass (Brent, 11 Nov 2026) ─────
// "Attach every agreement whose name clearly matches; anything unsure, list
// for you to confirm rather than guess." The server proposes (a dry run); the
// sure ones arrive ticked, each unsure kit offers its likeliest files with
// "Skip" chosen; nothing is attached until Attach is tapped. Admins and the
// clinical team only. Kits that already have an agreement are left alone.

const short = path => path.split('/').slice(-2).join(' › ')

export default function AttachAgreements({ user, post, onClose, onDone }) {
  const [plan, setPlan] = useState(null)
  const [ticked, setTicked] = useState({})
  const [chosen, setChosen] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  React.useEffect(() => {
    fetch('/api/guides?kits=dbx-autolink', { headers: { Authorization: `Bearer ${user?.token || ''}` } })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!ok) throw new Error(b.error || 'Dropbox could not be read')
        setPlan(b)
        setTicked(Object.fromEntries((b.sure || []).map(p => [p.kitId, true])))
      })
      .catch(err => { setError(err.message); setPlan({ sure: [], unsure: [] }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const picks = plan ? [
    ...plan.sure.filter(p => ticked[p.kitId]).map(p => ({ kitId: p.kitId, path: p.path, kind: 'consignment' })),
    ...plan.unsure.filter(u => chosen[u.kitId]).map(u => ({ kitId: u.kitId, path: chosen[u.kitId], kind: 'consignment' }))
  ] : []

  async function attach() {
    setBusy('attach'); setError('')
    try {
      const out = await post('doc-dbx', { picks })
      setResult(out)
      onDone?.()
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  return (
    <Overlay>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Attach agreements from Dropbox" className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 560, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'center' }}>
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Attach agreements from Dropbox</span>
            <button onClick={onClose} style={{ ...text('bodyStrong'), background: 'none', border: 'none', color: colour.inkFaint, cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {!plan && <div style={{ ...text('caption'), color: colour.inkFaint }}>Reading Admin › Consignment Agreements…</div>}
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
            {result && (
              <div role="status" style={{ ...text('bodyStrong'), color: colour.accentDeep, marginBottom: space.sm }}>
                Attached {result.linked?.length || 0}.{result.failed?.length ? ` ${result.failed.length} could not be: ${result.failed.map(f => f.error).join('; ')}` : ''}
              </div>
            )}
            {plan && !result && (
              <>
                <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, marginBottom: space.xs }}>
                  Clear matches · {plan.sure.length}
                </div>
                {plan.sure.length === 0 && <div style={{ ...text('caption'), color: colour.inkFaint }}>None.</div>}
                {plan.sure.map(p => (
                  <label key={p.kitId} data-sure={p.kitId} style={{ display: 'flex', gap: space.sm, alignItems: 'flex-start', padding: `${space.xs}px 0`, borderBottom: border.hairlineSoft }}>
                    <input type="checkbox" checked={Boolean(ticked[p.kitId])} onChange={e => setTicked(t => ({ ...t, [p.kitId]: e.target.checked }))}
                      style={{ width: 20, height: 20, fontSize: 16, marginTop: 2 }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ ...text('bodyStrong'), color: colour.ink }}>{p.kitName}</span>
                      <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block', overflowWrap: 'anywhere' }}>{short(p.path)}</span>
                    </span>
                  </label>
                ))}
                <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.md}px 0 ${space.xs}px` }}>
                  Not sure — pick one or skip · {plan.unsure.length}
                </div>
                {plan.unsure.length === 0 && <div style={{ ...text('caption'), color: colour.inkFaint }}>None.</div>}
                {plan.unsure.map(u => (
                  <div key={u.kitId} data-unsure={u.kitId} style={{ padding: `${space.xs}px 0`, borderBottom: border.hairlineSoft }}>
                    <div style={{ ...text('bodyStrong'), color: colour.ink }}>{u.kitName}</div>
                    {[{ path: '', name: 'Skip' }, ...u.options].map(o => (
                      <label key={o.path || 'skip'} style={{ display: 'flex', gap: space.sm, alignItems: 'flex-start', ...text('caption'), color: colour.inkMuted, padding: '3px 0' }}>
                        <input type="radio" name={`pick-${u.kitId}`} checked={(chosen[u.kitId] || '') === o.path}
                          onChange={() => setChosen(c => ({ ...c, [u.kitId]: o.path }))} style={{ width: 18, height: 18, fontSize: 16 }} />
                        <span style={{ overflowWrap: 'anywhere' }}>{o.path ? short(o.path) : 'Skip — none of these'}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
          {plan && !result && (
            <div style={{ padding: space.md, borderTop: border.hairline }}>
              <button onClick={attach} disabled={!picks.length || Boolean(busy)} style={{
                width: '100%', ...text('bodyStrong'), padding: space.md, borderRadius: radius.control, border: 'none',
                background: picks.length ? colour.accent : colour.line, color: 'white', cursor: picks.length ? 'pointer' : 'default'
              }}>{busy ? 'Attaching…' : `Attach ${picks.length} agreement${picks.length === 1 ? '' : 's'}`}</button>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  )
}
