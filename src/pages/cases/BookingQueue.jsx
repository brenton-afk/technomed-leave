import React, { useState, useEffect, useCallback } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { SURGEON_COLOUR_NAMES } from '../../clinicalPlan/colours.js'
import { loanNeed } from '../../clinicalPlan/inventory.js'
import { weekdayName, parseDateStr } from '../../clinicalPlan/week.js'

// ─── Bookings waiting to be confirmed ────────────────────────────────────────
// Everything read out of bookings@technomed.com.au stops here first.
//
// The reading is good and it is not perfect: a theatre table with a merged cell,
// a photograph taken at an angle, a surgeon written three ways. A booking that
// goes straight to the calendar on a wrong reading sends somebody to the wrong
// hospital or leaves a surgeon without instruments, and that costs far more than
// the ten seconds it takes to glance at a card and tap accept.
//
// So the screen is built for glancing. What was read is shown as plain text, not
// as a form — a form invites reading every field, which nobody will do by the
// fifth card. Anything the parser was unsure of is marked, and tapping a value
// makes it editable. Accept writes it to the calendar; dismiss buries it so the
// same email cannot raise it again.
//
// Nothing here replies to the sender. See src/clinicalPlan/bookingSources.js.

const SURGEONS = Object.keys(SURGEON_COLOUR_NAMES).sort()

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

function prettyDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null
  const { day, month } = parseDateStr(date)
  return `${weekdayName(date)} ${day} ${MONTHS[month - 1]}`
}

const inputStyle = {
  width: '100%', padding: `${space.xs}px ${space.sm}px`, boxSizing: 'border-box',
  border: `1px solid ${colour.line}`, borderRadius: radius.control,
  ...text('body'), color: colour.ink, background: colour.surface, outline: 'none'
}

/**
 * One read value: plain text until you tap it, then an input.
 *
 * Showing twelve inputs per card turns a glance into a form-filling exercise and
 * the queue stops getting cleared. Showing text keeps the question to "is this
 * right?", which is the only question being asked.
 */
function Value({ label, value, onChange, missing, options }) {
  const [editing, setEditing] = useState(false)
  const shown = String(value || '').trim()

  if (editing || (missing && !shown)) {
    return (
      <div style={{ marginBottom: space.xs }}>
        <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: 2 }}>{label}</div>
        {options
          ? (
            <select autoFocus value={shown} onChange={e => onChange(e.target.value)}
              onBlur={() => setEditing(false)} style={inputStyle}>
              <option value="">—</option>
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )
          : (
            <input autoFocus={editing} value={shown} onChange={e => onChange(e.target.value)}
              onBlur={() => setEditing(false)} style={inputStyle} />
          )}
      </div>
    )
  }

  return (
    // The label is spoken as part of the name rather than left to the trailing
    // space between the spans — that space is collapsed away, and the button
    // announced itself as "PatientMarsh".
    <button type="button" onClick={() => setEditing(true)}
      aria-label={`${label}: ${shown || 'not read'}`}
      style={{
        display: 'block', width: '100%', textAlign: 'left', background: 'none',
        border: 'none', padding: `2px 0`, cursor: 'pointer', marginBottom: 2
      }}>
      <span style={{ ...text('caption'), color: colour.inkFaint }}>{label}&nbsp;</span>
      <span style={{ ...text('body'), color: shown ? colour.ink : colour.danger }}>
        {shown || 'not read — tap to add'}
      </span>
    </button>
  )
}

/** The one thing a booking raises that is expensive to miss. */
function LoanNote({ systems, hospital }) {
  const needs = (systems || [])
    .map(system => ({ system, need: loanNeed(system, hospital) }))
    .filter(n => n.need && n.need !== 'none')
  if (!needs.length) return null

  return (
    <div style={{
      marginTop: space.xs, padding: `${space.xs}px ${space.sm}px`,
      background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
      borderRadius: radius.control, ...text('caption'), color: colour.ink
    }}>
      {needs.map(({ system, need }) => (
        <div key={system}>
          <strong>{system}</strong>
          {need === 'move' ? ' — a set has to be moved across'
            : need === 'order' ? ' — no set here, one has to be ordered'
              : ' — we do not hold this; check before the day'}
        </div>
      ))}
    </div>
  )
}

