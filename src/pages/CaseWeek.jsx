import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Page, Header, Banner } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { useLiveRefresh } from '../liveRefresh.js'
import {
  fetchWeekPlan, readCachedPlan, readPrefs, writePrefs, planSignature
} from '../clinicalPlan/provider.js'
import {
  resolveDefaultWeek, weekWindowFor, todayStr, parseDateStr, toDateStr,
  addCivilDays, civilWeekday, weekdayName, formatWeekRange, formatStamp
} from '../clinicalPlan/week.js'
import { accentForCase, accentTextForCase, NAVIGATION_ACCENT } from '../clinicalPlan/theme.js'
import EditBooking from './cases/EditBooking.jsx'
import NewBooking from './cases/NewBooking.jsx'
import BookingQueue from './cases/BookingQueue.jsx'

// ─── The week ─────────────────────────────────────────────────────────────────
// One view of the bookings calendar, replacing the two that overlapped.
//
// There used to be a Calendar and a Case plan, built at different times for
// different reasons, and by the end most of both screens was the same thing
// twice. The Calendar navigated well and showed everything the calendar holds;
// the Case plan read a case properly — operation, system, supply, kit — and knew
// about the week as a whole. Neither was complete on its own, and keeping both
// meant every improvement had to be made in two places or the two would drift,
// which is exactly how the calendar view ended up not refreshing for a month
// while the plan did.
//
// So: the plan's reading of a case, the calendar's day-by-day navigation, and
// the booking notes that neither of them used to show.

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const dayNum = day => parseDateStr(day).day
const monthOf = day => MONTHS[parseDateStr(day).month - 1]
const shiftDay = (day, by) => toDateStr(addCivilDays(parseDateStr(day), by))

/** The tone a non-case item is drawn in. */
// The small header controls. One definition, so they cannot drift apart.
const arrowStyle = {
  background: 'none',
  border: 'none',
  color: 'rgba(255,255,255,0.55)',
  // Glyphs, but the type scale is closed and a closed scale with exceptions in
  // it is not closed.
  ...text('title'),
  lineHeight: 1,
  cursor: 'pointer',
  padding: '2px 6px'
}

