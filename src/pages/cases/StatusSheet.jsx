import React, { useEffect, useState } from 'react'
import { useBackLayer } from '../../backButton.js'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, statusTint } from '../../design/tokens.js'
import { AWAY_REASONS, STATUS_KINDS, kindsFor, awayWhen, awayWords } from '../../clinicalPlan/away.js'
import { WHO_PEOPLE } from '../../clinicalPlan/whosWhere.js'

// ─── Add status (option B, Brent 25 Nov 2026) ────────────────────────────────
// One form for Theatre, Office, Training / travel, Away and Leave, opened from
// the who's-where strip. "Everyone can add a status." Training, Away and
// Leave go on the Staff Leave calendar in the leave colour (they mean "not
// here" to everything that reads leave); Theatre and Office are kept by the
// portal. Leave shows as "Leave" only — the request itself is still the Leave
// form. It replaced the + Away sheet of 24 Nov 2026.

const box = {
  width: '100%', boxSizing: 'border-box', padding: `${space.sm}px ${space.md}px`,
  border: `1px solid ${colour.line}`, borderRadius: radius.control,
  ...text('field'), color: colour.ink, background: colour.surface, outline: 'none'
}
const pill = on => ({
  ...text('bodyStrong'), padding: `${space.sm}px ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
  minHeight: 40, border: `1px solid ${on ? colour.navy : colour.line}`,
  background: on ? colour.navy : colour.surface, color: on ? 'white' : colour.ink
})
const Label = ({ children }) => (
  <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.md}px 0 6px` }}>{children}</div>
)

