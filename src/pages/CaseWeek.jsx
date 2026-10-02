import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Page, Header, Banner } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { useLiveRefresh } from '../liveRefresh.js'
import {
  fetchWeekPlan, readCachedPlan, readPrefs, writePrefs, planSignature
} from '../clinicalPlan/provider.js'
import {
  resolveDefaultWeek, weekWindowFor, todayStr, parseDateStr, toDateStr,
  addCivilDays, civilWeekday, weekdayName, formatWeekRange, formatWeekRangeShort, formatStamp
} from '../clinicalPlan/week.js'
import { accentForCase, accentTextForCase, NAVIGATION_ACCENT } from '../clinicalPlan/theme.js'
import EditBooking from './cases/EditBooking.jsx'
import NewBooking from './cases/NewBooking.jsx'
import BookingQueue from './cases/BookingQueue.jsx'
import ListPlace from './cases/ListPlace.jsx'
import { describeListPlace } from '../clinicalPlan/listPlace.js'
import { NOT_REQUIRED_LABEL } from '../clinicalPlan/attendance.js'

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
// 44px, which is Apple's minimum tap target and not a round number chosen for
// looks. These were 2px of padding around a 19px glyph — about 23 by 22 — and
// reported as "the arrows to cycle through the weeks are very small". They are
// also the most-used control on the screen.
const TAP = 44

const arrowStyle = {
  width: TAP,
  height: TAP,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: radius.pill,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.10)',
  color: 'white',
  // Glyphs, but the type scale is closed and a closed scale with exceptions in
  // it is not closed.
  ...text('title'),
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0
}

/**
 * Day or week, as a segmented control rather than a button that changes its own
 * label.
 *
 * The old one read "Day" when you were in week view and "Week" when you were in
 * day view — it named the destination, not the state — so there was no way to
 * tell which you were looking at without reading the list below. Two segments
 * with one lit says where you are and where you can go at the same time, and
 * costs no more room beside the title.
 */
