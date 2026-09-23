import React, { useState, useMemo } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { SURGEON_COLOUR_NAMES, GOOGLE_COLOR_HEX, guideColorIdFor } from '../../clinicalPlan/colours.js'
import { INVENTORY, loanNeed, kitArrivalBy } from '../../clinicalPlan/inventory.js'
import { todayStr, parseDateStr, toDateStr, addCivilDays, civilWeekday, weekdayName } from '../../clinicalPlan/week.js'

// ─── Adding a booking ─────────────────────────────────────────────────────────
// Meant to beat typing it into Google, which is the thing it replaces.
//
// So: taps rather than words. Surgeon, hospital, system and supply are all
// chosen from what the app already knows, and the only free text is a surname
// and the procedure. A booking is two taps, a date and two short phrases.
//
// No time. Case timings are not settled until the list order lands the evening
// before and then move several times a day, so a time entered now is wrong
// almost immediately. The booking is created spanning the list — 08:00 to 17:00,
// which is what the RHH lists themselves say — and the app never shows it.
//
// The loan verdict appears the moment a system and hospital are chosen, because
// that is the question the booking actually raises and the one that is expensive
// to get wrong: a Mariner at Calvary needs a set ordered, and nobody should have
// to remember that.

const SURGEONS = Object.keys(SURGEON_COLOUR_NAMES).sort()
const SYSTEMS = INVENTORY.filter(i => !i.competitor).map(i => i.system)
const HOSPITALS = [{ id: 'RHH', label: 'RHH' }, { id: 'CLV', label: 'Calvary' }]
const SUPPLY = ['Consignment', 'Loan']

/** The next weekday, since a booking is far more often ahead than today. */
function defaultDate() {
  let civil = parseDateStr(todayStr())
  civil = addCivilDays(civil, 1)
  while (civilWeekday(civil) >= 6) civil = addCivilDays(civil, 1)
  return toDateStr(civil)
}

function Label({ children }) {
  return (
    <span style={{
      ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
      display: 'block', marginBottom: 4
    }}>{children}</span>
  )
}

/** A labelled control. The label wraps it, so the field has a name. */
function Row({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: space.md }}>
      <Label>{label}</Label>
      {children}
      {hint && (
        <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 2 }}>
          {hint}
        </span>
      )}
    </label>
  )
}

const inputStyle = {
  width: '100%', padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
  border: `1px solid ${colour.line}`, borderRadius: radius.control,
  ...text('body'), color: colour.ink, background: colour.surface, outline: 'none'
}