const chipStyle = {
  padding: '5px 12px',
  borderRadius: radius.pill,
  border: '1px solid rgba(255,255,255,0.28)',
  background: 'rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.85)',
  ...text('caption'),
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const KIND_TONE = {
  leave: { bg: colour.warningSoft, ink: colour.warning },
  hours: { bg: colour.accentSoft, ink: colour.accentDeep },
  meeting: { bg: colour.lineSoft, ink: colour.inkMuted },
  reminder: { bg: colour.dangerSoft, ink: colour.danger },
  other: { bg: colour.lineSoft, ink: colour.inkFaint }
}

/**
 * A case, in full.
 *
 * Everything the booking says, in one place: who, what, with which system, how
 * it is supplied, what extra kit, and whatever the team wrote in the notes.
 */
function CaseCard({ surgicalCase, onOpen }) {
  const off = Boolean(surgicalCase.cancelled)
  const bar = off ? colour.inkFainter : accentForCase(surgicalCase)
  const nameInk = off ? colour.inkFaint : accentTextForCase(surgicalCase)

  return (
    <button type="button" onClick={() => onOpen?.(surgicalCase)}
      style={{
        display: 'flex', width: '100%', textAlign: 'left', gap: 0, padding: 0,
        background: colour.surface, border: `1px solid ${colour.line}`,
        borderRadius: radius.card, marginBottom: space.sm, overflow: 'hidden',
        cursor: onOpen ? 'pointer' : 'default'
      }}>
      <span aria-hidden="true" style={{ width: 5, background: bar, flexShrink: 0 }} />
      <span style={{ padding: `${space.sm}px ${space.md}px`, flex: 1, minWidth: 0 }}>
        <span style={{
          ...text('bodyStrong'), display: 'block', color: off ? colour.inkFaint : colour.ink,
          ...(off ? { textDecoration: 'line-through' } : {})
        }}>
          {surgicalCase.patient}
          <span style={{ color: colour.inkFainter, fontWeight: 400 }}> / </span>
          <span style={{ color: nameInk }}>{surgicalCase.surgeon}</span>
        </span>

        {(off || surgicalCase.navigation) && (
          <span style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
            {off && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                border: `1px solid ${colour.inkFainter}`, color: colour.inkFaint,
                ...text('micro'), textTransform: 'uppercase'
              }}>Cancelled</span>
            )}
            {/* Navigation has its own marker rather than the bar's colour. It
                used to take the bar, which meant an Ibbett case using the AIRO
                scanner was not drawn as an Ibbett case at all — two facts
                fighting over one colour, and the surgeon losing. Both are
                readable at once now. */}
            {surgicalCase.navigation && !off && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                background: NAVIGATION_ACCENT, color: 'white',
                ...text('micro'), textTransform: 'uppercase'
              }}>{surgicalCase.navigation}</span>
            )}
          </span>
        )}

        {/* The operation leads: "C5/6 ACDF" says more about a case than the
            implant system does. */}
        {surgicalCase.operation && (
          <span style={{ ...text('bodyStrong'), display: 'block', color: colour.ink }}>
            {surgicalCase.operation}
          </span>
        )}

        {(surgicalCase.system || surgicalCase.supply) && (
          <span style={{ ...text('caption'), display: 'block', color: colour.inkMuted }}>
            {surgicalCase.system}
            {surgicalCase.system && surgicalCase.supply ? ' · ' : ''}
            {surgicalCase.supply && (
              <span style={{ fontWeight: 600, color: colour.ink }}>{surgicalCase.supply}</span>
            )}
          </span>
        )}

        {/* Only when the kit names something the system does not — a loan tray
            alongside the implant system. */}
        {surgicalCase.kit && (
          <span style={{ ...text('caption'), display: 'block', color: colour.inkMuted }}>
            Kit: {surgicalCase.kit}
          </span>
        )}

        {surgicalCase.rep && (
          <span style={{ ...text('caption'), display: 'block', color: colour.accentDeep }}>
            Rep: <strong style={{ fontWeight: 700 }}>{surgicalCase.rep}</strong>
          </span>
        )}

        {surgicalCase.unread && (
          <span style={{ ...text('caption'), display: 'block', color: colour.inkMuted }}>
            {surgicalCase.unread}
          </span>
        )}

        {/* What the team wrote that no field has a name for. This is the part
            neither old screen showed, and it is often the reason a case moved. */}
        {(surgicalCase.notes || []).map((note, i) => (
          <span key={i} style={{
            ...text('caption'), display: 'block', marginTop: 2,
            fontStyle: note.kind === 'booking' ? 'normal' : 'italic',
            fontWeight: note.kind === 'clinicalAlert' ? 700 : 400,
            color: note.kind === 'clinicalAlert' ? colour.danger : colour.inkFaint
          }}>
            {note.text}
          </span>
        ))}
      </span>
    </button>
  )
}

