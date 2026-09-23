import React, { useState, useEffect, useCallback } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import {
  GOOGLE_COLOR_NAMES, GOOGLE_COLOR_HEX, guideColorIdFor, colourNameFor
} from '../../clinicalPlan/colours.js'
import { zonedCivil, toDateStr, TZ } from '../../clinicalPlan/week.js'

// ─── Amending a booking from the portal ──────────────────────────────────────
// Tap a case, change it, and it lands on the calendar the whole team reads.
//
// Three things shape this, and all three are about not doing damage:
//
// 1. It loads the booking fresh rather than editing the case object the week
//    plan built. The plan holds *derived* values — the system uppercased, the
//    supply lifted out of the kit line — and saving those would write the app's
//    rendering back over what the team typed.
//
// 2. Only changed fields are sent, and the server patches each in place. The
//    portal holds a patient's surname and nothing else by policy, so rebuilding
//    the description would delete the "(Donna)" somebody recorded on purpose.
//
// 3. The version marker goes back with the save. Several people edit this
//    calendar during a list; without it the last write silently wins and the
//    other person's change is gone with nothing to say it existed.

const FIELDS = [
  { key: 'patient', label: 'Patient surname', hint: 'Surname only — anything else in the booking is kept' },
  { key: 'surgeon', label: 'Surgeon' },
  { key: 'procedure', label: 'Procedure' },
  { key: 'kit', label: 'Kit', hint: 'System and supply, as written: "Diplomat (Consignment)"' },
  { key: 'hospital', label: 'Hospital' }
]

/**
 * The Hobart date and clock time of an instant, for the form.
 *
 * Never the device's. A rep in Melbourne opening a booking must see the time the
 * theatre list actually starts, and saving must not shift it by an hour.
 */
function civilParts(iso) {
  if (!iso || !String(iso).includes('T')) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const c = zonedCivil(at, TZ)
  const pad = n => String(n).padStart(2, '0')
  return { date: toDateStr(c), time: `${pad(c.hour)}:${pad(c.minute)}` }
}

function Field({ label, hint, value, onChange, autoFocus, type = 'text' }) {
  return (
    <label style={{ display: 'block', marginBottom: space.md }}>
      <span style={{
        ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
        display: 'block', marginBottom: 4
      }}>{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
          border: `1px solid ${colour.line}`, borderRadius: radius.control,
          ...text('body'), color: colour.ink, background: colour.surface, outline: 'none'
        }} />
      {hint && (
        <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 2 }}>
          {hint}
        </span>
      )}
    </label>
  )
}

/**
 * A title that still names a value the booking no longer has.
 *
 * Changing the surgeon in the description leaves "Chalmers DIPLOMAT - Fowler"
 * saying Fowler, and the title is what shows in Google's month view — so the
 * calendar would contradict itself. The portal proposes the corrected title and
 * waits to be told: rewriting it automatically would silently reformat titles
 * people wrote by hand, and anything unusual in one would be lost.
 */
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function staleTitle(summary, before, after) {
  const title = String(summary || '')
  for (const key of ['surgeon', 'patient', 'kit']) {
    const was = String(before?.[key] || '').trim()
    const now = String(after?.[key] || '').trim()
    if (!was || !now || was === now) continue

    // The whole value first, then its last word. A description reads
    // "Surg - Dr Ibbett" while the title says only "Ibbett" — the live
    // convention on this calendar — so matching the whole value alone would
    // miss every titled surgeon who has a "Dr" in front of them.
    const candidates = [was]
    const lastWord = was.split(/\s+/).pop()
    if (lastWord && lastWord !== was && lastWord.length > 1) candidates.push(lastWord)

    for (const candidate of candidates) {
      // Whole word only: replacing a fragment would corrupt an unrelated word,
      // and "Al" inside "Calvary" is not a surgeon.
      const pattern = new RegExp(`\\b${escape(candidate)}\\b`, 'i')
      if (!pattern.test(title)) continue
      // Replaced with the new value's last word too, so "Dr Ibbett" becoming
      // "Dr Fowler" does not write "Dr Fowler" where the title had a bare name.
      const replacement = candidate === was ? now : (now.split(/\s+/).pop() || now)
      return { field: key, was: candidate, now: replacement, proposed: title.replace(pattern, replacement) }
    }
  }
  return null
}

