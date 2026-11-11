import React, { useState, useEffect, useId, useRef } from 'react'
import axios from 'axios'
import { Page, Header } from '../design/Shell.jsx'
import { colour as tokenColour } from '../design/tokens.js'
import { workingDaysBetween } from '../clinicalPlan/toil.js'
import DateRange from './leave/DateRange.jsx'
import { useIsDesktop } from '../design/viewport.js'
import { workPatternFor } from '../staffConfig.js'
import { leaveDays, totalHours } from '../leaveHours.js'

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
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function weekdayOf(date) {
  return WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]
}

/**
 * The hours each day of leave is worth, for somebody who is not on five
 * standard days. Filled in from their pattern, every one editable — a part
 * day is a change to one number. See src/leaveHours.js.
 */
function HoursCard({ pattern, days, onChange }) {
  const flexible = pattern.kind === 'flexible'
  const total = totalHours(days)
  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Hours</div>
      <div style={{ fontSize: 12.5, color: MUTED, margin: '2px 0 10px' }}>
        {flexible
          ? `Your days change, so enter the hours you would have worked each day (${pattern.weeklyHours} a week). Leave the others at 0.`
          : 'Your usual hours are filled in. Change a day for a part day, or set a public holiday to 0.'}
      </div>
      {days.map(day => (
        <div key={day.date} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
          borderTop: `1px solid ${BORDER}`
        }}>
          <span style={{ flex: 1, fontSize: 14, color: NAVY }}>
            {weekdayOf(day.date)} {fmt(day.date)}
          </span>
          <input type="number" inputMode="decimal" min="0" max="12" step="0.25"
            aria-label={`Hours on ${weekdayOf(day.date)} ${fmt(day.date)}`}
            value={day.hours}
            onChange={e => onChange(day.date, e.target.value)}
            style={{ ...inputStyle, width: 90, padding: '8px 10px', textAlign: 'right' }} />
          <span style={{ fontSize: 12.5, color: MUTED }}>h</span>
        </div>
      ))}
      <div style={{
        display: 'flex', justifyContent: 'space-between', paddingTop: 8,
        borderTop: `1px solid ${BORDER}`, fontSize: 14, fontWeight: 700, color: NAVY
      }}>
        <span>Total</span><span>{total}h</span>
      </div>
    </Card>
  )
}

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
  const desktop = useIsDesktop()
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
  // Part-time staff state their leave in hours. Everybody else keeps the plain
  // date range, which Xero already gets right for a standard week.
  const ownPattern = workPatternFor(user?.email)
  const [hours, setHours] = useState([])
  // A full-time person's part days (Brent, 11 Nov 2026: Aimee's 10.5 hours of
  // annual leave). Off by default — most leave is whole days — and when on,
  // every day is listed at 7.6 to change.
  const [partDays, setPartDays] = useState(false)
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

  // TOIL is held in hours, so it is always applied for in hours — a part day
  // is the common case. A standard 7.6 Mon–Fri for anybody without a pattern
  // of their own, every day of it editable.
  const pattern = ownPattern
    || (form.leaveType === 'TOIL' || partDays ? { kind: 'fixed', days: [STANDARD_DAY, STANDARD_DAY, STANDARD_DAY, STANDARD_DAY, STANDARD_DAY, 0, 0] } : null)

  // Re-laid when the dates change, keeping anything already typed for a day
  // that is still in the range.
  useEffect(() => {
    if (!pattern) return
    setHours(current => {
      const typed = new Map(current.map(d => [d.date, d.hours]))
      return leaveDays(form.startDate, form.endDate, pattern)
        .map(d => (typed.has(d.date) ? { ...d, hours: typed.get(d.date) } : d))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.startDate, form.endDate, Boolean(pattern)])

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
      if (ownPattern || partDays) {
        if (hours.some(d => !(Number(d.hours) >= 0 && Number(d.hours) <= 12))) {
          return 'Each day must be between 0 and 12 hours'
        }
        if (!(totalHours(hours) > 0)) return 'Enter the hours you would have worked on at least one day'
      }
    }
    if (step === 1 && !form.leaveType) return 'Choose a type of leave'
    if (step === 1 && pattern && !ownPattern && !partDays) {
      if (hours.some(d => !(Number(d.hours) >= 0 && Number(d.hours) <= 12))) {
        return 'Each day must be between 0 and 12 hours'
      }
      if (!(totalHours(hours) > 0)) return 'Enter the TOIL hours for at least one day'
    }
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
    const body = pattern
      ? { ...form, hours: hours.filter(d => Number(d.hours) > 0).map(d => ({ date: d.date, hours: Number(d.hours) })) }
      : form
    axios.post('/api/submit', body, {
      headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
    })
      .then(() => { if (onSuccess) onSuccess(form) })
      .catch(e => {
        setError(e.response?.data?.error || 'That did not send. Try again in a moment.')
        setSubmitting(false)
      })
  }

  // A form is not a week grid. The 1400px measure that lets seven columns
  // breathe turns a leave application into one narrow card adrift in an acre
  // of empty page, which is what this looked like.
  const column = desktop ? 940 : undefined

  const days = form.startDate && form.endDate
    ? workingDaysBetween(form.startDate, form.endDate)
    : 0
  const chosen = LEAVE_TYPES.find(t => t.id === form.leaveType)
  const toilHours = toil?.bank ?? toil?.balance ?? null
  // The hours this leave comes to: stated, for part-time staff; a standard
  // day per working day for everyone else.
  const leaveHoursTotal = pattern ? totalHours(hours) : days * STANDARD_DAY
  const toilShort = form.leaveType === 'TOIL' && toilHours != null
    && leaveHoursTotal > toilHours

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

      <div className="tm-measure" style={{
        flex: 1, background: CANVAS, maxWidth: column, boxSizing: 'border-box',
        // No room reserved for a pinned bar on a desktop, because there is no
        // pinned bar there — the buttons are the end of the form.
        padding: desktop ? '20px 20px 40px' : '16px 16px 150px'
      }}>

        {step === 0 && (
          <>
            {/* Ours, not the operating system's. Two native pickers could
                not say which day they were asking for — a native picker has
                no title — so the jump from the first day to the last was a
                calendar blinking and reopening, and nothing else. */}
            <DateRange
              start={form.startDate}
              end={form.endDate}
              onChange={({ start, end }) => {
                setForm(p => ({
                  ...p,
                  startDate: start,
                  endDate: end,
                  // Still offered rather than decided, and still editable.
                  returnDate: end ? nextWorkingDay(end) : ''
                }))
                setError('')
              }} />

            {ownPattern && form.endDate && (
              <HoursCard pattern={pattern} days={hours}
                onChange={(date, value) => setHours(list => list.map(
                  d => (d.date === date ? { ...d, hours: value } : d)))} />
            )}

            {/* Part days for anybody on a standard week (Brent, 11 Nov 2026). */}
            {!ownPattern && form.endDate && (
              <Card>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: NAVY, cursor: 'pointer' }}>
                  <input type="checkbox" checked={partDays} data-part-days
                    onChange={e => setPartDays(e.target.checked)} style={{ width: 20, height: 20, fontSize: 16 }} />
                  <span>
                    <strong>Any part days?</strong>
                    <span style={{ display: 'block', fontSize: 12.5, color: MUTED }}>Set the hours for each day instead of whole days</span>
                  </span>
                </label>
              </Card>
            )}
            {!ownPattern && partDays && form.endDate && (
              <HoursCard pattern={pattern} days={hours}
                onChange={(date, value) => setHours(list => list.map(
                  d => (d.date === date ? { ...d, hours: value } : d)))} />
            )}

            {form.endDate && (
              <Card>
                <Field label="Back at work" hint="Filled in for you — change it if you are back later.">
                  <input type="date" style={inputStyle} value={form.returnDate}
                    min={form.endDate}
                    onChange={e => setField('returnDate', e.target.value)} />
                </Field>
              </Card>
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

            {/* TOIL in hours for somebody on a standard week: here, once
                they have said it is TOIL. Part-time staff already set their
                hours on the first step. */}
            {form.leaveType === 'TOIL' && !ownPattern && !partDays && form.endDate && (
              <HoursCard pattern={pattern} days={hours}
                onChange={(date, value) => setHours(list => list.map(
                  d => (d.date === date ? { ...d, hours: value } : d)))} />
            )}

            {/* Said here, where the choice is made, rather than discovered
                afterwards by email. It does not block the application —
                Brent decides, not the app. */}
            {toilShort && (
              <div style={{
                background: '#fff4e5', border: '1px solid #f0c187', borderRadius: 10,
                padding: '12px 14px', fontSize: 12.5, color: '#8a5200', lineHeight: 1.5
              }}>
                That is about {Math.round(leaveHoursTotal * 10) / 10} hours and you have {toilHours}h
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
                  {pattern
                    ? `${totalHours(hours)} hours`
                    : `${days} day${days === 1 ? '' : 's'}`}
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

      {/* Pinned on a phone, where the form is longer than the screen and the
          button has to be reachable with a thumb wherever you have scrolled
          to. Not pinned on a desktop: there the whole form fits at once, and a
          bar stuck to the foot of the window leaves Continue marooned in the
          middle of an empty page with no visible connection to the calendar
          it applies to. That was the complaint. */}
      <div className={desktop ? '' : 'tm-fixed'} style={{
        display: 'flex', gap: 10, background: 'white', boxSizing: 'border-box',
        borderTop: `1px solid ${BORDER}`, zIndex: 90,
        ...(desktop
          ? {
            maxWidth: column, margin: '0 auto 40px', width: '100%',
            padding: '16px 20px', borderRadius: 12,
            border: `1px solid ${BORDER}`
          }
          : {
            position: 'fixed',
            bottom: 'calc(70px + env(safe-area-inset-bottom, 0px))',
            padding: '12px 16px'
          })
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
