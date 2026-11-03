import React, { useState, useEffect, useCallback } from 'react'
import { Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { useLiveRefresh } from '../liveRefresh.js'

// ─── Surgeon preference cards, editable (Task 18) ────────────────────────────
// "Allow surgeon preference cards to be edited in the portal and update for
// everyone straight away." Aimee keeps these current, and until now that meant
// rebuilding a page and waiting for it to be installed.
//
// The clinical team edits a card in place; everybody else reads. Every save is
// a version with who and when, any version can be put back, and the screen
// rechecks every minute and whenever it comes back into view, so an edit made
// at the bench reaches the next person without them reloading anything.
//
// Bold is written **like this** — plain text, never HTML. See api/_preferences.js.

/** "**18×15mm** cage" → "18×15mm" in bold, then " cage". */
export function Rich({ value }) {
  const parts = String(value || '').split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : <React.Fragment key={i}>{part}</React.Fragment>))
}

function when(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'
  }).format(new Date(iso))
}

const field = {
  width: '100%', boxSizing: 'border-box', padding: `${space.sm}px ${space.md}px`,
  border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface,
  ...text('field'), color: colour.ink, outline: 'none', fontFamily: 'inherit'
}

function Editor({ card, onSave, onCancel, onDelete, saving }) {
  const [draft, setDraft] = useState(() => ({
    name: card?.name || '', subtitle: card?.subtitle || '', tag: card?.tag || '', colour: card?.colour || '#8C8F98',
    items: (card?.items || []).join('\n'),
    alertTitle: card?.alert?.title || '', alertText: card?.alert?.text || ''
  }))
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, display: 'block', margin: `${space.sm}px 0 4px` }
  return (
    <div>
      <label><span style={label}>System</span>
        <input value={draft.name} onChange={e => set('name', e.target.value)} style={field} aria-label="System" /></label>
      <label><span style={label}>Description</span>
        <input value={draft.subtitle} onChange={e => set('subtitle', e.target.value)} style={field} /></label>
      <label><span style={label}>Preferences — one per line, **bold** for emphasis</span>
        <textarea value={draft.items} rows={Math.max(5, draft.items.split('\n').length + 1)}
          onChange={e => set('items', e.target.value)} style={{ ...field, resize: 'vertical' }} aria-label="Preferences" /></label>
      <label><span style={label}>Warning heading (optional)</span>
        <input value={draft.alertTitle} placeholder="Tell the surgeon before surgery if"
          onChange={e => set('alertTitle', e.target.value)} style={field} /></label>
      <label><span style={label}>Warning</span>
        <input value={draft.alertText} onChange={e => set('alertText', e.target.value)} style={field} /></label>
      <div style={{ display: 'flex', gap: space.sm, marginTop: space.md }}>
        {onDelete && (
          <button type="button" onClick={onDelete} disabled={saving} style={{
            padding: space.sm, cursor: 'pointer', ...text('bodyStrong'), background: 'transparent',
            color: colour.danger, border: `1px solid ${colour.dangerLine}`, borderRadius: radius.control
          }}>Remove</button>
        )}
        <button type="button" onClick={onCancel} disabled={saving} style={{
          flex: 1, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'), background: 'transparent',
          color: colour.inkMuted, border: `1px solid ${colour.line}`, borderRadius: radius.control
        }}>Cancel</button>
        <button type="button" disabled={saving || !draft.name.trim()} onClick={() => onSave({
          name: draft.name, subtitle: draft.subtitle, tag: draft.tag, colour: draft.colour,
          items: draft.items.split('\n'), alert: { title: draft.alertTitle, text: draft.alertText }
        })} style={{
          flex: 2, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'), color: 'white',
          background: colour.accent, border: 'none', borderRadius: radius.control
        }}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

function SystemCard({ card }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: radius.pill, background: card.colour, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ ...text('bodyStrong'), color: colour.ink }}>{card.name}</div>
          {card.subtitle && <div style={{ ...text('caption'), color: colour.inkFaint }}>{card.subtitle}</div>}
        </div>
      </div>
      {card.tag && <div style={{ ...text('micro'), color: card.colour, marginTop: space.xs }}>{card.tag}</div>}
      <ul style={{ margin: `${space.xs}px 0 0`, padding: 0, listStyle: 'none' }}>
        {card.items.map((item, i) => (
          <li key={i} style={{ ...text('body'), color: colour.ink, padding: '6px 0', borderTop: i ? `1px solid ${colour.line}` : 'none' }}>
            <Rich value={item} />
          </li>
        ))}
      </ul>
      {card.alert && (
        <div role="note" style={{ marginTop: space.sm, background: colour.dangerSoft, border: `1px solid ${colour.dangerLine}`,
          borderRadius: radius.control, padding: space.sm }}>
          {card.alert.title && <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.danger }}>{card.alert.title}</div>}
          <div style={{ ...text('caption'), color: colour.ink }}>{card.alert.text}</div>
        </div>
      )}
    </>
  )
}

