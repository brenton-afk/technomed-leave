import React, { useState, useEffect, useCallback } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { SURGEON_SERVICES } from '../../clinicalPlan/colours.js'
import { withoutPreOpNoise } from '../../clinicalPlan/preOpNoise.js'
import { resolveKit, systemsInKit } from '../../clinicalPlan/systems.js'
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

const SURGEONS = SURGEON_SERVICES.flatMap(g => g.surgeons)

/**
 * The note, less the pre-operative workup.
 *
 * Filtered here as well as when the email is read, so a candidate queued before
 * that existed comes good too — the alternative is telling somebody to dismiss
 * a booking and check the mailbox again, for a line the app should never have
 * shown.
 */
function noteWorthShowing(note) {
  const kept = withoutPreOpNoise(
    String(note || '').split(/\n|(?<=\.)\s+(?=[A-Z])/)
  ).join(' ').trim()
  return kept || null
}

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
  // `field`, not `body` — see the token. An inline 14px here is what makes
  // iOS zoom the whole app on focus.
  ...text('field'), color: colour.ink, background: colour.surface, outline: 'none'
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
  // `loanNeed` returns a verdict object, not a word. Comparing the object to
  // 'none' was never equal, so every system on every card fell past the filter
  // and out the bottom of the ladder below as "we do not hold this" — said
  // about Diplomat, of which there are three at Calvary.
  const needs = (systems || [])
    .map(system => {
      const verdict = loanNeed(system, hospital)
      return { system, need: verdict.need, reason: verdict.reason }
    })
    .filter(n => n.need && n.need !== 'none')
  if (!needs.length) return null

  return (
    <div style={{
      marginTop: space.xs, padding: `${space.xs}px ${space.sm}px`,
      background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
      borderRadius: radius.control, ...text('caption'), color: colour.ink
    }}>
      {needs.map(({ system, need, reason }) => (
        <div key={system}>
          <strong>{system}</strong>
          {need === 'move' ? ' — a set has to be moved across'
            : need === 'order' ? ' — no set here, one has to be ordered'
              // The inventory's own words. It knows why it cannot answer —
              // "E4 supply several products, which one?" is useful where "we do
              // not hold this" is both wrong and alarming.
              : ` — ${reason || 'check before the day'}`}
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
    // Resolved here as well as when the email was read, so a candidate queued
    // before that existed shows the system somebody can actually bring rather
    // than the name the surgeon happened to type.
    kit: resolveKit(candidate.kit || '', candidate.procedure || ''),
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

      {/* What the reader actually worked from.
          
          A booking came back naming a system we do not carry and nobody could
          say whether the surgeon had written it or the reader had invented it —
          the email sits in a mailbox only the app can see. Now it is one tap to
          find out, and one more to hand the text to somebody who can tell. */}
      {(candidate.excerpt || candidate.attachments?.length > 0) && (
        <details style={{ marginTop: space.xs }}>
          <summary style={{
            ...text('caption'), color: colour.inkFaint, cursor: 'pointer'
          }}>
            What the email said
          </summary>
          <div style={{
            ...text('caption'), color: colour.inkMuted, marginTop: space.xs,
            background: colour.canvas, border: `1px solid ${colour.line}`,
            borderRadius: radius.control, padding: space.sm,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 220, overflowY: 'auto',
            userSelect: 'text', WebkitUserSelect: 'text'
          }}>
            {candidate.from && <div style={{ color: colour.inkFainter }}>From {candidate.from}</div>}
            {candidate.subject && <div style={{ color: colour.inkFainter }}>{candidate.subject}</div>}
            {candidate.attachments?.length > 0 && (
              <div style={{ color: colour.inkFainter }}>
                Attached: {candidate.attachments.join(', ')}
              </div>
            )}
            {candidate.excerpt || '(the booking was in an attachment, not the message)'}
          </div>
          <button type="button"
            onClick={() => navigator.clipboard?.writeText([
              candidate.from && `From ${candidate.from}`,
              candidate.subject,
              candidate.attachments?.length ? `Attached: ${candidate.attachments.join(', ')}` : '',
              '',
              candidate.excerpt || '(booking was in an attachment)',
              '',
              `Read as: ${candidate.patient || '?'} / ${candidate.surgeon || '?'} / `
                + `${candidate.date || '?'} / ${candidate.kit || '?'}`
            ].filter(Boolean).join('\n'))}
            style={{
              ...text('caption'), marginTop: space.xs, cursor: 'pointer',
              background: 'transparent', color: colour.accentDeep,
              border: `1px solid ${colour.line}`, borderRadius: radius.control,
              padding: `4px ${space.sm}px`
            }}>
            Copy the email and what it was read as
          </button>
        </details>
      )}

      {noteWorthShowing(candidate.note) && (
        <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: space.xs }}>
          {noteWorthShowing(candidate.note)}
        </div>
      )}

      {/* Worked out from the kit on screen, not from the list stored when the
          email was read. That stored list still said "E4 Cages" — so the card
          named the right cage and then said underneath that we do not hold it,
          which we do: two consignment kits of it at Calvary. */}
      <LoanNote systems={systemsInKit(fields.kit)} hospital={fields.hospital} />

      {error && (
        <div style={{ ...text('caption'), color: colour.danger, marginTop: space.xs }}>{error}</div>
      )}

      {/* Three answers, because there are three. The app checks the calendar
          before offering a case, and still misses some — a surname spelt
          differently, a day moved after the email was sent — so somebody has
          to be able to say "we have this" without saying "this is not
          happening". Dismissing a real case is the wrong thing for the next
          person to find when they go looking for why a tray was not packed. */}
      <button onClick={() => send('dismiss', { reason: 'onCalendar' })} disabled={busy}
        style={{
          width: '100%', padding: space.sm, marginTop: space.md, ...text('bodyStrong'),
          cursor: busy ? 'default' : 'pointer', background: 'transparent',
          color: colour.inkMuted, border: `1px solid ${colour.line}`,
          borderRadius: radius.control
        }}>
        {status === 'dismiss' ? 'Marking…' : 'Already in the calendar'}
      </button>

      <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm }}>
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
  const [lastScan, setLastScan] = useState(null)

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
      setLastScan(data)
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
          className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 460,
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
            display: 'flex', flexDirection: 'column'
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

            {lastScan && !error && (
              <div style={{
                ...text('caption'), color: colour.inkMuted, marginBottom: space.md
              }}>
                {lastScan.read === 0 && lastScan.skipped === 0
                  ? 'No new emails since the last check.'
                  : [
                    `Read ${lastScan.read} new booking email${lastScan.read === 1 ? '' : 's'}.`,
                    // Never a silent cap: an email nobody looked at has to say so.
                    lastScan.remaining
                      ? `${lastScan.remaining} still to read — check again.`
                      : null,
                    // A booking from a domain the app does not know would
                    // otherwise disappear without trace.
                    lastScan.skipped
                      ? `${lastScan.skipped} email${lastScan.skipped === 1 ? '' : 's'} `
                        + 'from senders that are not booking sources were left alone.'
                      : null,
                    // The ordinary outcome, and the one that would otherwise
                    // read as "found nothing": most emails confirm a case
                    // somebody already entered.
                    lastScan.already
                      ? `${lastScan.already} ${lastScan.already === 1 ? 'was' : 'were'} `
                        + 'already on the calendar.'
                      : null,
                    // Reported rather than swallowed: these are retried, and if
                    // the number does not fall it needs a person.
                    lastScan.unreadable
                      ? `${lastScan.unreadable} could not be read — they will be `
                        + 'tried again.'
                      : null
                  ].filter(Boolean).join(' ')}
              </div>
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
              {scanning ? 'Checking the mailbox…'
                : lastScan?.remaining ? `Check the next ${lastScan.remaining > 5 ? 5 : lastScan.remaining}`
                  : 'Check for new bookings'}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
