import React, { useState, useMemo } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import DictateBooking from './DictateBooking.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { SURGEON_COLOUR_NAMES, GOOGLE_COLOR_HEX, guideColorIdFor } from '../../clinicalPlan/colours.js'
import { INVENTORY, loanNeed, kitArrivalBy, dayShortfall } from '../../clinicalPlan/inventory.js'
import { systemsInKit } from '../../clinicalPlan/systems.js'
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
  // `field`, not `body` — see the token. An inline 14px here is what makes
  // iOS zoom the whole app on focus.
  ...text('field'), color: colour.ink, background: colour.surface, outline: 'none'
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
        {system}{' — '}
        {verdict.need === 'order' ? 'a loan set has to be requested'
          : verdict.need === 'move' ? 'check where the kit is'
            : verdict.need === 'unknown' ? 'not sure, check this one'
              : 'nothing to order'}
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

/** RHH or CLV, from any of the ways a hospital is written. */
function siteOf(text) {
  const t = String(text || '').toUpperCase()
  if (/\bCLV\b|CALVARY|LENAH/.test(t)) return 'CLV'
  if (/\bRHH\b|ROYAL\s*HOBART/.test(t)) return 'RHH'
  return null
}

export default function NewBooking({ user, date: openOn, alreadyBooked = [], onClose, onCreated }) {
  // Opens on the day being looked at, which is the booking most likely being
  // made. Falls back to the next weekday when opened from nowhere in particular.
  const [date, setDate] = useState(() => openOn || defaultDate())
  const [hospital, setHospital] = useState('')
  const [surgeon, setSurgeon] = useState('')
  // A list, because a real case often needs two: Diplomat with E4 cages, or
  // Athlet and Ascot for a cervical corpectomy. Each carries its own supply —
  // one may be consigned at that hospital while the other has to be ordered —
  // so a single supply for the whole booking would be wrong as often as right.
  const [systems, setSystems] = useState([])
  const [patient, setPatient] = useState('')
  const [procedure, setProcedure] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('ready')
  const [error, setError] = useState('')
  const [dictating, setDictating] = useState(false)

  /**
   * What was dictated, written into the form.
   *
   * Only fields that were actually heard are applied — a booking spoken without
   * a hospital must not blank one the user already chose. The systems come back
   * as names and go through addSystem so each picks up its own supply, exactly
   * as if it had been tapped.
   */
  function applyDictation(f, { andCreate = false } = {}) {
    const spokenSystems = (f.systems || [])
      .filter(name => !systems.some(s => s.name === name))
      .map(name => ({ name, supply: supplyFor(name, f.hospital || hospital) }))

    const extraNotes = [
      f.note,
      // The kit was named but matched nothing we stock — kept as a note rather
      // than dropped, since it may be a competitor's or a new product.
      f.kit && !spokenSystems.length ? `Kit as dictated: ${f.kit}` : null
    ].filter(Boolean)

    if (f.patient) setPatient(f.patient)
    if (f.surgeon) setSurgeon(f.surgeon)
    if (f.date) setDate(f.date)
    if (f.hospital) setHospital(f.hospital)
    if (f.procedure) setProcedure(f.procedure)
    if (extraNotes.length) setNotes(n => [n, ...extraNotes].filter(Boolean).join('\n'))
    if (spokenSystems.length) setSystems(list => [...list, ...spokenSystems])
    setDictating(false)

    // A dictated booking that would leave a case without a kit stops here and
    // shows the form. Speaking it is quicker than typing it; that is not a
    // reason to skip the one warning worth reading.
    const spokenSite = siteOf(f.hospital || hospital)
    const wouldClash = spokenSite && [...systems, ...spokenSystems].some(chosen => {
      const alsoBooked = alreadyBooked.filter(c =>
        siteOf(c.hospital) === spokenSite
        && systemsInKit(`${c.system || ''} ${c.kit || ''}`).includes(chosen.name)).length
      return Boolean(dayShortfall(chosen.name, spokenSite, alsoBooked + 1))
    })

    if (andCreate && !wouldClash) {
      // Sent from the values in hand rather than from state, which has not
      // re-rendered yet.
      create({
        patient: f.patient || patient,
        surgeon: f.surgeon || surgeon,
        date: f.date || date,
        hospital: f.hospital || hospital,
        procedure: f.procedure || procedure,
        notes: [notes, ...extraNotes].filter(Boolean).join('\n'),
        systems: [...systems, ...spokenSystems]
      })
    }
  }

  /**
   * What the inventory says this system is, at this hospital.
   *
   * `at` overrides the chosen hospital, which dictation needs: it sets the
   * hospital and the systems in the same tick, so reading the hospital from
   * state here would still see the old one and leave the supply blank.
   */
  const supplyFor = (name, at = hospital) => {
    if (!at) return ''
    const need = loanNeed(name, at).need
    return need === 'none' ? 'Consignment' : need === 'order' ? 'Loan' : ''
  }

  function addSystem(name) {
    if (!name || systems.some(s => s.name === name)) return
    setSystems(list => [...list, { name, supply: supplyFor(name) }])
  }

  /**
   * Systems this booking needs that the hospital does not have enough of on the
   * day, counting what is already booked.
   *
   * The case that prompted this: a second Diplomat at RHH on a Friday, where
   * there is one Diplomat. Both said "Consignment" and were booked without a
   * murmur, and one of them had no kit.
   */
  const shortfalls = useMemo(() => {
    const site = siteOf(hospital)
    if (!site) return []
    return systems.map(chosen => {
      const alsoBooked = alreadyBooked.filter(c =>
        siteOf(c.hospital) === site
        && systemsInKit(`${c.system || ''} ${c.kit || ''}`).includes(chosen.name)).length
      return dayShortfall(chosen.name, site, alsoBooked + 1)
    }).filter(Boolean)
  }, [systems, hospital, alreadyBooked])

  const colourId = guideColorIdFor(surgeon)
  const ready = patient.trim() && surgeon && date

  /**
   * @param {object} [over] values to send instead of what is on screen.
   *
   * Dictation needs this: setting six pieces of state and then reading them
   * back in the same tick returns the old ones, so a spoken booking sent
   * straight from the panel would post an empty form.
   */
  async function create(over = {}) {
    setStatus('saving'); setError('')
    try {
      const use = {
        date, notes, patient, surgeon, procedure, hospital, systems, ...over
      }
      // "Diplomat (Consignment) + Global BMD PLIF (Loan)" — each system with the
      // supply that actually applies to it.
      const kit = use.systems
        .map(s => [s.name, s.supply ? `(${s.supply})` : ''].filter(Boolean).join(' '))
        .join(' + ')
      const res = await fetch('/api/calendar/today?action=create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
        },
        body: JSON.stringify({
          date: use.date,
          notes: use.notes,
          fields: {
            patient: String(use.patient || '').trim(),
            surgeon: use.surgeon,
            procedure: String(use.procedure || '').trim(),
            kit,
            hospital: use.hospital
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
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>New booking</span>
            {!dictating && (
              <button onClick={() => setDictating(true)} aria-label="Speak the booking"
                style={{
                  background: 'none', border: `1px solid ${colour.line}`,
                  borderRadius: radius.pill, padding: `4px ${space.sm}px`,
                  cursor: 'pointer', ...text('caption'), color: colour.inkMuted
                }}>
                🎤 Speak
              </button>
            )}
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
            {dictating && (
              <DictateBooking
                user={user}
                onFilled={applyDictation}
                onClose={() => setDictating(false)} />
            )}
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

            <div style={{ marginBottom: space.md }}>
              <Label>Systems</Label>

              {systems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: space.sm }}>
                  {systems.map(chosen => (
                    <div key={chosen.name} style={{
                      display: 'flex', alignItems: 'center', gap: space.sm,
                      background: colour.surface, border: `1px solid ${colour.line}`,
                      borderRadius: radius.control, padding: `6px ${space.sm}px 6px ${space.md}px`
                    }}>
                      <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0 }}>
                        {chosen.name}
                      </span>
                      {/* Supply per system: one may be consigned here while the
                          other has to be ordered. */}
                      <Choice options={SUPPLY} value={chosen.supply}
                        onChange={value => setSystems(list => list.map(
                          s => s.name === chosen.name ? { ...s, supply: value } : s))} />
                      <button type="button" aria-label={`Remove ${chosen.name}`}
                        onClick={() => setSystems(list => list.filter(s => s.name !== chosen.name))}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          ...text('body'), color: colour.inkFainter, padding: '0 4px'
                        }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              <select value="" onChange={e => addSystem(e.target.value)} style={inputStyle}
                aria-label="Add a system">
                <option value="">{systems.length ? 'Add another system…' : 'Choose a system…'}</option>
                {SYSTEMS.filter(s => !systems.some(c => c.name === s))
                  .map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* One verdict per system, because they can differ: Diplomat may be
                consigned at Calvary while the E4 cages have to come from a loan
                set. A single combined answer would hide the one that matters. */}
            {systems.map(chosen => (
              <LoanVerdict key={chosen.name} system={chosen.name} hospital={hospital} date={date} />
            ))}

            {/* Louder than the per-system verdict, because it contradicts it: a
                kit can be consigned at the hospital and still be spoken for. */}
            {shortfalls.map(short => (
              <div key={short.system} style={{
                background: colour.dangerSoft, border: `1px solid ${colour.dangerLine}`,
                borderRadius: radius.control, padding: space.sm, marginBottom: space.sm
              }}>
                <div style={{ ...text('bodyStrong'), color: colour.danger }}>
                  {short.from
                    ? `Borrow a ${short.system} kit from ${short.from}`
                    : `A ${short.system} loan set is needed`}
                </div>
                <div style={{ ...text('caption'), color: colour.ink, marginTop: 2 }}>
                  {short.reason}
                </div>
              </div>
            ))}

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