function Candidate({ candidate, user, onDone }) {
  const [fields, setFields] = useState({
    patient: candidate.patient || '',
    surgeon: candidate.surgeon || '',
    date: candidate.date || '',
    procedure: candidate.procedure || '',
    kit: candidate.kit || '',
    hospital: candidate.hospital || ''
  })
  const [status, setStatus] = useState('ready')
  const [error, setError] = useState(null)

  const set = (key, value) => setFields(f => ({ ...f, [key]: value }))
  const ready = fields.patient.trim() && fields.surgeon.trim()
    && /^\d{4}-\d{2}-\d{2}$/.test(fields.date)

  async function send(action, body) {
    setStatus(action)
    setError(null)
    try {
      const res = await fetch(`/api/calendar/today?action=${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
        },
        body: JSON.stringify({ id: candidate.id, ...body })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That did not go through')
      onDone(candidate.id)
    } catch (err) {
      setError(err.message)
      setStatus('ready')
    }
  }

  const accept = () => send('accept', {
    date: fields.date,
    fields: {
      patient: fields.patient.trim(),
      surgeon: fields.surgeon.trim(),
      procedure: fields.procedure.trim(),
      kit: fields.kit.trim(),
      hospital: fields.hospital.trim()
    },
    notes: candidate.note
  })

  const busy = status !== 'ready'

  return (
    <div style={{
      background: colour.surface, border: `1px solid ${colour.line}`,
      borderRadius: radius.card, padding: space.md, marginBottom: space.md
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.xs, marginBottom: space.xs }}>
        <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>
          {fields.patient || 'No surname read'}
        </span>
        {/* Where it came from, for the team and for nobody outside it. */}
        <span style={{ ...text('caption'), color: colour.inkFaint }}>
          {(candidate.sources || []).join(' + ').toUpperCase()}
        </span>
      </div>

      {prettyDate(fields.date) && (
        <div style={{ ...text('bodyStrong'), color: colour.accentDeep, marginBottom: space.xs }}>
          {prettyDate(fields.date)}
        </div>
      )}

      <Value label="Patient" value={fields.patient} onChange={v => set('patient', v)} missing />
      <Value label="Surgeon" value={fields.surgeon} onChange={v => set('surgeon', v)}
        missing options={SURGEONS} />
      {!prettyDate(fields.date) && (
        <div style={{ marginBottom: space.xs }}>
          <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: 2 }}>Date</div>
          <input type="date" value={fields.date} onChange={e => set('date', e.target.value)}
            style={inputStyle} />
        </div>
      )}
      <Value label="Hospital" value={fields.hospital} onChange={v => set('hospital', v)}
        options={['RHH', 'CLV']} />
      <Value label="Kit" value={fields.kit} onChange={v => set('kit', v)} />
      <Value label="Procedure" value={fields.procedure} onChange={v => set('procedure', v)} />

      {candidate.note && (
        <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: space.xs }}>
          {candidate.note}
        </div>
      )}

      <LoanNote systems={candidate.systems} hospital={fields.hospital} />

      {error && (
        <div style={{ ...text('caption'), color: colour.danger, marginTop: space.xs }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: space.sm, marginTop: space.md }}>
        <button onClick={() => send('dismiss', {})} disabled={busy} style={{
          flex: 1, padding: space.sm, cursor: busy ? 'default' : 'pointer', ...text('bodyStrong'),
          background: 'transparent', color: colour.inkMuted,
          border: `1px solid ${colour.line}`, borderRadius: radius.control
        }}>
          {status === 'dismiss' ? 'Dismissing…' : 'Not a booking'}
        </button>
        <button onClick={accept} disabled={!ready || busy} style={{
          flex: 2, padding: space.sm, ...text('bodyStrong'), color: 'white', border: 'none',
          borderRadius: radius.control,
          background: (!ready || busy) ? colour.inkFainter : colour.accent,
          cursor: (!ready || busy) ? 'default' : 'pointer'
        }}>
          {status === 'accept' ? 'Adding…' : 'Add to calendar'}
        </button>
      </div>
    </div>
  )
}

export default function BookingQueue({ user, onClose, onAccepted }) {
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
  }), [user])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/today?action=queue', { headers: headers() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not read the queue')
      setPending(data.pending || [])
    } catch (err) {
      setError(err.message)
      setPending([])
    }
  }, [headers])

  useEffect(() => { load() }, [load])

  async function scan() {
    setScanning(true)
    setError(null)
    try {
      const res = await fetch('/api/calendar/today?action=ingest', {
        method: 'POST', headers: headers()
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not read the mailbox')
      setPending(data.pending || [])
    } catch (err) {
      setError(err.message)
    }
    setScanning(false)
  }

  function done(id) {
    setPending(list => (list || []).filter(c => c.id !== id))
    onAccepted?.()
  }

  return (
    <Overlay>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
      }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Bookings to confirm"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 460,
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
            maxHeight: '90vh', display: 'flex', flexDirection: 'column'
          }}>

          <div style={{
            padding: `${space.md}px ${space.md}px ${space.sm}px`,
            borderBottom: `1px solid ${colour.line}`, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: space.sm
          }}>
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>
              {pending?.length ? `${pending.length} to confirm` : 'Bookings to confirm'}
            </span>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'none', border: 'none', cursor: 'pointer',
              ...text('body'), color: colour.inkFaint
            }}>Close</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', flex: 1 }}>
            {error && (
              <div style={{
                background: colour.dangerSoft, border: `1px solid ${colour.dangerLine}`,
                color: colour.danger, borderRadius: radius.control,
                padding: space.sm, marginBottom: space.md, ...text('caption'),
                // The delegation error is several lines and names a client ID to
                // paste into the admin console, so keep its shape and let it be
                // selected — a wrapped, unselectable wall of text is unusable on
                // a phone, which is where this will be read.
                whiteSpace: 'pre-wrap', userSelect: 'text', WebkitUserSelect: 'text'
              }}>{error}</div>
            )}

            {pending === null && (
              <div style={{ ...text('caption'), color: colour.inkFaint }}>Reading…</div>
            )}

            {pending?.length === 0 && !error && (
              <div style={{ ...text('body'), color: colour.inkMuted }}>
                Nothing waiting. Bookings emailed to bookings@technomed.com.au
                turn up here before they reach the calendar.
              </div>
            )}

            {(pending || []).map(candidate => (
              <Candidate key={candidate.id} candidate={candidate} user={user} onDone={done} />
            ))}
          </div>

          <div style={{
            padding: `${space.sm}px ${space.md}px calc(${space.md}px + env(safe-area-inset-bottom, 0px))`,
            borderTop: `1px solid ${colour.line}`, flexShrink: 0
          }}>
            <button onClick={scan} disabled={scanning} style={{
              width: '100%', padding: space.sm, cursor: scanning ? 'default' : 'pointer',
              ...text('bodyStrong'), background: 'transparent', color: colour.inkMuted,
              border: `1px solid ${colour.line}`, borderRadius: radius.control
            }}>
              {scanning ? 'Checking the mailbox…' : 'Check for new bookings'}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