/** A row of choices. Cheaper than a dropdown when there are only a few. */
function Choice({ options, value, onChange, idOf = o => o, labelOf = o => o }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(option => {
        const id = idOf(option)
        const on = value === id
        return (
          <button key={id} type="button" onClick={() => onChange(on ? '' : id)}
            aria-pressed={on}
            style={{
              padding: `6px ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
              ...text('bodyStrong'),
              background: on ? colour.accent : colour.surface,
              color: on ? 'white' : colour.inkMuted,
              border: `1px solid ${on ? colour.accent : colour.line}`
            }}>
            {labelOf(option)}
          </button>
        )
      })}
    </div>
  )
}

/**
 * What this booking asks of the team, shown as it is being made.
 *
 * The inventory knows what is consigned where, so the question "does this need a
 * set ordered" can be answered while the booking is being typed rather than
 * discovered later. `unknown` is deliberately loud: a wrong "nothing needed" is
 * a case with no instruments on the day.
 */
function LoanVerdict({ system, hospital, date }) {
  const verdict = useMemo(
    () => (system && hospital ? loanNeed(system, hospital) : null), [system, hospital])
  if (!verdict) return null

  const tone = {
    order: { bg: colour.dangerSoft, line: colour.dangerLine, ink: colour.danger },
    move: { bg: colour.warningSoft, line: colour.warningLine, ink: colour.warning },
    unknown: { bg: colour.warningSoft, line: colour.warningLine, ink: colour.warning },
    none: { bg: colour.accentSoft, line: 'rgba(24,154,133,0.28)', ink: colour.accentDeep }
  }[verdict.need]

  const by = verdict.need === 'order' && date
    ? kitArrivalBy(`${date}T08:00:00+10:00`)
    : null

  return (
    <div style={{
      background: tone.bg, border: `1px solid ${tone.line}`, color: tone.ink,
      borderRadius: radius.control, padding: space.sm, marginBottom: space.md,
      ...text('caption')
    }}>
      <strong>
        {verdict.need === 'order' ? 'A loan set has to be requested'
          : verdict.need === 'move' ? 'Check where the kit is'
            : verdict.need === 'unknown' ? 'Not sure — check this one'
              : 'Nothing to order'}
      </strong>
      <div>{verdict.reason}</div>
      {by && (
        <div style={{ marginTop: 2 }}>
          Kit needs to arrive by <strong>{weekdayName(by.date)} {by.date}, {by.time}</strong>
        </div>
      )}
      {verdict.item?.note && (
        <div style={{ marginTop: 2, opacity: 0.85 }}>{verdict.item.note}</div>
      )}
    </div>
  )
}

export default function NewBooking({ user, onClose, onCreated }) {
  const [date, setDate] = useState(defaultDate)
  const [hospital, setHospital] = useState('')
  const [surgeon, setSurgeon] = useState('')
  const [system, setSystem] = useState('')
  const [supply, setSupply] = useState('')
  const [patient, setPatient] = useState('')
  const [procedure, setProcedure] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('ready')
  const [error, setError] = useState('')

  // Supply follows the inventory unless it has been chosen: a system consigned
  // at that hospital is consignment, and anything else is a loan.
  const suggestedSupply = useMemo(() => {
    if (!system || !hospital) return ''
    const need = loanNeed(system, hospital).need
    return need === 'none' ? 'Consignment' : need === 'order' ? 'Loan' : ''
  }, [system, hospital])
  const effectiveSupply = supply || suggestedSupply

  const colourId = guideColorIdFor(surgeon)
  const ready = patient.trim() && surgeon && date

  async function create() {
    setStatus('saving'); setError('')
    try {
      const kit = [system, effectiveSupply ? `(${effectiveSupply})` : ''].filter(Boolean).join(' ')
      const res = await fetch('/api/calendar/today?action=create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
        },
        body: JSON.stringify({
          date,
          notes,
          fields: {
            patient: patient.trim(),
            surgeon,
            procedure: procedure.trim(),
            kit,
            hospital
          }
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onCreated?.()
      onClose?.()
    } catch (err) {
      setError(err.message)
      setStatus('ready')
    }
  }

  return (
    <Overlay>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
      }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="New booking"
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
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>New booking</span>
            {colourId && (
              <span aria-label="Colour" style={{
                width: 18, height: 18, borderRadius: radius.pill,
                background: GOOGLE_COLOR_HEX[colourId], border: `1px solid ${colour.line}`
              }} />
            )}
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
                padding: space.sm, marginBottom: space.md, ...text('caption')
              }}>{error}</div>
            )}

            <Row label="Date"
              hint={`${date ? weekdayName(date) : ''} · no time — list order lands the evening before`}>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
            </Row>

            <div style={{ marginBottom: space.md }}>
              <Label>Hospital</Label>
              <Choice options={HOSPITALS} value={hospital} onChange={setHospital}
                idOf={h => h.id} labelOf={h => h.label} />
            </div>

            <Row label="Surgeon">
              <select value={surgeon} onChange={e => setSurgeon(e.target.value)} style={inputStyle}>
                <option value="">Choose…</option>
                {SURGEONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Row>

            <Row label="System">
              <select value={system} onChange={e => setSystem(e.target.value)} style={inputStyle}>
                <option value="">Choose…</option>
                {SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Row>

            <LoanVerdict system={system} hospital={hospital} date={date} />

            {system && (
              <div style={{ marginBottom: space.md }}>
                <Label>Supply</Label>
                <Choice options={SUPPLY} value={effectiveSupply} onChange={setSupply} />
              </div>
            )}

            <Row label="Patient surname" hint="Surname only — never a first name or a date of birth">
              <input value={patient} onChange={e => setPatient(e.target.value)} style={inputStyle} />
            </Row>

            <Row label="Procedure">
              <input value={procedure} onChange={e => setProcedure(e.target.value)}
                placeholder="L5/S1 PLIF" style={inputStyle} />
            </Row>

            <Row label="Notes">
              <textarea value={notes} rows={2} onChange={e => setNotes(e.target.value)}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </Row>
          </div>

          <div style={{
            padding: `${space.sm}px ${space.md}px calc(${space.md}px + env(safe-area-inset-bottom, 0px))`,
            borderTop: `1px solid ${colour.line}`, display: 'flex', gap: space.sm, flexShrink: 0
          }}>
            <button onClick={onClose} style={{
              flex: 1, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
              background: 'transparent', color: colour.inkMuted,
              border: `1px solid ${colour.line}`, borderRadius: radius.control
            }}>Cancel</button>
            <button onClick={create} disabled={!ready || status === 'saving'} style={{
              flex: 2, padding: space.sm, ...text('bodyStrong'), color: 'white', border: 'none',
              borderRadius: radius.control,
              background: (!ready || status === 'saving') ? colour.inkFainter : colour.accent,
              cursor: (!ready || status === 'saving') ? 'default' : 'pointer'
            }}>
              {status === 'saving' ? 'Adding…' : 'Add to calendar'}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
