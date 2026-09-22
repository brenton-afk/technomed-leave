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
import { accentForCase, accentTextForCase } from '../clinicalPlan/theme.js'

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

        {off && (
          <span style={{
            display: 'inline-block', marginTop: 3, padding: '1px 7px', borderRadius: radius.pill,
            border: `1px solid ${colour.inkFainter}`, color: colour.inkFaint,
            ...text('micro'), textTransform: 'uppercase'
          }}>Cancelled</span>
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

export default function CaseWeek({ user, switcher, onOpen, promptBanner }) {
  const prefs = useMemo(() => readPrefs(), [])
  const [span, setSpan] = useState(prefs.caseSpan === 'week' ? 'week' : 'day')
  const [window_, setWindow] = useState(() =>
    prefs.weekStart ? weekWindowFor(prefs.weekStart) : resolveDefaultWeek())
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
    remember({ weekStart: next.startDate })
  }

  function pickDay(day) {
    setSelectedDay(day)
    setSpan('day')
    remember({ caseSpan: 'day' })
  }

  function goToday() {
    const next = resolveDefaultWeek()
    setWindow(next)
    setSelectedDay(today)
    remember({ weekStart: next.startDate })
  }

  const caseCount = day => (day?.casesByHospital || []).reduce(
    (n, g) => n + g.cases.filter(c => !c.cancelled).length, 0)

  return (
    <Page style={{ display: 'flex', flexDirection: 'column' }}>
      <Header eyebrow="This week" title="Cases"
        subtitle={plan?.summaryLine || 'Every booking, as the calendar has it'}>
        {switcher}

        <div style={{ display: 'flex', gap: 8, marginBottom: space.sm }}>
          {['day', 'week'].map(id => (
            <button key={id} onClick={() => { setSpan(id); remember({ caseSpan: id }) }}
              aria-pressed={span === id}
              style={{
                padding: '6px 16px', borderRadius: radius.pill, border: 'none', cursor: 'pointer',
                ...text('bodyStrong'),
                background: span === id ? 'white' : 'rgba(255,255,255,0.12)',
                color: span === id ? colour.navy : 'rgba(255,255,255,0.8)'
              }}>
              {id === 'day' ? 'Day' : 'Week'}
            </button>
          ))}
          <button onClick={goToday}
            style={{
              marginLeft: 'auto', padding: '6px 16px', borderRadius: radius.pill,
              border: '1px solid rgba(255,255,255,0.3)', background: 'transparent',
              color: 'rgba(255,255,255,0.75)', ...text('caption'), cursor: 'pointer'
            }}>Today</button>
          <button onClick={downloadDocx} disabled={!plan} aria-label="Download the week as Word"
            style={{
              padding: '6px 14px', borderRadius: radius.pill,
              border: '1px solid rgba(255,255,255,0.3)', background: 'transparent',
              color: 'rgba(255,255,255,0.75)', ...text('caption'),
              cursor: plan ? 'pointer' : 'default'
            }}>.docx</button>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '12px 12px 0 0', padding: '8px 8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
            <button onClick={() => goWeek(-1)} aria-label="Previous week"
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 19, cursor: 'pointer' }}>‹</button>
            <span style={{ ...text('caption'), fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>
              {formatWeekRange(window_.startDate, window_.endDate)}
            </span>
            <button onClick={() => goWeek(1)} aria-label="Next week"
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 19, cursor: 'pointer' }}>›</button>
          </div>
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
            {dayPlan
              ? <DayPanel day={dayPlan} onOpen={onOpen} />
              : <div style={{ ...text('caption'), color: colour.inkFaint }}>Nothing booked.</div>}
          </>
        )}

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
            <DayPanel day={day} onOpen={onOpen} />
          </div>
        ))}

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
    </Page>
  )
}