/**
 * The booking's colour in Google.
 *
 * Not chosen — derived. The colour is a function of who is operating (the guide
 * says Ibbett is Banana), so asking a person to pick it is asking them to look
 * up a table and get it right, which is how bookings ended up uncoloured or
 * wrong to begin with. The server sets it from the surgeon on every save, so
 * editing anything about a booking also puts its colour right.
 *
 * This is therefore mostly a statement of what will happen. The palette is
 * behind a tap, for a surgeon the guide has no opinion about and for the day
 * somebody genuinely wants something else — automatic is a default, not a lock.
 */
function ColourPicker({ value, surgeon, chosen, onChange, onClear }) {
  const [open, setOpen] = useState(false)
  const expected = guideColorIdFor(
    String(surgeon || '').replace(/^(dr|mr|mrs|ms|prof|a\/prof)\b\.?\s*/i, '').trim().split(/\s+/).pop())
  const willBe = chosen ? value : (expected || value)

  return (
    <div style={{ marginBottom: space.md }}>
      <span style={{
        ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
        display: 'block', marginBottom: 4
      }}>Colour in the calendar</span>

      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
        <span aria-hidden="true" style={{
          width: 24, height: 24, borderRadius: radius.pill, flexShrink: 0,
          background: GOOGLE_COLOR_HEX[willBe] || colour.line,
          border: `1px solid ${colour.line}`
        }} />
        <span style={{ ...text('caption'), color: colour.inkMuted, flex: 1 }}>
          {willBe ? colourNameFor(willBe) : 'No colour set'}
          {!chosen && expected && (
            <span style={{ color: colour.inkFainter }}> — set automatically from {surgeon}</span>
          )}
          {chosen && <span style={{ color: colour.inkFainter }}> — chosen for this booking</span>}
        </span>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{
            ...text('caption'), cursor: 'pointer', background: 'none',
            border: `1px solid ${colour.line}`, borderRadius: radius.control,
            padding: `4px ${space.sm}px`, color: colour.inkMuted, flexShrink: 0
          }}>
          {open ? 'Done' : 'Change'}
        </button>
      </div>

      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
          {Object.keys(GOOGLE_COLOR_NAMES).map(id => {
            const on = String(willBe || '') === id
            return (
              <button key={id} type="button" onClick={() => onChange(id)}
                aria-label={GOOGLE_COLOR_NAMES[id]} aria-pressed={on}
                title={GOOGLE_COLOR_NAMES[id] + (id === expected ? ' — the guide' : '')}
                style={{
                  width: 30, height: 30, borderRadius: radius.pill, cursor: 'pointer',
                  background: GOOGLE_COLOR_HEX[id],
                  border: on ? `3px solid ${colour.ink}` : `1px solid ${colour.line}`,
                  outline: id === expected ? `2px dashed ${colour.inkFaint}` : 'none',
                  outlineOffset: 2
                }} />
            )
          })}
          {chosen && expected && (
            <button type="button" onClick={onClear}
              style={{
                ...text('caption'), cursor: 'pointer', background: 'none',
                border: `1px solid ${colour.line}`, borderRadius: radius.control,
                padding: `4px ${space.sm}px`, color: colour.inkMuted
              }}>
              Back to automatic
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function EditBooking({ eventId, user, onClose, onSaved }) {
  const [loaded, setLoaded] = useState(null)
  const [fields, setFields] = useState({})
  const [notes, setNotes] = useState('')
  const [when, setWhen] = useState({ date: '', start: '', end: '' })
  const [colorId, setColorId] = useState(null)
  // An explicit pick. Without one the server derives the colour from the
  // surgeon, so sending nothing is how "automatic" is expressed.
  const [colourChosen, setColourChosen] = useState(false)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [titleFix, setTitleFix] = useState(null)

  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}

  const load = useCallback(async () => {
    setStatus('loading'); setError('')
    try {
      const res = await fetch(`/api/calendar/today?action=booking&id=${encodeURIComponent(eventId)}`,
        { headers: auth })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setLoaded(data)
      setFields({ ...data.fields })
      setNotes(data.notes || '')
      const from = civilParts(data.start)
      const to = civilParts(data.end)
      setWhen({ date: from?.date || '', start: from?.time || '', end: to?.time || '' })
      setColorId(data.colorId || null)
      setColourChosen(false)
      setTitleFix(null)
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, user?.token])

  useEffect(() => { load() }, [load])

  const originalWhen = loaded
    ? { date: civilParts(loaded.start)?.date || '', start: civilParts(loaded.start)?.time || '',
        end: civilParts(loaded.end)?.time || '' }
    : null
  const movedTime = Boolean(originalWhen && (
    when.date !== originalWhen.date || when.start !== originalWhen.start || when.end !== originalWhen.end))
  const recoloured = colourChosen

  const changed = loaded && (
    FIELDS.some(f => (fields[f.key] || '') !== (loaded.fields[f.key] || ''))
    || notes !== (loaded.notes || '') || movedTime || recoloured)

  async function save({ withTitle } = {}) {
    setStatus('saving'); setError('')
    try {
      // Only what actually changed. A field sent unchanged is a field that can
      // be reformatted by a round trip for no reason.
      const patch = {}
      for (const f of FIELDS) {
        if ((fields[f.key] || '') !== (loaded.fields[f.key] || '')) patch[f.key] = fields[f.key] || ''
      }

      const res = await fetch('/api/calendar/today?action=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          eventId,
          etag: loaded.etag,
          fields: patch,
          ...(notes !== (loaded.notes || '') ? { notes } : {}),
          // Naive local times plus the zone on the server, never an offset
          // worked out here: the phone's timezone must not move a theatre list.
          ...(movedTime && when.date && when.start && when.end
            ? { start: `${when.date}T${when.start}:00`, end: `${when.date}T${when.end}:00` }
            : {}),
          ...(colourChosen ? { colorId } : {}),
          ...(withTitle ? { summary: withTitle } : {})
        })
      })
      const data = await res.json()

      if (res.status === 409) {
        setStatus('conflict')
        setError('Somebody changed this booking in Google while you had it open.')
        return
      }
      if (data.error) throw new Error(data.error)

      // Offered once the save has landed, so the description is already correct
      // whatever is decided about the title.
      if (!withTitle) {
        const stale = staleTitle(data.event?.summary || loaded.summary, loaded.fields, fields)
        if (stale) {
          setLoaded({ ...loaded, ...data.event, fields: { ...fields }, notes })
          setTitleFix(stale)
          setStatus('ready')
          onSaved?.()
          return
        }
      }

      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message)
      setStatus('ready')
    }
  }

  return (
    <Overlay>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }}>
        <div
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-label="Edit booking"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 460,
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
            maxHeight: '88vh', display: 'flex', flexDirection: 'column'
          }}>

          <div style={{
            padding: `${space.md}px ${space.md}px ${space.sm}px`,
            borderBottom: `1px solid ${colour.line}`, flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
              <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Edit booking</span>
              <button onClick={onClose} aria-label="Close"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  ...text('body'), color: colour.inkFaint, padding: space.xs
                }}>Close</button>
            </div>
            {loaded?.summary && (
              <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>
                {loaded.summary}
              </div>
            )}
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', flex: 1 }}>
            {status === 'loading' && (
              <div style={{ ...text('body'), color: colour.inkFaint, textAlign: 'center', padding: space.lg }}>
                Loading the booking…
              </div>
            )}

            {error && (
              <div style={{
                background: status === 'conflict' ? colour.warningSoft : colour.dangerSoft,
                border: `1px solid ${status === 'conflict' ? colour.warningLine : colour.dangerLine}`,
                color: status === 'conflict' ? colour.warning : colour.danger,
                borderRadius: radius.control, padding: space.sm, marginBottom: space.md,
                ...text('caption')
              }}>
                {error}
                {status === 'conflict' && (
                  <div style={{ marginTop: space.sm }}>
                    <button onClick={load}
                      style={{
                        ...text('caption'), fontWeight: 700, cursor: 'pointer',
                        background: 'none', border: `1px solid ${colour.warningLine}`,
                        borderRadius: radius.control, padding: `4px ${space.sm}px`,
                        color: colour.warning
                      }}>
                      Reload theirs and start again
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Proposed after a save, never applied without being asked. */}
            {titleFix && (
              <div style={{
                background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
                borderRadius: radius.control, padding: space.sm, marginBottom: space.md
              }}>
                <div style={{ ...text('caption'), color: colour.warning, fontWeight: 700 }}>
                  Saved. The title still says “{titleFix.was}”.
                </div>
                <div style={{ ...text('caption'), color: colour.inkMuted, margin: `${space.xs}px 0` }}>
                  {titleFix.proposed}
                </div>
                <div style={{ display: 'flex', gap: space.sm }}>
                  <button onClick={() => save({ withTitle: titleFix.proposed })}
                    style={{
                      ...text('caption'), fontWeight: 700, cursor: 'pointer', color: 'white',
                      background: colour.accent, border: 'none',
                      borderRadius: radius.control, padding: `6px ${space.md}px`
                    }}>Update title</button>
                  <button onClick={() => { setTitleFix(null); onClose?.() }}
                    style={{
                      ...text('caption'), cursor: 'pointer', color: colour.inkMuted,
                      background: 'none', border: `1px solid ${colour.line}`,
                      borderRadius: radius.control, padding: `6px ${space.md}px`
                    }}>Leave it</button>
                </div>
              </div>
            )}

            {loaded && status !== 'loading' && !loaded.allDay && (
              <>
                <Field label="Date" type="date" value={when.date}
                  onChange={v => setWhen(c => ({ ...c, date: v }))} />
                <div style={{ display: 'flex', gap: space.sm }}>
                  <div style={{ flex: 1 }}>
                    <Field label="Start" type="time" value={when.start}
                      onChange={v => setWhen(c => ({ ...c, start: v }))} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Field label="Finish" type="time" value={when.end}
                      onChange={v => setWhen(c => ({ ...c, end: v }))} />
                  </div>
                </div>
                {movedTime && (
                  <div style={{ ...text('caption'), color: colour.accentDeep, marginTop: -space.sm, marginBottom: space.md }}>
                    Moving this booking to {when.date} · {when.start}–{when.end}, Hobart time.
                  </div>
                )}
              </>
            )}

            {loaded && status !== 'loading' && (
              <>
                {FIELDS.map((f, i) => (
                  <Field key={f.key} label={f.label} hint={f.hint} autoFocus={i === 0}
                    value={fields[f.key] || ''}
                    onChange={v => setFields(c => ({ ...c, [f.key]: v }))} />
                ))}

                <label style={{ display: 'block', marginBottom: space.md }}>
                  <span style={{
                    ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
                    display: 'block', marginBottom: 4
                  }}>Notes</span>
                  <textarea
                    value={notes}
                    rows={4}
                    onChange={e => setNotes(e.target.value)}
                    style={{
                      width: '100%', padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
                      border: `1px solid ${colour.line}`, borderRadius: radius.control,
                      ...text('body'), color: colour.ink, background: colour.surface,
                      outline: 'none', resize: 'vertical', fontFamily: 'inherit'
                    }} />
                  <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 2 }}>
                    Why it moved, who called it in, what still has to be ordered
                  </span>
                </label>

                <ColourPicker
                  value={colorId}
                  surgeon={fields.surgeon}
                  chosen={colourChosen}
                  onChange={id => { setColorId(id); setColourChosen(true) }}
                  onClear={() => { setColourChosen(false); setColorId(loaded.colorId || null) }} />
              </>
            )}
          </div>

          <div style={{
            padding: `${space.sm}px ${space.md}px calc(${space.md}px + env(safe-area-inset-bottom, 0px))`,
            borderTop: `1px solid ${colour.line}`, display: 'flex', gap: space.sm, flexShrink: 0
          }}>
            <button onClick={onClose}
              style={{
                flex: 1, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
                background: 'transparent', color: colour.inkMuted,
                border: `1px solid ${colour.line}`, borderRadius: radius.control
              }}>Cancel</button>
            <button onClick={() => save()}
              disabled={!changed || status === 'saving' || status === 'loading'}
              style={{
                flex: 2, padding: space.sm, ...text('bodyStrong'), color: 'white', border: 'none',
                borderRadius: radius.control,
                background: (!changed || status === 'saving') ? colour.inkFainter : colour.accent,
                cursor: (!changed || status === 'saving') ? 'default' : 'pointer'
              }}>
              {status === 'saving' ? 'Saving…' : 'Save to calendar'}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