export default function PreferenceCards({ user, focus, onClose }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [surgeonId, setSurgeonId] = useState(() => (focus ? String(focus).replace(/^p-/, '') : null))
  const [editing, setEditing] = useState(null)   // { index } or { index: null } for new
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState(null)
  const [notice, setNotice] = useState('')
  const headers = user?.token ? { Authorization: `Bearer ${user.token}` } : {}

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/guides?prefs=1', { headers })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load the cards')
      setState(prev => {
        if (prev && data.version !== prev.version && editing) {
          setNotice(`${data.updatedBy || 'Somebody'} has just changed the cards.`)
          return prev
        }
        return data
      })
      setSurgeonId(id => id || data.data?.surgeons?.[0]?.id)
    } catch (err) { setError(err.message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token, editing])

  useEffect(() => { load() }, [load])
  // Everybody sees an edit within a minute, and the moment they come back to it.
  useLiveRefresh(load, [load])

  async function post(body) {
    setSaving(true); setError(''); setNotice('')
    try {
      const res = await fetch('/api/guides?prefs=1', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Not saved')
      setState(data); setEditing(null); setHistory(null)
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  async function openHistory() {
    const res = await fetch('/api/guides?prefs=history', { headers })
    const data = await res.json().catch(() => ({}))
    setHistory(data.history || [])
  }

  const surgeons = state?.data?.surgeons || []
  const surgeon = surgeons.find(s => s.id === surgeonId) || surgeons[0]

  return (
    <Overlay>
      <div role="dialog" aria-label="Surgeon preferences" style={{ position: 'fixed', inset: 0, zIndex: 3000,
        background: colour.canvas, display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: colour.navy, padding: `calc(env(safe-area-inset-top, 0px) + ${space.sm}px) ${space.md}px ${space.sm}px`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', ...text('bodyStrong'), padding: space.xs }}>Close</button>
            <span style={{ ...text('heading'), color: 'white', flex: 1 }}>Surgeon preferences</span>
            {state?.canEdit && (
              <button onClick={history ? () => setHistory(null) : openHistory} style={{ background: 'rgba(255,255,255,0.12)',
                border: 'none', color: 'white', cursor: 'pointer', ...text('caption'), fontWeight: 700,
                borderRadius: radius.pill, padding: `6px ${space.md}px` }}>{history ? 'Cards' : 'History'}</button>
            )}
          </div>
          {!history && (
            <div role="tablist" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: space.sm }}>
              {surgeons.map(s => (
                <button key={s.id} role="tab" aria-selected={s.id === surgeon?.id}
                  onClick={() => { setSurgeonId(s.id); setEditing(null) }} style={{
                    flexShrink: 0, padding: `6px ${space.md}px`, borderRadius: radius.pill, border: 'none', cursor: 'pointer',
                    ...text('bodyStrong'), background: s.id === surgeon?.id ? 'white' : 'rgba(255,255,255,0.12)',
                    color: s.id === surgeon?.id ? colour.navy : 'white'
                  }}>{s.name}</button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: space.md }}>
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
          {notice && <div role="status" style={{ ...text('caption'), color: colour.warning, marginBottom: space.sm }}>{notice}</div>}
          {!state && !error && <div style={{ ...text('caption'), color: colour.inkFaint, textAlign: 'center' }}>Loading…</div>}

          {history && (
            <div>
              {history.length === 0 && <div style={{ ...text('caption'), color: colour.inkFaint }}>No changes yet — these are Aimee's cards of 28 October.</div>}
              {history.map(h => (
                <div key={h.version} style={{ background: colour.surface, border: `1px solid ${colour.line}`,
                  borderRadius: radius.control, padding: space.sm, marginBottom: space.xs, display: 'flex', gap: space.sm, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...text('bodyStrong'), color: colour.ink }}>{h.summary}</div>
                    <div style={{ ...text('caption'), color: colour.inkFaint }}>{h.by} · {when(h.at)} · version {h.version}</div>
                  </div>
                  {h.version !== state?.version && (
                    <button disabled={saving} onClick={() => {
                      if (window.confirm(`Put the cards back to how they were after "${h.summary}"? Today's version stays in the history.`)) post({ restore: h.version })
                    }} style={{ ...text('caption'), fontWeight: 700, cursor: 'pointer', background: 'none',
                      border: `1px solid ${colour.line}`, borderRadius: radius.pill, padding: `4px ${space.sm}px`, color: colour.accentDeep }}>Restore</button>
                  )}
                </div>
              ))}
              {history.length > 0 && history[history.length - 1].version > 0 && state?.version > 0 && (
                <button disabled={saving} onClick={() => {
                  if (window.confirm('Put back Aimee\'s original cards of 28 October? Every later version stays in the history.')) post({ restore: 0 })
                }} style={{ ...text('caption'), cursor: 'pointer', background: 'none', border: 'none', color: colour.inkMuted, textDecoration: 'underline' }}>
                  Restore the original cards of 28 October
                </button>
              )}
            </div>
          )}

          {!history && surgeon && (
            <>
              {surgeon.systems.map((card, i) => (
                <div key={`${surgeon.id}-${i}`} style={{ background: colour.surface, border: `1px solid ${colour.line}`,
                  borderLeft: `4px solid ${card.colour}`, borderRadius: radius.card, padding: space.md, marginBottom: space.sm }}>
                  {editing?.index === i ? (
                    <Editor card={card} saving={saving} onCancel={() => setEditing(null)}
                      onDelete={() => { if (window.confirm(`Remove ${card.name} from ${surgeon.name}'s card?`)) post({ baseVersion: state.version, surgeonId: surgeon.id, index: i, card: null }) }}
                      onSave={next => post({ baseVersion: state.version, surgeonId: surgeon.id, index: i, card: next })} />
                  ) : (
                    <>
                      <SystemCard card={card} />
                      {state.canEdit && !editing && (
                        <button onClick={() => setEditing({ index: i })} aria-label={`Edit ${card.name}`} style={{
                          marginTop: space.sm, ...text('caption'), fontWeight: 700, cursor: 'pointer', background: 'none',
                          border: `1px solid ${colour.line}`, borderRadius: radius.pill, padding: `4px ${space.md}px`, color: colour.accentDeep
                        }}>Edit</button>
                      )}
                    </>
                  )}
                </div>
              ))}
              {state.canEdit && (editing?.index === null ? (
                <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md }}>
                  <Editor card={null} saving={saving} onCancel={() => setEditing(null)}
                    onSave={next => post({ baseVersion: state.version, surgeonId: surgeon.id, index: null, card: next })} />
                </div>
              ) : !editing && (
                <button onClick={() => setEditing({ index: null })} style={{ width: '100%', padding: space.sm, cursor: 'pointer',
                  ...text('bodyStrong'), background: colour.accentSoft, color: colour.accentDeep,
                  border: `1px dashed ${colour.accent}`, borderRadius: radius.control }}>+ Add a system for {surgeon.name}</button>
              ))}
              <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.md }}>
                {state.updatedAt ? `Last changed by ${state.updatedBy}, ${when(state.updatedAt)}.` : `${state.updatedBy}.`}{' '}
                Reference only — confirm against the IFU, the packaging and the day's list.
              </div>
            </>
          )}
        </div>
      </div>
    </Overlay>
  )
}