/** Leave, hours, a meeting, a reminder — quieter than a case, and labelled. */
function ItemRow({ item }) {
  const tone = KIND_TONE[item.kind] || KIND_TONE.other
  return (
    <div style={{
      display: 'flex', gap: 0, marginBottom: 6, overflow: 'hidden',
      border: `1px solid ${colour.lineSoft}`, borderRadius: radius.control
    }}>
      <span aria-hidden="true"
        style={{ width: 3, background: item.colourHex || colour.line, flexShrink: 0 }} />
      <span style={{ padding: `${space.xs}px ${space.sm}px`, flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
          <span style={{ ...text('body'), color: colour.ink }}>{item.title || item.text}</span>
          <span style={{
            ...text('micro'), textTransform: 'uppercase', flexShrink: 0,
            background: tone.bg, color: tone.ink,
            borderRadius: radius.pill, padding: '2px 7px'
          }}>{item.kindLabel || 'Other'}</span>
        </span>
        {item.time && (
          <span style={{ ...text('caption'), display: 'block', color: colour.inkFaint }}>{item.time}</span>
        )}
      </span>
    </div>
  )
}

/**
 * Adding a booking, as a row rather than a floating button.
 *
 * It was a circle pinned to the bottom corner, and it got lost: it was
 * positioned against a container that scrolls, so it drifted off with the
 * content. Fixing it to the viewport would have worked and would have left it
 * floating over the last case of a long list, which is the usual complaint with
 * that pattern.
 *
 * A row cannot drift and cannot cover anything. It also knows which day it sits
 * under, so the sheet opens already set to that date — one fewer thing to choose
 * for the booking somebody is most likely making.
 */
function AddBookingRow({ day, onAdd }) {
  return (
    <button type="button" onClick={() => onAdd(day)}
      style={{
        display: 'flex', alignItems: 'center', gap: space.sm, width: '100%',
        padding: `${space.sm}px ${space.md}px`, marginBottom: space.sm,
        borderRadius: radius.card, cursor: 'pointer',
        background: colour.accentSoft,
        border: '1px dashed rgba(24,154,133,0.45)',
        color: colour.accentDeep, ...text('bodyStrong')
      }}>
      <span aria-hidden="true" style={{ ...text('heading'), lineHeight: 1 }}>+</span>
      <span>Add a booking{day ? ` to ${weekdayName(day)} ${dayNum(day)} ${monthOf(day)}` : ''}</span>
    </button>
  )
}

function Heading({ children }) {
  return (
    <div style={{
      ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
      margin: `${space.lg}px 0 ${space.sm}px`
    }}>{children}</div>
  )
}

/** One day, whole: cases by hospital, then everything else. */
function DayPanel({ day, onOpen }) {
  const groups = day.casesByHospital || []
  const others = [...(day.nonSurgeonItems || []), ...(day.otherRollup || [])]
  const attention = day.needsAttention || []
  const empty = !groups.length && !others.length && !attention.length && !(day.flags || []).length

  return (
    <>
      {(day.flags || []).length > 0 && (
        <div style={{ marginBottom: space.sm }}>
          {day.flags.map((flag, i) => (
            <Banner key={i} tone={flag.kind === 'clinicalAlert' ? 'danger' : 'warning'}>
              {flag.text}
            </Banner>
          ))}
        </div>
      )}

      {groups.map(group => (
        <div key={group.hospital}>
          <Heading>{group.hospital} · {group.cases.length} case{group.cases.length === 1 ? '' : 's'}</Heading>
          {group.cases.map(c => <CaseCard key={c.id} surgicalCase={c} onOpen={onOpen} />)}
        </div>
      ))}

      {attention.length > 0 && (
        <>
          <Heading>Needs a look</Heading>
          {attention.map(item => (
            <Banner key={item.id} tone="warning">
              <strong>{item.text}</strong><br />{item.reason}
            </Banner>
          ))}
        </>
      )}

      {others.length > 0 && (
        <>
          <Heading>{groups.length ? 'Also on' : 'On today'}</Heading>
          {others.map((item, i) => <ItemRow key={i} item={item} />)}
        </>
      )}

      {empty && (
        <div style={{ textAlign: 'center', padding: `${space.xl}px ${space.md}px` }}>
          <div style={{ ...text('bodyStrong'), color: colour.ink }}>Nothing booked</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            This day is clear in the calendar.
          </div>
        </div>
      )}
    </>
  )
}

export default function CaseWeek({ user, switcher, promptBanner }) {
  // The booking being edited, if any. Tapping a case opens the sheet; the sheet
  // loads it fresh from the calendar rather than editing what is on screen.
  const [editing, setEditing] = useState(null)
  // The day the sheet should open on, or null when it is closed.
  const [adding, setAdding] = useState(null)
  const prefs = useMemo(() => readPrefs(), [])
  const [span, setSpan] = useState(prefs.caseSpan === 'week' ? 'week' : 'day')
  // Always this week, never where you were last time. The app is opened to find
  // out what is on now; restoring a week somebody scrolled to yesterday means
  // the first thing it shows is wrong, and quietly so.
  const [window_, setWindow] = useState(() => resolveDefaultWeek())
  const [selectedDay, setSelectedDay] = useState(() => todayStr())
  const [plan, setPlan] = useState(() => readCachedPlan(
    (prefs.weekStart ? weekWindowFor(prefs.weekStart) : resolveDefaultWeek()).startDate)?.plan || null)
  const [status, setStatus] = useState('loading')
  const [stale, setStale] = useState(false)
  const [checkedAt, setCheckedAt] = useState(null)
  const [exportNote, setExportNote] = useState('')
  const signature = useRef('')

  const token = user?.token

  const load = useCallback(async (win, { quiet = false } = {}) => {
    if (!quiet) setStatus('loading')
    try {
      const result = await fetchWeekPlan(win, { token, force: quiet })
      setCheckedAt(Date.now())
      setStale(Boolean(result.error))
      // Replaced only when something visible changed, so a poll does not rebuild
      // the page every minute and lose the reader's place.
      const next = planSignature(result.plan)
      if (next !== signature.current) {
        signature.current = next
        setPlan(result.plan)
      }
      setStatus('ready')
    } catch {
      if (!quiet) setStatus('error')
      setStale(true)
    }
  }, [token])

  useEffect(() => { load(window_) }, [window_, load])
  useLiveRefresh(useCallback(() => load(window_, { quiet: true }), [window_, load]), [window_, load])

  const remember = next => writePrefs({ ...readPrefs(), ...next })

  // The week as the Word document that gets emailed round. Loaded on demand —
  // the builder is large and most visits never export.
  async function downloadDocx() {
    setExportNote('')
    try {
      const [{ buildPlanDocx }, { DOCX_FILENAME }] = await Promise.all([
        import('../clinicalPlan/exportDocx.js'),
        import('../clinicalPlan/exportMeta.js')
      ])
      const url = URL.createObjectURL(await buildPlanDocx(plan))
      const a = document.createElement('a')
      a.href = url
      a.download = DOCX_FILENAME
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportNote(`Word export failed (${err.message}).`)
    }
  }

  const days = window_.days
  const today = todayStr()
  // The selected day has to be inside the week on screen, or stepping back a
  // week would leave the day view showing a day that is not in it.
  const activeDay = days.includes(selectedDay) ? selectedDay : days[0]
  const dayPlan = (plan?.days || []).find(d => d.date === activeDay)

  function goWeek(by) {
    const next = weekWindowFor(shiftDay(window_.startDate, by * 7))
    setWindow(next)
    setSelectedDay(next.days.includes(today) ? today : next.days[0])
  }

  function pickDay(day) {
    setSelectedDay(day)
    setSpan('day')
    remember({ caseSpan: 'day' })
  }

  function goToday() {
    setWindow(resolveDefaultWeek())
    setSelectedDay(today)
  }

  const onThisWeek = window_.days.includes(today)

  // How many bookings are waiting to be confirmed. Only the count is fetched
  // here — the cards themselves are read when the queue is opened, so the week
  // view does not carry patient detail it never shows.
  const [queueCount, setQueueCount] = useState(0)
  const [showQueue, setShowQueue] = useState(false)

  const countQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/today?action=queue', {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      if (!res.ok) return
      const data = await res.json()
      setQueueCount(data.count || 0)
    } catch {
      // A queue that cannot be counted is not worth interrupting the week for.
    }
  }, [user])

  useEffect(() => { countQueue() }, [countQueue])

  const caseCount = day => (day?.casesByHospital || []).reduce(
    (n, g) => n + g.cases.filter(c => !c.cancelled).length, 0)

  return (
    <Page style={{ display: 'flex', flexDirection: 'column' }}>
      <Header eyebrow="This week" title="Cases"
        subtitle={plan?.summaryLine || 'Every booking, as the calendar has it'}>
        {switcher}

        {/* One row: move weeks, and choose how to read them. The header used to
            carry three rows of controls above the day strip — a Day/Week pair, a
            row of three chips, and the week range with its arrows — which on a
            phone left very little of the week itself on screen. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: space.sm }}>
          <button onClick={() => goWeek(-1)} aria-label="Previous week" style={arrowStyle}>‹</button>
          <button onClick={goToday} title="Back to this week"
            style={{
              ...chipStyle, flex: 1, textAlign: 'center',
              // Nothing to go back to when you are already here.
              border: onThisWeek ? '1px solid transparent' : chipStyle.border,
              background: onThisWeek ? 'transparent' : chipStyle.background
            }}>
            {formatWeekRange(window_.startDate, window_.endDate)}
          </button>
          <button onClick={() => goWeek(1)} aria-label="Next week" style={arrowStyle}>›</button>
          <button onClick={() => { const next = span === 'day' ? 'week' : 'day'; setSpan(next); remember({ caseSpan: next }) }}
            aria-label={span === 'day' ? 'Show the week' : 'Show one day'}
            style={{ ...chipStyle, background: 'rgba(255,255,255,0.18)' }}>
            {span === 'day' ? 'Day' : 'Week'}
          </button>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '12px 12px 0 0', padding: '4px 8px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {days.map(day => {
              const dp = (plan?.days || []).find(d => d.date === day)
              const n = caseCount(dp)
              const on = day === activeDay
              const isToday = day === today
              return (
                <button key={day} onClick={() => pickDay(day)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '6px 2px 8px', border: 'none', cursor: 'pointer',
                    borderRadius: '8px 8px 0 0',
                    background: on ? 'rgba(24,154,133,0.25)' : 'transparent',
                    borderBottom: on ? `3px solid ${colour.accent}` : '3px solid transparent'
                  }}>
                  <span style={{
                    ...text('micro'),
                    color: isToday ? colour.accent : 'rgba(255,255,255,0.5)'
                  }}>{DAY_LABELS[civilWeekday(parseDateStr(day)) - 1]}</span>
                  <span style={{
                    ...text('bodyStrong'),
                    color: isToday ? colour.accent : 'white'
                  }}>{dayNum(day)}</span>
                  <span style={{
                    ...text('micro'),
                    color: n ? 'rgba(255,255,255,0.75)' : 'transparent'
                  }}>{n || '0'}</span>
                </button>
              )
            })}
          </div>
        </div>
      </Header>

      <div style={{ flex: 1, padding: `${space.md}px ${space.md}px 100px`, overflowY: 'auto' }}>
        {promptBanner}
        {exportNote && <Banner tone="danger">{exportNote}</Banner>}
        {stale && (
          <Banner tone="warning">
            Not updating — showing the last plan that loaded
            {checkedAt ? ` · checked ${formatStamp(new Date(checkedAt).toISOString())}` : ''}
          </Banner>
        )}
        {status === 'loading' && !plan && (
          <div style={{ textAlign: 'center', padding: space.xl, color: colour.inkFaint }}>Loading…</div>
        )}

        {/* The bookings inbox. Always in the same place, whether or not anything
            is waiting — an entry point that only appears when there is something
            behind it cannot be checked, and "did that booking come through?" is
            a question asked most often when the answer is no. */}
        <button onClick={() => setShowQueue(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: space.sm, width: '100%',
            textAlign: 'left', cursor: 'pointer', marginBottom: space.md,
            background: queueCount > 0 ? colour.warningSoft : 'transparent',
            border: `1px solid ${queueCount > 0 ? colour.warningLine : colour.line}`,
            borderRadius: radius.card, padding: queueCount > 0 ? space.md : space.sm
          }}>
          <span style={{
            ...text(queueCount > 0 ? 'bodyStrong' : 'caption'),
            color: queueCount > 0 ? colour.ink : colour.inkFaint, flex: 1
          }}>
            {queueCount > 0
              ? `${queueCount} booking${queueCount === 1 ? '' : 's'} to confirm`
              : 'Bookings inbox — nothing waiting'}
          </span>
          <span style={{ ...text('body'), color: colour.inkFaint }}>›</span>
        </button>

        {plan && span === 'day' && (
          <>
            <div style={{ marginBottom: space.md }}>
              <div style={{ ...text('title'), color: colour.ink }}>
                {activeDay === today ? 'Today' : weekdayName(activeDay)}
              </div>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>
                {dayNum(activeDay)} {monthOf(activeDay)} {parseDateStr(activeDay).year}
                {dayPlan?.caseCountLine ? ` · ${dayPlan.caseCountLine}` : ''}
              </div>
            </div>
            <AddBookingRow day={activeDay} onAdd={setAdding} />
            {dayPlan
              ? <DayPanel day={dayPlan} onOpen={setEditing} />
              : <div style={{ ...text('caption'), color: colour.inkFaint }}>Nothing booked.</div>}
          </>
        )}

        {plan && span === 'week' && <AddBookingRow day={activeDay} onAdd={setAdding} />}

        {plan && span === 'week' && (plan.days || []).map(day => (
          <div key={day.date} style={{ marginBottom: space.xl }}>
            <button onClick={() => pickDay(day.date)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'none',
                border: 'none', padding: 0, cursor: 'pointer', marginBottom: space.xs
              }}>
              <span style={{
                ...text('heading'),
                color: day.date === today ? colour.accentDeep : colour.ink
              }}>
                {day.date === today ? 'Today' : weekdayName(day.date)} {dayNum(day.date)} {monthOf(day.date)}
              </span>
              {day.caseCountLine && (
                <span style={{ ...text('caption'), display: 'block', color: colour.inkFaint }}>
                  {day.caseCountLine}
                </span>
              )}
            </button>
            <DayPanel day={day} onOpen={setEditing} />
          </div>
        ))}

        {plan && (
          <button onClick={downloadDocx} aria-label="Download the week as Word"
            style={{
              ...text('caption'), color: colour.inkFaint, background: 'none',
              border: `1px solid ${colour.line}`, borderRadius: radius.control,
              padding: `${space.xs}px ${space.md}px`, cursor: 'pointer',
              marginTop: space.lg
            }}>
            Download the week as Word
          </button>
        )}

        {/* The week's own notes and key flags, which only the plan used to
            carry. `notes` is one sentence, not a list — assuming otherwise
            crashed the week view outright. */}
        {plan && span === 'week' && (plan.notes || (plan.keyFlags || []).length > 0) && (
          <>
            <Heading>Notes for the week</Heading>
            {plan.notes && (
              <div style={{ ...text('body'), color: colour.inkMuted, marginBottom: space.sm }}>
                {plan.notes}
              </div>
            )}
            {(plan.keyFlags || []).map((flag, i) => (
              <div key={i} style={{ ...text('body'), color: colour.inkMuted, marginBottom: space.xs }}>
                <strong style={{ color: colour.ink }}>{flag.label}:</strong> {flag.text}
              </div>
            ))}
          </>
        )}
      </div>

      {adding && (
        <NewBooking
          user={user}
          date={adding}
          onClose={() => setAdding(null)}
          onCreated={() => load(window_, { quiet: true })} />
      )}

      {showQueue && (
        <BookingQueue
          user={user}
          onClose={() => { setShowQueue(false); countQueue() }}
          // A booking accepted here lands on the calendar, so the week has to be
          // read again for it to appear.
          onAccepted={() => { countQueue(); load(window_, { quiet: true }) }} />
      )}

      {editing && (
        <EditBooking
          eventId={editing.id}
          user={user}
          onClose={() => setEditing(null)}
          // Straight back to the calendar for the truth, rather than patching
          // what is on screen from the response: the plan derives a case from
          // the whole week, and a save can change how it groups.
          onSaved={() => load(window_, { quiet: true })} />
      )}
    </Page>
  )
}
