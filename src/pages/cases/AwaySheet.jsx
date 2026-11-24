import React, { useEffect, useState } from 'react'
import { useBackLayer } from '../../backButton.js'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { STAFF } from '../../staffConfig.js'
import { AWAY_REASONS, awayWhen, awayWords } from '../../clinicalPlan/away.js'

// ─── + Away on Cases (Brent, 24 Nov 2026) ────────────────────────────────────
// "Mat is at a training day. He's not on leave as he'll be paid for his time
// there, but he is also not available for cases." Brent, Erin and Toni add a
// training day, an RDO or similar here; it goes on the Staff Leave calendar in
// the leave colour, so the day reads "Mat · Away" like leave would. Nothing
// reaches Xero — the person fills in their timesheet as a normal day.

const PEOPLE = STAFF.filter(s => s.hasTimesheets || s.isClinicalTeam)

const box = {
  width: '100%', boxSizing: 'border-box', padding: `${space.sm}px ${space.md}px`,
  border: `1px solid ${colour.line}`, borderRadius: radius.control,
  ...text('field'), color: colour.ink, background: colour.surface, outline: 'none'
}
const pill = on => ({
  ...text('bodyStrong'), padding: `${space.sm}px ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
  minHeight: 40, border: `1px solid ${on ? colour.accent : colour.line}`,
  background: on ? colour.accent : colour.surface, color: on ? 'white' : colour.ink
})
const Label = ({ children }) => (
  <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.md}px 0 6px` }}>{children}</div>
)

export default function AwaySheet({ user, date, onClose, onSaved }) {
  useBackLayer(true, onClose)
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('Training day')
  const [typed, setTyped] = useState('')
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

  const why = reason === 'Other' ? typed.trim() : reason
  const ready = email && why && from && (!allDay || to)

  async function save() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/calendar/today?action=away', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ email, reason: why, from, to: allDay ? (to || from) : from, allDay, start, end, note })
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
    if (!window.confirm('Take this off the calendar?')) return
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
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Add an away day" data-away-sheet
          className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 460, maxHeight: '92%',
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, display: 'flex', flexDirection: 'column'
          }}>
          <div style={{
            padding: `${space.md}px ${space.md}px ${space.sm}px`, borderBottom: `1px solid ${colour.line}`,
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: space.sm
          }}>
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Away</span>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'none', border: 'none', cursor: 'pointer', ...text('heading'), color: colour.inkFaint, lineHeight: 1
            }}>×</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden' }}>
            <div style={{ ...text('caption'), color: colour.inkFaint, lineHeight: 1.5 }}>
              Paid, but not available for cases — a training day, an RDO. Shows on the calendar like leave;
              nothing goes to Xero and they fill in their timesheet as normal.
            </div>

            <Label>Who</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PEOPLE.map(p => (
                <button key={p.email} type="button" data-away-person={p.firstName}
                  onClick={() => setEmail(p.email)} style={pill(email === p.email)}>{p.firstName}</button>
              ))}
            </div>

            <Label>Why</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[...AWAY_REASONS, 'Other'].map(r => (
                <button key={r} type="button" data-away-reason={r} onClick={() => setReason(r)} style={pill(reason === r)}>{r}</button>
              ))}
            </div>
            {reason === 'Other' && (
              <input value={typed} onChange={e => setTyped(e.target.value)} maxLength={60}
                placeholder="e.g. Stryker product training" aria-label="Why" style={{ ...box, marginTop: space.sm }} />
            )}

            <Label>When</Label>
            <div style={{ display: 'flex', gap: 6, marginBottom: space.sm }}>
              <button type="button" onClick={() => setAllDay(true)} style={pill(allDay)}>All day</button>
              <button type="button" onClick={() => setAllDay(false)} style={pill(!allDay)}>Set hours</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: space.sm }}>
              <label style={{ minWidth: 0 }}>
                <span style={{ ...text('caption'), color: colour.inkFaint }}>{allDay ? 'First day' : 'Day'}</span>
                <input type="date" value={from} aria-label={allDay ? 'First day' : 'Day'}
                  onChange={e => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value) }} style={box} />
              </label>
              {allDay ? (
                <label style={{ minWidth: 0 }}>
                  <span style={{ ...text('caption'), color: colour.inkFaint }}>Last day</span>
                  <input type="date" value={to} min={from} aria-label="Last day" onChange={e => setTo(e.target.value)} style={box} />
                </label>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6, minWidth: 0 }}>
                  <label style={{ minWidth: 0 }}>
                    <span style={{ ...text('caption'), color: colour.inkFaint }}>From</span>
                    <input type="time" value={start} aria-label="From" onChange={e => setStart(e.target.value)} style={box} />
                  </label>
                  <label style={{ minWidth: 0 }}>
                    <span style={{ ...text('caption'), color: colour.inkFaint }}>To</span>
                    <input type="time" value={end} aria-label="To" onChange={e => setEnd(e.target.value)} style={box} />
                  </label>
                </div>
              )}
            </div>

            <Label>Note (optional)</Label>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={300}
              placeholder="Where, or anything the team should know" aria-label="Note" style={box} />

            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}

            <button type="button" disabled={!ready || busy} onClick={save} data-away-save
              style={{
                ...text('bodyStrong'), width: '100%', minHeight: 48, marginTop: space.md, borderRadius: radius.control,
                border: 'none', cursor: ready && !busy ? 'pointer' : 'default',
                background: ready ? colour.accent : colour.line, color: 'white', opacity: busy ? 0.6 : 1
              }}>
              {busy ? 'Saving…' : ready
                ? `Put ${PEOPLE.find(p => p.email === email)?.firstName} on the calendar — ${awayWords(why)}`
                : 'Choose who, why and when'}
            </button>

            {entries.length > 0 && (
              <>
                <Label>Coming up</Label>
                {entries.map(e => (
                  <div key={e.id} data-away-entry style={{
                    display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px 0`,
                    borderTop: `1px solid ${colour.line}`
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...text('bodyStrong'), color: colour.ink }}>{e.firstName} — {awayWords(e.reason)}</div>
                      <div style={{ ...text('caption'), color: colour.inkFaint }}>{awayWhen(e)}{e.byName ? ` · added by ${e.byName.split(' ')[0]}` : ''}</div>
                    </div>
                    <button type="button" onClick={() => remove(e.id)} disabled={busy} aria-label={`Remove ${e.firstName}'s ${e.reason}`}
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