function SpanToggle({ span, onChange }) {
  return (
    <div role="tablist" aria-label="How much of the week to show"
      style={{
        display: 'flex', flexShrink: 0, padding: 3, gap: 2,
        background: 'rgba(0,0,0,0.22)', borderRadius: radius.pill
      }}>
      {['day', 'week'].map(id => {
        const on = span === id
        return (
          <button key={id} role="tab" aria-selected={on}
            onClick={() => onChange(id)}
            style={{
              // Short of 44 because it sits beside the title rather than in the
              // run of controls, and making it that tall would push the week
              // itself further down the screen than the toggle is worth.
              minWidth: 46, height: 34, border: 'none', borderRadius: radius.pill,
              background: on ? 'white' : 'transparent',
              color: on ? colour.navy : 'rgba(255,255,255,0.7)',
              ...text('bodyStrong'), cursor: 'pointer'
            }}>
            {id === 'day' ? 'Day' : 'Week'}
          </button>
        )
      })}
    </div>
  )
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
function CaseCard({ surgicalCase, onOpen, position, onMove, busy, onSetPlace }) {
  const off = Boolean(surgicalCase.cancelled)
  // Told about, not attending. Drawn back like a cancelled case rather than
  // struck through — it is still going ahead, just without us.
  const spare = Boolean(surgicalCase.notRequired) && !off
  const bar = off ? colour.inkFainter : accentForCase(surgicalCase)
  const nameInk = off ? colour.inkFaint : accentTextForCase(surgicalCase)
  const ordering = typeof position === 'number' && Boolean(onMove)
  const place = describeListPlace(surgicalCase.listPlace)

  return (
    <div
      style={{
        display: 'flex', width: '100%', gap: 0, padding: 0, alignItems: 'stretch',
        background: colour.surface, border: `1px solid ${colour.line}`,
        borderRadius: radius.card, marginBottom: space.sm, overflow: 'hidden',
        opacity: busy ? 0.55 : spare ? 0.72 : 1, transition: 'opacity 120ms'
      }}>
      <span aria-hidden="true" style={{ width: 5, background: bar, flexShrink: 0 }} />

      {/* Where it sits in the list the hospital read out. Shown beside the case
          rather than as a time, because it is a position and not a time — the
          third case starts when the second one finishes. */}
      {ordering && (
        <span style={{
          flexShrink: 0, width: 26, display: 'flex', alignItems: 'center',
          justifyContent: 'center', ...text('bodyStrong'),
          color: off ? colour.inkFainter : colour.inkFaint
        }}>{position + 1}</span>
      )}

      {/* The case, and the one control that is not the case. They are siblings
          rather than nested: a button inside a button is invalid, and a browser
          is entitled not to deliver the tap to the inner one — which is exactly
          what happened. The chip did nothing on a phone while doing the right
          thing in the tests, because jsdom dispatches straight to the element
          and a real browser hit-tests first. */}
      <span style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', padding: `${space.sm}px ${space.md}px`
      }}>
      <button type="button" onClick={() => onOpen?.(surgicalCase)}
        style={{
          padding: 0, width: '100%', minWidth: 0,
          textAlign: 'left', background: 'none', border: 'none', font: 'inherit',
          cursor: onOpen ? 'pointer' : 'default'
        }}>
        <span style={{
          ...text('bodyStrong'), display: 'block', color: off ? colour.inkFaint : colour.ink,
          ...(off ? { textDecoration: 'line-through' } : {})
        }}>
          {surgicalCase.patient}
          <span style={{ color: colour.inkFainter, fontWeight: 400 }}> / </span>
          <span style={{ color: nameInk }}>{surgicalCase.surgeon}</span>
        </span>

        {(off || spare || surgicalCase.navigation || surgicalCase.selfFunding) && (
          <span style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
            {off && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                border: `1px solid ${colour.inkFainter}`, color: colour.inkFaint,
                ...text('micro'), textTransform: 'uppercase'
              }}>Cancelled</span>
            )}
            {/* First, and the only strong colour on the card when it applies.
                One of these used to read as an ordinary case with a BRAINLAB
                badge — which everywhere else means we are there with
                navigation — and the fact that nobody needs to go was a line of
                grey text under the kit. The most important thing on the card
                was the quietest thing on it. */}
            {spare && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                background: colour.inkMuted, color: 'white',
                ...text('micro'), textTransform: 'uppercase'
              }}>{NOT_REQUIRED_LABEL}</span>
            )}
            {/* Written at the front of the title, where it used to be swallowed
                into whatever parsed next — the card showed "FUNDING" sitting in
                front of the surname. It is a badge now, said in full. */}
            {surgicalCase.selfFunding && !off && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                background: colour.warningSoft, color: colour.ink,
                border: `1px solid ${colour.warningLine}`,
                ...text('micro'), textTransform: 'uppercase'
              }}>Self funding</span>
            )}
            {/* Navigation has its own marker rather than the bar's colour. It
                used to take the bar, which meant an Ibbett case using the AIRO
                scanner was not drawn as an Ibbett case at all — two facts
                fighting over one colour, and the surgeon losing. Both are
                readable at once now. */}
            {surgicalCase.navigation && !off && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                // Outlined rather than filled when we are not attending. A
                // solid navigation badge is how the card says "we are there
                // with the AIRO", which is the opposite of what this case is.
                background: spare ? 'transparent' : NAVIGATION_ACCENT,
                color: spare ? colour.inkFaint : 'white',
                border: spare ? `1px solid ${colour.line}` : 'none',
                ...text('micro'), textTransform: 'uppercase'
              }}>{surgicalCase.navigation}</span>
            )}
          </span>
        )}

        {/* Before the operation, because it is the part that decides what time
            somebody sets an alarm for. A case can be routine and still have the
            team on the road at half six because it is first up. */}
        {place && !off && (
          <span style={{ display: 'block', marginTop: 3 }}>
            <span style={{
              ...text('bodyStrong'),
              color: place.headline.includes('1st') ? colour.warning : colour.accentDeep
            }}>{place.headline}</span>
            {place.ahead && (
              <span style={{ ...text('caption'), display: 'block', color: colour.inkMuted }}>
                {place.ahead}
              </span>
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
      </button>

        {/* Always offered, whether or not anything is recorded — including on a
            day where this is our only case at that hospital, which is exactly
            where the arrows can say nothing and the list order still matters. */}
        {onSetPlace && !off && (
          <button
            type="button"
            aria-label={`Set where ${surgicalCase.patient} is on the list`}
            onClick={() => onSetPlace(surgicalCase)}
            style={{
              // A bordered chip rather than a text link. The first version was
              // caption-sized and the same colour as the rest of the card, and
              // was reported as the option not being there at all.
              display: 'inline-flex', alignItems: 'center', gap: 5,
              marginTop: space.sm, cursor: 'pointer', minHeight: 32,
              padding: `0 ${space.md}px`, borderRadius: radius.pill,
              border: `1px solid ${place ? colour.accent : colour.line}`,
              background: place ? colour.accentSoft : colour.surface,
              ...text('caption'), fontWeight: 700,
              color: place ? colour.accentDeep : colour.ink
            }}>
            {place ? 'Change list order' : '＋ Set list order'}
          </button>
        )}
      </span>

      {ordering && (
        <span style={{
          flexShrink: 0, display: 'flex', flexDirection: 'column',
          borderLeft: `1px solid ${colour.lineSoft}`
        }}>
          <MoveButton dir={-1} onMove={onMove} busy={busy} label={`Move ${surgicalCase.patient} up the list`} />
          <MoveButton dir={1} onMove={onMove} busy={busy} label={`Move ${surgicalCase.patient} down the list`} />
        </span>
      )}
    </div>
  )
}

/** One arrow. Disabled at the ends, so the list cannot be pushed off itself. */
function MoveButton({ dir, onMove, busy, label }) {
  const can = onMove(dir, true)
  return (
    <button type="button" aria-label={label} disabled={!can || busy}
      onClick={() => onMove(dir)}
      style={{
        // Wide enough to hit with a thumb in a car park, which is where the
        // list order usually gets typed in.
        width: 40, flex: 1, minHeight: 30, border: 'none', background: 'none',
        borderTop: dir === 1 ? `1px solid ${colour.lineSoft}` : 'none',
        color: can && !busy ? colour.accentDeep : colour.inkFainter,
        cursor: can && !busy ? 'pointer' : 'default',
        ...text('body'), lineHeight: 1
      }}>
      {dir === -1 ? '▲' : '▼'}
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

/**
 * One day, whole: cases by hospital, then everything else.
 *
 * When `onReorder` is given, the cases in each hospital can be moved up and down
 * into the order that hospital's list will actually run in. That order is the
 * calendar's order — moving a case here moves the calendar entry — so there is
 * one running order and everybody is reading it.
 */
function DayPanel({ day, onOpen, onReorder, onSetPlace }) {
  const groups = day.casesByHospital || []
  // The order shown before the calendar has caught up. A round trip to Google
  // and back takes a couple of seconds on a hospital connection, and an arrow
  // that does nothing for two seconds gets pressed again.
  const [override, setOverride] = useState(null)
  const [busy, setBusy] = useState(false)
  const present = groups.flatMap(g => g.cases.map(c => c.id)).slice().sort().join(',')
  useEffect(() => { setOverride(null); setBusy(false) }, [day.date, present])

  /** A group's cases, in the order last asked for. */
  const inOrder = cases => {
    if (!override) return cases
    const rank = new Map(override.map((id, i) => [id, i]))
    return cases.slice().sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  }

  // A called-off case is not in the running order. It keeps its place on the
  // screen, because the team needs to know it was booked and who was driving to
  // it, but the calendar closes up around it — so it takes no number here
  // either, or the card would say third while the calendar said second.
  const running = cases => inOrder(cases).filter(c => !c.cancelled)

  /**
   * Swaps a case with its neighbour in the same hospital.
   *
   * Within the hospital, because a running order belongs to a list and a list
   * belongs to a theatre — RHH's order says nothing about Calvary's. The whole
   * day still goes to the server, since the calendar lays the day out end to end.
   */
  const moveWithin = (group, index) => (dir, probe) => {
    const list = running(group.cases)
    const to = index + dir
    if (to < 0 || to >= list.length) return false
    if (probe) return true

    const next = list.slice()
    next[index] = list[to]
    next[to] = list[index]
    const wanted = groups
      .flatMap(g => (g.hospital === group.hospital ? next : running(g.cases)))
      .map(c => c.id)

    setOverride(wanted)
    setBusy(true)
    Promise.resolve(onReorder(day.date, wanted)).finally(() => setBusy(false))
    return true
  }
  const everythingElse = [...(day.nonSurgeonItems || []), ...(day.otherRollup || [])]
  // Who is away is read before the list, not after it. It changes who covers
  // what, and it was sitting under the cases where you had to scroll past a
  // whole day's theatre list to find it.
  const away = everythingElse.filter(item => item.kind === 'leave')
  const others = everythingElse.filter(item => item.kind !== 'leave')
  const attention = day.needsAttention || []
  const empty = !groups.length && !others.length && !away.length
    && !attention.length && !(day.flags || []).length

  return (
    <>
      {away.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: space.sm
        }}>
          {away.map((item, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
              borderRadius: radius.pill, padding: `4px ${space.md}px`,
              ...text('bodyStrong'), color: colour.ink
            }}>
              {/* The title already reads "Ben - ANNUAL LEAVE", so the kind
                  label the row form carries would only say it twice. */}
              {item.title || item.text}
            </span>
          ))}
        </div>
      )}

      {(day.flags || []).length > 0 && (
        <div style={{ marginBottom: space.sm }}>
          {day.flags.map((flag, i) => (
            <Banner key={i} tone={flag.kind === 'clinicalAlert' ? 'danger' : 'warning'}>
              {flag.text}
            </Banner>
          ))}
        </div>
      )}

      {groups.map(group => {
        const cases = inOrder(group.cases)
        const list = running(group.cases)
        // One case is not an order, and two hospitals with one case each is not
        // an order either. The arrows appear where there is something to order.
        const ordering = Boolean(onReorder) && list.length > 1
        return (
          <div key={group.hospital}>
            <Heading>{group.hospital} · {cases.length} case{cases.length === 1 ? '' : 's'}</Heading>
            {ordering && (
              <div style={{
                ...text('caption'), color: colour.inkFaint,
                margin: `-${space.xs}px 0 ${space.sm}px`
              }}>
                In list order. Move a case with the arrows and the calendar follows.
              </div>
            )}
            {cases.map(c => {
              const at = list.indexOf(c)
              const numbered = ordering && at >= 0
              return (
                <CaseCard key={c.id} surgicalCase={c} onOpen={onOpen}
                  position={numbered ? at : undefined}
                  onMove={numbered ? moveWithin(group, at) : undefined}
                  onSetPlace={onSetPlace}
                  busy={busy} />
              )
            })}
          </div>
        )
      })}

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
  const [notice, setNotice] = useState('')
  // The case whose place on the hospital's list is being recorded.
  const [placing, setPlacing] = useState(null)
  // Sub-calendars the week could not read. Leave lives on one of them, and an
  // unreadable leave calendar is indistinguishable from an empty one.
  const [sourceErrors, setSourceErrors] = useState([])
  const signature = useRef('')

  const token = user?.token

  const load = useCallback(async (win, { quiet = false } = {}) => {
    if (!quiet) setStatus('loading')
    try {
      const result = await fetchWeekPlan(win, { token, force: quiet })
      setCheckedAt(Date.now())
      setSourceErrors(result.sourceErrors || [])
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

  /**
   * Writes the day's running order to the calendar.
   *
   * The hospital rings about four o'clock the afternoon before with the order
   * the list will run in. This is where that goes: the team leader moves the
   * cases into it, the calendar entries follow into one-hour blocks in the same
   * sequence, and everyone with the app open can see whether we are first up.
   */
  const reorder = useCallback(async (date, order) => {
    try {
      const res = await fetch(`/api/calendar/today?action=reorder&date=${date}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ order })
      })
      if (!res.ok) throw new Error('That did not save')
      // Quietly, because the panel is already showing the new order — this only
      // reconciles it with what Google ended up with.
      await load(window_, { quiet: true })
    } catch {
      setNotice('The order did not save. Check the connection and try again.')
    }
  }, [token, load, window_])

  /**
   * Records where one case sits on the hospital's list.
   *
   * Written onto the booking, so it reads the same in Google as it does here.
   * The day re-packs around it afterwards, which is why the plan is reloaded
   * rather than patched in place.
   */
  const setListPlace = useCallback(async (eventId, place) => {
    const res = await fetch('/api/calendar/today?action=listplace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ eventId, place })
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That did not save')
    await load(window_, { quiet: true })
  }, [token, load, window_])

  const remember = next => writePrefs({ ...readPrefs(), ...next })

  // The week as the Word document that gets emailed round. Loaded on demand —
  // the builder is large and most visits never export.
  async function downloadDocx() {
    setNotice('')
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
      setNotice(`Word export failed (${err.message}).`)
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

  /**
   * The week containing today, and today selected in it.
   *
   * Not resolveDefaultWeek(). That answers a different question — "which week
   * should the app open on" — and from Friday onwards it answers next week, on
   * purpose, because that is the one being planned. Using it here meant that
   * from Friday to Sunday the button labelled "Back to today" set the window to
   * the week it was already showing, failed to find today in it, and fell back
   * to the first day: next Monday. It had done that every weekend since the
   * roll-forward was added.
   */
  function goToday() {
    setWindow(weekWindowFor(today))
    setSelectedDay(today)
  }

  /**
   * Whether you are already looking at today — which is a different question
   * in each view, and asking the week's one in both is the other half of why
   * this button did nothing.
   *
   * In the week view, today is on screen if the week contains it. In the day
   * view only one day is on screen, so being in the right week is not being on
   * the right day: standing on Monday of this week, the app decided you were
   * already here, hid the label, and did nothing when the button was pressed.
   */
  const atToday = span === 'day' ? activeDay === today : window_.days.includes(today)

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
      {/* No "This week" eyebrow any more: it said the same thing as the week
          range two rows below it, and the top of the screen had four things
          competing before the week itself appeared. */}
      <Header title="Cases"
        subtitle={plan?.summaryLine || 'Every booking, as the calendar has it'}
        right={
          <SpanToggle span={span} onChange={next => { setSpan(next); remember({ caseSpan: next }) }} />
        }>
        {switcher}

        {/* Moving between weeks is the most-used control here and was the
            smallest thing on the screen. Three items now, not four — the
            Day/Week pair moved up beside the title — so the range has room to
            be read and the arrows have room to be hit. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
          <button onClick={() => goWeek(-1)} aria-label="Previous week" style={arrowStyle}>‹</button>
          <button onClick={goToday}
            aria-label={atToday ? 'Showing today' : 'Back to today'}
            style={{
              flex: 1, minWidth: 0, height: TAP, padding: `0 ${space.sm}px`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              borderRadius: radius.pill, cursor: 'pointer',
              ...text('heading'), color: 'white',
              // Nothing to go back to when you are already here, so it stops
              // looking like a button.
              border: `1px solid ${atToday ? 'transparent' : 'rgba(255,255,255,0.28)'}`,
              background: atToday ? 'transparent' : 'rgba(255,255,255,0.10)'
            }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {formatWeekRangeShort(window_.startDate, window_.endDate, today)}
            </span>
            {/* Tapping the range to come back was an affordance nobody could
                see. It only appears when there is somewhere to go back to. */}
            {!atToday && (
              <span style={{ ...text('micro'), color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>
                Back to today
              </span>
            )}
          </button>
          <button onClick={() => goWeek(1)} aria-label="Next week" style={arrowStyle}>›</button>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '12px 12px 0 0', padding: '4px 8px 0' }}>
          {/* The badges under each date are a count of cases, and a bare number
              under a date does not say so. Labelling it once is cheaper than
              leaving every reader to work it out — and it is the sort of thing
              that only looks obvious to whoever built it. */}
          <div style={{
            ...text('micro'), textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.4)', padding: '0 2px 3px'
          }}>
            Cases each day
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {days.map(day => {
              const dp = (plan?.days || []).find(d => d.date === day)
              const n = caseCount(dp)
              const on = day === activeDay
              const isToday = day === today
              return (
                <button key={day} onClick={() => pickDay(day)}
                  aria-label={`${weekdayName(day)} ${dayNum(day)} ${monthOf(day)}, `
                    + `${n} case${n === 1 ? '' : 's'}`}
                  aria-current={on ? 'date' : undefined}
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
                  {/* A filled badge rather than a loose digit: a number in a
                      circle reads as a count of things, a number floating under
                      a date reads as anybody's guess. Kept at full size when
                      empty so the row does not jump. */}
                  <span style={{
                    ...text('micro'),
                    marginTop: 2,
                    minWidth: 17, height: 17, lineHeight: '17px',
                    borderRadius: radius.pill, textAlign: 'center',
                    background: n ? (on ? colour.accent : 'rgba(255,255,255,0.20)') : 'transparent',
                    color: n ? 'white' : 'transparent',
                    fontWeight: 700
                  }}>{n || '0'}</span>
                </button>
              )
            })}
          </div>
        </div>
      </Header>

      {/* tm-measure keeps the week in one column on a wide screen while the
          page and the header behind it reach both edges — see index.css. */}
      <div className="tm-measure"
        style={{ flex: 1, padding: `${space.md}px ${space.md}px 100px`, overflowY: 'auto' }}>
        {promptBanner}
        {notice && <Banner tone="danger">{notice}</Banner>}
        {stale && (
          <Banner tone="warning">
            Not updating — showing the last plan that loaded
            {checkedAt ? ` · checked ${formatStamp(new Date(checkedAt).toISOString())}` : ''}
          </Banner>
        )}
        {status === 'loading' && !plan && (
          <div style={{ textAlign: 'center', padding: space.xl, color: colour.inkFaint }}>Loading…</div>
        )}

        {sourceErrors.map(({ source, error, shareWith }) => (
          <Banner key={source} tone="warning">
            <strong>
              {source === 'leave'
                ? 'Leave is not showing this week.'
                : `The ${source} calendar could not be read.`}
            </strong>
            <br />
            {source === 'leave'
              ? 'Nobody will appear as on leave even if they are.'
              : error}
            {shareWith && (
              <>
                <br /><br />
                In Google Calendar, open{' '}
                {source === 'leave' ? 'Staff Leave' : 'the calendar'} → Settings and sharing →
                Share with specific people, and add:
                {/* Selectable, because this is meant to be copied on a phone. */}
                <span style={{
                  display: 'block', marginTop: 4, wordBreak: 'break-all',
                  userSelect: 'text', WebkitUserSelect: 'text', fontWeight: 600
                }}>{shareWith}</span>
                with “See all event details”.
              </>
            )}
          </Banner>
        ))}

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
              ? <DayPanel day={dayPlan} onOpen={setEditing} onReorder={reorder}
                  onSetPlace={setPlacing} />
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
            {/* Orderable here too. The running order is always set for a day
                that is not today — the hospital rings about four o'clock about
                tomorrow — and the week is where anybody looks ahead. Having to
                find the day first, in a view that had no arrows, meant the one
                thing this was built for was the awkward one. */}
            <DayPanel day={day} onOpen={setEditing} onReorder={reorder}
              onSetPlace={setPlacing} />
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

      {placing && (
        <ListPlace
          surgicalCase={placing}
          onSave={place => setListPlace(placing.id, place)}
          onClose={() => setPlacing(null)} />
      )}

      {adding && (
        <NewBooking
          user={user}
          date={adding}
          // What is already booked that day, so the sheet can tell when a
          // second case wants a kit there is only one of. Passed from the plan
          // already on screen rather than fetched again.
          alreadyBooked={((plan?.days || []).find(d => d.date === adding)?.casesByHospital || [])
            .flatMap(g => g.cases)
            .filter(c => !c.cancelled)}
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
