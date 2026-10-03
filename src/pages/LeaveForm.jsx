import React, { useState, useEffect, useId, useRef } from 'react'
import axios from 'axios'
import { Page, Header } from '../design/Shell.jsx'
import { colour as tokenColour } from '../design/tokens.js'
import { workingDaysBetween } from '../clinicalPlan/toil.js'

// ─── Applying for leave ──────────────────────────────────────────────────────
// Four steps: when, what kind, why, and a look at it before it goes.
//
// It used to be three plain white boxes on a white page — the dates with no
// sense of how long that actually was, the types as a bare list, and a review
// card that looked like a different app from the timesheet next door. The
// steps were right; everything around them was doing nothing.
//
// The palette is the timesheet's, pointed at the shared tokens, so the two
// screens somebody uses in the same minute look like one app.

const NAVY = tokenColour.navy
const TEAL = tokenColour.accent
const MUTED = tokenColour.inkFaint
const BORDER = tokenColour.line
const CANVAS = tokenColour.canvas

const LEAVE_TYPES = [
  {
    id: 'ANNUAL_LEAVE', label: 'Annual Leave', icon: '🏖',
    desc: 'Planned holiday or time off'
  },
  {
    id: 'SICK', label: 'Personal / Sick Leave', icon: '🩺',
    desc: 'Illness, injury or personal circumstances'
  },
  {
    id: 'TOIL', label: 'Time Off In Lieu', icon: '⏳',
    desc: 'Using time accrued from overtime'
  }
]

const STEPS = ['When', 'What kind', 'Why', 'Check it']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STANDARD_DAY = 7.6