export default function StatusSheet({ user, date, email: presetEmail = '', kind: presetKind = 'office', onClose, onSaved }) {
  useBackLayer(true, onClose)
  const [email, setEmail] = useState(presetEmail)
  const [kind, setKind] = useState(presetKind)
  const [reason, setReason] = useState('Training day')
  const [typed, setTyped] = useState('')
  const [where, setWhere] = useState('')
  const [from, setFrom] = useState(date || '')
  const [to, setTo] = useState(date || '')
  const [allDay, setAllDay] = useState(true)
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('17:00')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [entries, setEntries] = useState([])
  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}

  async function loadList() {
    try {
      const res = await fetch('/api/calendar/today?action=away', { headers: auth })
      const data = await res.json().catch(() => ({}))
      if (Array.isArray(data.entries)) setEntries(data.entries)
    } catch { /* the list is a convenience */ }
  }
  useEffect(() => { loadList() }, [])

  const why = kind === 'away' ? (reason === 'Other' ? typed.trim() : reason) : ''
  const ready = email && from && (kind !== 'away' || why)
  const who = WHO_PEOPLE.find(p => p.email === email)?.firstName

  async function save() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/calendar/today?action=away', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ email, kind, reason: why, where, from, to: allDay ? (to || from) : from, allDay, start, end, note })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'Could not save that.')
      onSaved?.(data.entry)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (!window.confirm('Take this status off?')) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/calendar/today?action=away&id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'Could not take it off.')
      setEntries(list => list.filter(e => e.id !== id))
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Overlay>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
      }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Add status" data-status-sheet
          className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 460, maxHeight: '92%',
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, display: 'flex', flexDirection: 'column'
          }}>
          <div style={{
            padding: `${space.md}px ${space.md}px ${space.sm}px`, borderBottom: `1px solid ${colour.line}`,
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: space.sm
          }}>
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Add status</span>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'none', border: 'none', cursor: 'pointer', ...text('heading'), color: colour.inkFaint, lineHeight: 1
            }}>×</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden' }}>
            <Label>Who</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {WHO_PEOPLE.map(p => (
                <button key={p.email} type="button" data-status-person={p.firstName}
                  onClick={() => setEmail(p.email)} style={pill(email === p.email)}>{p.firstName}</button>
              ))}
            </div>

            <Label>Status</Label>
            <div style={{ display: 'grid', gap: 6 }}>
              {kindsFor(email).map(k => {
                const on = kind === k.id
                const tint = statusTint[k.id]
                return (
                  <button key={k.id} type="button" data-status-kind={k.id} onClick={() => setKind(k.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: space.md, minHeight: 52, textAlign: 'left',
                      borderRadius: radius.card, padding: `${space.sm}px ${space.md}px`, cursor: 'pointer',
                      border: on ? `2px solid ${tint.ring}` : `1px solid ${colour.line}`,
                      background: on ? tint.soft : colour.surface
                    }}>
                    <span aria-hidden="true" style={{
                      width: 20, height: 20, borderRadius: 10, flexShrink: 0, boxSizing: 'border-box',
                      border: `3px solid ${tint.ring}`, background: on ? tint.ring : tint.soft
                    }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>{k.label}</span>
                      <span style={{ ...text('caption'), color: colour.inkFaint }}>{k.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>

            {kind === 'away' && (
              <>
                <Label>Why</Label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[...AWAY_REASONS, 'Other'].map(r => (
                    <button key={r} type="button" data-status-reason={r} onClick={() => setReason(r)} style={pill(reason === r)}>{r}</button>
                  ))}
                </div>
                {reason === 'Other' && (
                  <input value={typed} onChange={e => setTyped(e.target.value)} maxLength={60}
                    placeholder="e.g. Stryker product training" aria-label="Why" style={{ ...box, marginTop: space.sm }} />
                )}
              </>
            )}

            {['theatre', 'office', 'training'].includes(kind) && (
              <>
                <Label>Where</Label>
                <input value={where} onChange={e => setWhere(e.target.value)} maxLength={60} aria-label="Where"
                  placeholder={kind === 'training' ? 'e.g. Melbourne — Brainlab training' : kind === 'theatre' ? 'e.g. Calvary Lenah Valley' : 'TechnoMed office'}
                  style={box} />
              </>
            )}

            <Label>When</Label>
            <div style={{ display: 'flex', gap: 6, marginBottom: space.sm }}>
              <button type="button" onClick={() => setAllDay(true)} style={pill(allDay)}>All day</button>
              <button type="button" onClick={() => setAllDay(false)} style={pill(!allDay)}>Set hours</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: space.sm }}>
              <label style={{ minWidth: 0 }}>
                <span style={{ ...text('caption'), color: colour.inkFaint }}>{allDay ? 'From' : 'Day'}</span>
                <input type="date" value={from} aria-label={allDay ? 'From' : 'Day'}
                  onChange={e => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value) }} style={box} />
              </label>
              {allDay ? (
                <label style={{ minWidth: 0 }}>
                  <span style={{ ...text('caption'), color: colour.inkFaint }}>To</span>
                  <input type="date" value={to} min={from} aria-label="To" onChange={e => setTo(e.target.value)} style={box} />
                </label>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6, minWidth: 0 }}>
                  <label style={{ minWidth: 0 }}>
                    <span style={{ ...text('caption'), color: colour.inkFaint }}>Start</span>
                    <input type="time" value={start} aria-label="Start" onChange={e => setStart(e.target.value)} style={box} />
                  </label>
                  <label style={{ minWidth: 0 }}>
                    <span style={{ ...text('caption'), color: colour.inkFaint }}>Finish</span>
                    <input type="time" value={end} aria-label="Finish" onChange={e => setEnd(e.target.value)} style={box} />
                  </label>
                </div>
              )}
            </div>

            {kind === 'leave' ? (
              <div data-status-leave-note style={{ ...text('caption'), color: colour.inkMuted, marginTop: space.md, lineHeight: 1.5 }}>
                Shows on Cases as "Leave" only. Submit the leave request itself through the Leave form.
              </div>
            ) : (
              <>
                <Label>Note (optional)</Label>
                <input value={note} onChange={e => setNote(e.target.value)} maxLength={300}
                  placeholder="Anything the team should know" aria-label="Note" style={box} />
              </>
            )}

            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}

            <button type="button" disabled={!ready || busy} onClick={save} data-status-save
              style={{
                ...text('bodyStrong'), width: '100%', minHeight: 48, marginTop: space.md, borderRadius: radius.control,
                border: 'none', cursor: ready && !busy ? 'pointer' : 'default',
                background: ready ? colour.accent : colour.line, color: 'white', opacity: busy ? 0.6 : 1
              }}>
              {busy ? 'Saving…' : ready ? `Save — ${who} · ${awayWords(why || where, kind)}` : 'Choose who and when'}
            </button>

            {entries.length > 0 && (
              <>
                <Label>Coming up</Label>
                {entries.map(e => (
                  <div key={e.id} data-status-entry style={{
                    display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px 0`,
                    borderTop: `1px solid ${colour.line}`
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...text('bodyStrong'), color: colour.ink }}>
                        {e.firstName} — {awayWords(e.kind === 'training' ? (e.where || e.reason) : e.kind === 'away' || !e.kind ? e.reason : e.where, e.kind || 'away')}
                      </div>
                      <div style={{ ...text('caption'), color: colour.inkFaint }}>{awayWhen(e)}{e.byName ? ` · added by ${e.byName.split(' ')[0]}` : ''}</div>
                    </div>
                    <button type="button" onClick={() => remove(e.id)} disabled={busy} aria-label={`Remove ${e.firstName}'s status`}
                      style={{ ...pill(false), minHeight: 36, padding: `0 ${space.md}px` }}>Remove</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
