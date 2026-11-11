import React, { useEffect, useMemo, useState } from 'react'
import { leaveDays, totalHours } from '../../leaveHours.js'
import { workPatternFor } from '../../staffConfig.js'
import { Overlay } from '../../design/Shell.jsx'

// ─── Amend a leave application (Brent, 11 Nov 2026) ──────────────────────────
// "Aimee wants to amend her annual leave application to 10.5 hours for this
// fortnight." Brent or Erin change the dates, the hours each day is worth, or
// the type, on pending or approved leave. Always in hours: every day of the
// range is listed (weekdays at the person's usual hours, else 7.6), and a day
// set to 0 is not leave. On approved leave the server changes the same Xero
// application, moves the calendar entry and emails the staff member.

const STANDARD = { kind: 'fixed', days: [7.6, 7.6, 7.6, 7.6, 7.6, 0, 0] }
const LABELS = { ANNUAL_LEAVE: 'Annual Leave', SICK: 'Personal / Sick Leave', TOIL: 'Time Off In Lieu (TOIL)' }

const nextWorkingDay = d => {
  const x = new Date(`${d}T00:00:00Z`)
  do { x.setUTCDate(x.getUTCDate() + 1) } while ([0, 6].includes(x.getUTCDay()))
  return x.toISOString().slice(0, 10)
}
const dayName = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** The days of a range with hours: what was saved for a day, else the pattern's. Pure. */
export function daysFor(start, end, saved = [], pattern = STANDARD) {
  const had = new Map((saved || []).map(d => [d.date, Number(d.hours)]))
  const base = leaveDays(start, end, pattern.kind === 'flexible' ? STANDARD : pattern)
  // Every weekday in range is offered, at 0 where the pattern gives none.
  const out = []
  for (let d = start; d && end && d <= end; d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)) {
    const fromPattern = base.find(b => b.date === d)?.hours
    const weekday = ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())
    if (!weekday && !had.has(d)) continue
    out.push({ date: d, hours: had.has(d) ? had.get(d) : (fromPattern ?? 0) })
  }
  return out
}

export default function AmendLeave({ app, authHeaders, onClose, onDone }) {
  const pattern = workPatternFor(app.email) || STANDARD
  const [start, setStart] = useState(app.startDate)
  const [end, setEnd] = useState(app.endDate)
  const [back, setBack] = useState(app.returnDate)
  const [type, setType] = useState(app.leaveType)
  const [days, setDays] = useState(() => daysFor(app.startDate, app.endDate, app.hours, pattern))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Re-laid when the dates change, keeping what was typed for days still in range.
  useEffect(() => {
    setDays(cur => daysFor(start, end, cur, pattern))
    if (end && (!back || back <= end)) setBack(nextWorkingDay(end))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end])

  const total = useMemo(() => totalHours(days.filter(d => Number(d.hours) > 0)), [days])

  async function save() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/admin/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ id: app.id, action: 'amend', startDate: start, endDate: end, returnDate: back, leaveType: type, note,
          hours: days.map(d => ({ date: d.date, hours: Number(d.hours) || 0 })) })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onDone(data)
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  const input = { width: '100%', padding: '10px 12px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 8, fontSize: 16, boxSizing: 'border-box', fontFamily: 'inherit' }
  const lab = { fontSize: 11, color: '#6b7a8d', display: 'block', marginBottom: 4 }

  return (
    <Overlay>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, zIndex: 3000, overflowY: 'auto', overflowX: 'hidden' }}>
      <div data-amend-leave style={{ background: 'white', borderRadius: 16, padding: 20, width: '100%', maxWidth: 440 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#042746' }}>Amend leave — {app.name}</div>
        <div style={{ fontSize: 12.5, color: '#6b7a8d', margin: '4px 0 14px', lineHeight: 1.45 }}>
          {app.status === 'approved'
            ? 'Already approved: saving changes the same leave in Xero, moves the calendar entry and emails them the change.'
            : 'Still pending: saving changes the application and emails them; approve it as usual after.'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label><span style={lab}>First day</span><input type="date" value={start} onChange={e => setStart(e.target.value)} style={input} /></label>
          <label><span style={lab}>Last day</span><input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} style={input} /></label>
          <label><span style={lab}>Back at work</span><input type="date" value={back} min={end} onChange={e => setBack(e.target.value)} style={input} /></label>
          <label><span style={lab}>Type</span>
            <select value={type} onChange={e => setType(e.target.value)} style={input}>
              {Object.entries(LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#042746', margin: '14px 0 6px' }}>Hours each day <span style={{ color: '#1a7a6e' }}>· {total}h</span></div>
        <div style={{ fontSize: 12, color: '#6b7a8d', marginBottom: 6 }}>A part day: type the hours. Not leave that day: 0.</div>
        {days.map(d => (
          <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ flex: 1, fontSize: 14, color: '#042746' }}>{dayName(d.date)}</span>
            <input type="number" inputMode="decimal" min="0" max="12" step="0.25" value={d.hours} aria-label={`Hours on ${dayName(d.date)}`}
              onChange={e => setDays(list => list.map(x => (x.date === d.date ? { ...x, hours: e.target.value } : x)))}
              style={{ ...input, width: 90, textAlign: 'right' }} />
            <span style={{ fontSize: 13, color: '#6b7a8d' }}>h</span>
          </div>
        ))}
        <label style={{ display: 'block', marginTop: 10 }}><span style={lab}>Note (goes in the history)</span>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Aimee asked to change to 10.5 hours" style={input} /></label>
        {error && <div role="alert" style={{ background: '#fdecea', color: '#c0392b', padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, background: '#f0f3f7', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: '#6b7a8d' }}>Cancel</button>
          <button onClick={save} disabled={busy || !(total > 0)} data-amend-save
            style={{ flex: 2, padding: 12, background: '#1a7a6e', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: busy || !(total > 0) ? 0.6 : 1 }}>
            {busy ? 'Saving…' : `Save — ${total}h`}
          </button>
        </div>
      </div>
    </div>
    </Overlay>
  )
}
