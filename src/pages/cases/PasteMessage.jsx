import React, { useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { todayStr, weekdayName } from '../../clinicalPlan/week.js'
import { offerNotices } from '../../notices.js'

// ─── A pasted message, booked straight in ────────────────────────────────────
// Brent, 16 Nov 2026: "copy in a whatsapp message into the add booking field …
// and have the portal read it and add the booking" — "I want you to add it
// straight in to the bookings for the day". The registrar's text goes to
// action=book-message, which reads it (surname only, never a UR number),
// chooses the system by the surgeon's rules and its supply by the day, and
// writes it. Only what the message cannot say — often the hospital — is
// asked here; a message missing the patient or surgeon goes to the form.

const HOSPITALS = [{ id: 'RHH', label: 'RHH' }, { id: 'CLV', label: 'Calvary' }]
const NEEDS = { patient: 'the patient', surgeon: 'the surgeon', hospital: 'the hospital', date: 'the day' }

const box = {
  width: '100%', boxSizing: 'border-box', padding: `${space.sm}px ${space.md}px`,
  border: `1px solid ${colour.line}`, borderRadius: radius.control,
  ...text('field'), color: colour.ink, background: colour.surface, outline: 'none'
}
const pill = on => ({
  ...text('bodyStrong'), padding: `${space.sm}px ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
  border: `1px solid ${on ? colour.accent : colour.line}`, background: on ? colour.accent : colour.surface,
  color: on ? 'white' : colour.ink
})

export default function PasteMessage({ user, onBooked, onUseForm, onClose }) {
  const [message, setMessage] = useState('')
  const [hospital, setHospital] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needs, setNeeds] = useState(null)
  const [read, setRead] = useState(null)
  const [booked, setBooked] = useState(null)

  async function book() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/calendar/today?action=book-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
        body: JSON.stringify({ text: message, hospital: hospital || undefined, date: date || undefined })
      })
      const data = await res.json().catch(() => ({}))
      if (data.error) throw new Error(data.error)
      if (data.needs) {
        setNeeds(data.needs); setRead(data.fields || {})
        if (data.needs.includes('date') && !date) setDate(todayStr())
        return
      }
      setBooked(data.booked)
      offerNotices(data)
      onBooked?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (booked) {
    return (
      <div data-message-booked style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.control, padding: space.md, marginBottom: space.md }}>
        <div style={{ ...text('heading'), color: colour.ink, marginBottom: space.xs }}>Booked</div>
        <div style={{ ...text('body'), color: colour.ink, lineHeight: 1.5 }}>
          {booked.patient} · {booked.surgeon} · {booked.hospital === 'CLV' ? 'Calvary' : booked.hospital} · {weekdayName(booked.date)} {booked.date.slice(8, 10)}/{booked.date.slice(5, 7)}
          <br />{booked.procedure}
          {booked.kit && <><br /><strong>Kit:</strong> {booked.kit}</>}
          {booked.note && <><br /><span style={{ color: colour.inkMuted }}>{booked.note}</span></>}
        </div>
        {booked.unclear && <div style={{ ...text('caption'), color: colour.warning, marginTop: space.xs }}>Check: {booked.unclear}</div>}
        <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: space.xs }}>On the calendar now. Tap the case to change anything.</div>
        <button onClick={onClose} style={{ ...pill(true), width: '100%', marginTop: space.md }}>Done</button>
      </div>
    )
  }

  const blocking = (needs || []).filter(n => n === 'patient' || n === 'surgeon')
  return (
    <div data-paste-message style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.control, padding: space.md, marginBottom: space.md }}>
      <div style={{ ...text('bodyStrong'), color: colour.ink, marginBottom: space.xs }}>Paste a message</div>
      <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
        A registrar's WhatsApp or a text. The portal reads it, picks the system and where it comes from, and puts it on the calendar.
      </div>
      <textarea value={message} onChange={e => { setMessage(e.target.value); setNeeds(null) }} rows={7}
        aria-label="The message" placeholder={'New case for today\n…\nFor L1-L3 perc screws\nBoss Gupta'}
        style={{ ...box, resize: 'vertical', fontFamily: 'inherit' }} />

      {(needs?.includes('hospital') || hospital) && (
        <div style={{ marginTop: space.sm }}>
          <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.xs }}>Which hospital? The message doesn't say.</div>
          <div style={{ display: 'flex', gap: space.sm }}>
            {HOSPITALS.map(h => <button key={h.id} onClick={() => setHospital(h.id)} style={pill(hospital === h.id)}>{h.label}</button>)}
          </div>
        </div>
      )}
      {needs?.includes('date') && (
        <div style={{ marginTop: space.sm }}>
          <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.xs }}>Which day? The message doesn't say.</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Day" style={box} />
        </div>
      )}
      {blocking.length > 0 && (
        <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>
          The message doesn't say {blocking.map(n => NEEDS[n]).join(' or ')}. Fill in the form instead — what was read is put in for you.
        </div>
      )}
      {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}

      <div style={{ display: 'flex', gap: space.sm, marginTop: space.md }}>
        {blocking.length > 0
          ? <button onClick={() => onUseForm?.(read || {})} style={{ ...pill(true), flex: 1 }}>Fill in the form</button>
          : (
            <button onClick={book} disabled={busy || !message.trim() || (needs?.includes('hospital') && !hospital)}
              style={{ ...pill(true), flex: 1, opacity: busy || !message.trim() ? 0.6 : 1 }}>
              {busy ? 'Reading…' : 'Book it'}
            </button>
          )}
        <button onClick={onClose} style={pill(false)}>Cancel</button>
      </div>
    </div>
  )
}