function fmt(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`
}

/** The working day after a date — the obvious return date, offered not forced. */
function nextWorkingDay(date) {
  if (!date) return ''
  const at = new Date(`${date}T00:00:00Z`)
  do { at.setUTCDate(at.getUTCDate() + 1) } while ([0, 6].includes(at.getUTCDay()))
  return at.toISOString().slice(0, 10)
}

/**
 * A labelled control.
 *
 * The label is tied to the input with a real id. Before this they were simply
 * next to each other, so tapping the word did not focus the field and a screen
 * reader read an orphaned label followed by an unnamed date picker — on a form
 * whose whole job is three dates.
 */

/**
 * Opens a date field's own picker.
 *
 * showPicker() is the only way to raise the native calendar without somebody
 * tapping the field, and it is fussy: it needs recent user activation, and it
 * throws rather than returning false when it does not have it. Choosing a date
 * counts as activation on the browsers that matter, but Safari has been
 * inconsistent about it and a thrown error would take the whole handler down —
 * including the date that was just chosen.
 *
 * So every failure falls back to focusing the field, which is where somebody
 * would have tapped anyway. The worst case is the old behaviour.
 */
function openDatePicker(input) {
  if (!input) return
  try {
    if (typeof input.showPicker === 'function') {
      input.showPicker()
      return
    }
  } catch {
    // No activation, or a browser that refuses. Fall through.
  }
  try { input.focus() } catch { /* nothing left to try */ }
}

function Field({ label, hint, children }) {
  const id = useId()
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id}
        style={{ display: 'block', fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: hint ? 2 : 6 }}>
        {label}
      </label>
      {hint && <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>{hint}</div>}
      {React.cloneElement(React.Children.only(children), { id })}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '13px 14px', border: `1px solid ${BORDER}`,
  borderRadius: 10, fontSize: 16, background: 'white', color: NAVY,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  appearance: 'none', WebkitAppearance: 'none'
}

/** A white card, which is the shape every other screen in the app uses. */
function Card({ children, style }) {
  return (
    <div style={{
      background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12,
      padding: 16, marginBottom: 12, ...style
    }}>{children}</div>
  )
}

export default function LeaveForm({ user, onSuccess, onBack }) {
  const [step, setStep] = useState(0)
  // The last-day field, so choosing the first day can open its picker rather
  // than closing one calendar and making somebody find and tap another.
  const lastDay = useRef(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // What they have in the TOIL bank, so choosing TOIL is an informed choice
  // rather than a guess followed by an email from Brent.
  const [toil, setToil] = useState(null)
  const staffMember = user?.staff || user
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    division: staffMember?.division || '',
    role: staffMember?.role || '',
    startDate: '', endDate: '', returnDate: '', leaveType: '', reason: ''
  })

  useEffect(() => {
    if (!user?.token) return
    fetch('/api/timesheet/agent?action=toil', {
      headers: { Authorization: `Bearer ${user.token}` }
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setToil(d?.me || null))
      // Somebody not on timesheets has no TOIL and the endpoint says so. That
      // is not an error worth showing on a leave form.
      .catch(() => {})
  }, [user?.token])

  function setField(f, v) {
    setForm(p => {
      const next = { ...p, [f]: v }
      // The return date is the working day after the last day, nine times out
      // of ten. Filled in when the last day is chosen, and still editable —
      // offered rather than decided.
      if (f === 'endDate' && v && (!p.returnDate || p.returnDate <= v)) {
        next.returnDate = nextWorkingDay(v)
      }
      if (f === 'startDate' && v && p.endDate && p.endDate < v) {
        next.endDate = ''
        next.returnDate = ''
      }
      return next
    })
  }

  function validate() {
    if (step === 0) {
      if (!form.startDate) return 'Pick your first day of leave'
      if (!form.endDate) return 'Pick your last day of leave'
      if (!form.returnDate) return 'Pick the day you are back at work'
      if (form.endDate < form.startDate) return 'The last day cannot be before the first'
      if (form.returnDate <= form.endDate) return 'You come back after your last day of leave'
    }
    if (step === 1 && !form.leaveType) return 'Choose a type of leave'
    if (step === 2 && !form.reason.trim()) return 'A short reason, so management know what it is for'
    return ''
  }

  function next() {
    const err = validate()
    if (err) { setError(err); return }
    setError(''); setStep(s => s + 1)
  }

  function back() { setError(''); setStep(s => s - 1) }

  function submit() {
    setSubmitting(true); setError('')
    axios.post('/api/submit', form, {
      headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
    })
      .then(() => { if (onSuccess) onSuccess(form) })
      .catch(e => {
        setError(e.response?.data?.error || 'That did not send. Try again in a moment.')
        setSubmitting(false)
      })
  }

  const days = form.startDate && form.endDate
    ? workingDaysBetween(form.startDate, form.endDate)
    : 0
  const chosen = LEAVE_TYPES.find(t => t.id === form.leaveType)
  const toilHours = toil?.balance ?? null
  const toilShort = form.leaveType === 'TOIL' && toilHours != null
    && days * STANDARD_DAY > toilHours

  return (
    <Page style={{ display: 'flex', flexDirection: 'column' }}>
      <Header
        eyebrow="Leave application"
        title={STEPS[step]}
        onBack={step === 0 ? onBack : back}>
        {/* Four pills rather than a progress bar. A bar says how far along you
            are; these say what the steps are and which one you are on, which
            is the thing somebody actually wants to know. */}
        <div style={{ display: 'flex', gap: 6 }}>
          {STEPS.map((label, i) => (
            <div key={label} style={{
              flex: 1, textAlign: 'center', padding: '5px 0', borderRadius: 999,
              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.2px',
              background: i === step ? 'white' : i < step ? 'rgba(42,181,160,0.35)' : 'rgba(255,255,255,0.14)',
              color: i === step ? NAVY : 'rgba(255,255,255,0.85)'
            }}>
              {i < step ? '✓' : label}
            </div>
          ))}
        </div>
      </Header>

      <div className="tm-measure" style={{ flex: 1, padding: '16px 16px 150px', background: CANVAS }}>

        {step === 0 && (
          <>
            <Card>
              <Field label="First day of leave">
                <input type="date" style={inputStyle} value={form.startDate}
                  onChange={e => {
                    setField('startDate', e.target.value)
                    // Straight on to the last day. Nobody picks a first day of
                    // leave and then stops — the calendar closing only to make
                    // them hunt for the next field was two taps for nothing.
                    if (e.target.value) {
                      // After this render, so the field exists and any `min`
                      // the new start date implies is already on it.
                      requestAnimationFrame(() => openDatePicker(lastDay.current))
                    }
                  }} />
              </Field>
              <Field label="Last day of leave">
                <input ref={lastDay} type="date" style={inputStyle} value={form.endDate}
                  min={form.startDate}
                  onChange={e => setField('endDate', e.target.value)} />
              </Field>
              <Field label="Back at work" hint="Filled in for you — change it if you are back later.">
                <input type="date" style={inputStyle} value={form.returnDate} min={form.endDate}
                  onChange={e => setField('returnDate', e.target.value)} />
              </Field>
            </Card>

            {/* How long that actually is. Three date boxes do not answer it,
                and it is the number somebody is doing in their head. */}
            {days > 0 && (
              <div style={{
                background: '#e6f4f2', border: '1px solid rgba(42,181,160,0.3)',
                borderRadius: 12, padding: '14px 16px', display: 'flex',
                alignItems: 'baseline', justifyContent: 'space-between', gap: 12
              }}>
                <span style={{ fontSize: 12.5, color: NAVY, lineHeight: 1.45 }}>
                  {fmt(form.startDate)} — {fmt(form.endDate)}
                  <span style={{ display: 'block', color: MUTED, fontSize: 12.5 }}>
                    Weekends not counted
                  </span>
                </span>
                <strong style={{ fontSize: 22, color: TEAL, whiteSpace: 'nowrap' }}>
                  {days} day{days === 1 ? '' : 's'}
                </strong>
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            {LEAVE_TYPES.map(t => {
              const on = form.leaveType === t.id
              return (
                <button key={t.id} onClick={() => setField('leaveType', t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, width: '100%',
                    padding: 16, marginBottom: 10, textAlign: 'left', cursor: 'pointer',
                    boxSizing: 'border-box', borderRadius: 12,
                    border: `1.5px solid ${on ? TEAL : BORDER}`,
                    background: on ? '#e6f4f2' : 'white'
                  }}>
                  <span style={{ fontSize: 26, lineHeight: 1 }} aria-hidden="true">{t.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 16, fontWeight: 700, color: NAVY }}>
                      {t.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                      {t.desc}
                      {t.id === 'TOIL' && toilHours != null && (
                        <> · <strong style={{ color: TEAL }}>{toilHours}h in the bank</strong></>
                      )}
                    </span>
                  </span>
                  <span style={{
                    width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                    border: `1.5px solid ${on ? TEAL : BORDER}`,
                    background: on ? TEAL : 'transparent', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12.5, fontWeight: 700
                  }}>{on ? '✓' : ''}</span>
                </button>
              )
            })}

            {/* Said here, where the choice is made, rather than discovered
                afterwards by email. It does not block the application —
                Brent decides, not the app. */}
            {toilShort && (
              <div style={{
                background: '#fff4e5', border: '1px solid #f0c187', borderRadius: 10,
                padding: '12px 14px', fontSize: 12.5, color: '#8a5200', lineHeight: 1.5
              }}>
                That is about {Math.round(days * STANDARD_DAY)} hours and you have {toilHours}h
                accrued. You can still apply — management will sort out the difference.
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <Card>
              <Field label="Reason" hint="One line is plenty. It goes in the email to management.">
                <textarea
                  style={{ ...inputStyle, minHeight: 110, lineHeight: 1.6, resize: 'none' }}
                  placeholder="Family holiday · medical procedure · moving house"
                  value={form.reason}
                  onChange={e => setField('reason', e.target.value)} />
              </Field>
            </Card>
            <div style={{
              background: 'rgba(42,181,160,0.07)', border: '1px solid rgba(42,181,160,0.18)',
              borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: MUTED, lineHeight: 1.6
            }}>
              🔒 Nothing is confirmed until management review it.
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{
              background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12,
              overflow: 'hidden', marginBottom: 12
            }}>
              <div style={{
                background: NAVY, padding: '12px 16px', display: 'flex',
                alignItems: 'center', justifyContent: 'space-between', gap: 12
              }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>
                  {chosen?.icon} {chosen?.label}
                </span>
                <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)' }}>
                  {days} day{days === 1 ? '' : 's'}
                </span>
              </div>
              {[
                ['Employee', form.name],
                ['Division', form.division],
                ['First day', fmt(form.startDate)],
                ['Last day', fmt(form.endDate)],
                ['Back at work', fmt(form.returnDate)],
                ['Reason', form.reason]
              ].map(([label, value]) => (
                <div key={label} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 14,
                  padding: '11px 16px', borderTop: `1px solid ${BORDER}`
                }}>
                  <span style={{ fontSize: 12.5, color: MUTED, flexShrink: 0 }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: NAVY, textAlign: 'right' }}>
                    {value || '—'}
                  </span>
                </div>
              ))}
            </div>
            <div style={{
              background: 'rgba(42,181,160,0.07)', border: '1px solid rgba(42,181,160,0.18)',
              borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: MUTED, lineHeight: 1.6
            }}>
              📧 Management will be notified and will review it.
            </div>
          </>
        )}

        {error && (
          <div style={{
            background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 10,
            padding: '12px 14px', fontSize: 12.5, color: '#c0392b', marginTop: 12
          }}>{error}</div>
        )}
      </div>

      {/* tm-fixed, so this spans the content area on a desktop instead of
          sitting in a 430px strip down the middle of the window. */}
      <div className="tm-fixed" style={{
        position: 'fixed', bottom: 'calc(70px + env(safe-area-inset-bottom, 0px))',
        display: 'flex', gap: 10, padding: '12px 16px', background: 'white',
        borderTop: `1px solid ${BORDER}`, boxSizing: 'border-box', zIndex: 90
      }}>
        {step > 0 && (
          <button onClick={back} disabled={submitting}
            style={{
              flex: 1, padding: 14, borderRadius: 10, border: `1px solid ${BORDER}`,
              background: 'transparent', fontSize: 16, fontWeight: 600,
              color: MUTED, cursor: 'pointer'
            }}>
            Back
          </button>
        )}
        {step < STEPS.length - 1
          ? (
            <button onClick={next}
              style={{
                flex: 2, padding: 14, borderRadius: 10, border: 'none', background: NAVY,
                fontSize: 16, fontWeight: 700, color: 'white', cursor: 'pointer'
              }}>
              Continue
            </button>
          )
          : (
            <button onClick={submit} disabled={submitting}
              style={{
                flex: 2, padding: 14, borderRadius: 10, border: 'none',
                background: submitting ? '#c8d2dc' : TEAL,
                fontSize: 16, fontWeight: 700, color: 'white',
                cursor: submitting ? 'default' : 'pointer'
              }}>
              {submitting ? 'Sending…' : 'Submit application'}
            </button>
          )}
      </div>
    </Page>
  )
}
