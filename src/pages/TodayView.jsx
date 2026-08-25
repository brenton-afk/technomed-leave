import React, { useState, useEffect, useCallback } from 'react'
import { useLiveRefresh } from '../liveRefresh.js'
import { Page, Header, Body } from '../design/Shell.jsx'
import { colour, text, space, radius, border } from '../design/tokens.js'
import { accentTextForCase, NAVIGATION_ACCENT } from '../clinicalPlan/theme.js'
import { surgeonForColourName, colourNameFor, colourHexFor } from '../clinicalPlan/colours.js'
import { hospitalCode } from '../clinicalPlan/labelledFields.js'
import { readBooking, isCancelled } from '../clinicalPlan/parse.js'
import {
  todayStr, parseDateStr, toDateStr, addCivilDays, mondayOf, civilWeekday, zonedCivil,
  weekdayName
} from '../clinicalPlan/week.js'
import { classifyItem } from '../clinicalPlan/itemKind.js'

// The palette lives in clinicalPlan/colours.js, so this screen and the case plan
// cannot drift apart. It used to be a second copy here, and three of its entries
// were a place out — a Basil booking, which is Gupta's colour, drew pink.
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getColor(colorId) { return colourHexFor(colorId) || colour.navy }

/**
 * What a booking is, and how to draw it.
 *
 * This screen used to print the calendar's title exactly as typed, which is why
 * the system and kit text showed through raw and often twice — a title reading
 * "Kennedy REFORM/ASCOT/ATHLET - JPW" with a note reading "Kit: Athlet, Ascot +
 * Reform" was rendered as both. It now goes through the same reader as the case
 * plan, so a case says the same thing on both screens.
 */
function describe(event) {
  const colourSurgeon = surgeonForColourName(colourNameFor(event.colorId))
  const read = event.allDay ? null : readBooking(event.title, event.description, { colourSurgeon })
  // The border is the calendar's own colour, so the app agrees with what the
  // person who made the booking sees in Google. Navigation is the one exception:
  // a Varioguide, Brainlab or AIRO case needs the platform booked, set up and
  // calibrated, which changes what the day asks of whoever is covering it.
  const navigation = NAVIGATION_PATTERN.test(`${event.title || ''}\n${event.description || ''}`)
  const border = navigation ? NAVIGATION_ACCENT : getColor(event.colorId)
  const cancelled = isCancelled(event.title, event.description)
  if (!read) {
    // Leave, a meeting, rostered hours, a reminder. All of it used to be drawn
    // as a title and a time, so a week's planning information read as one
    // undifferentiated list and the things that change what a day asks of the
    // team looked exactly like the things that do not.
    const { kind, label } = classifyItem({
      title: event.title, description: event.description, colourName: colourNameFor(event.colorId)
    })
    return { isCase: false, border, cancelled, kind, kindLabel: label }
  }
  // The surgeon's name in the booking's own colour — darkened only as far as it
  // must be to read on white. Blueberry for a navigation case, so the name and
  // the border agree.
  const surgeonColour = accentTextForCase(
    { ...read, colourHex: colourHexFor(event.colorId) })
  // A cancelled booking is drawn grey whatever colour it was. The colour means
  // "this surgeon, this day"; keeping it would say the day is still committed.
  return { isCase: true, read, cancelled, surgeonColour, border: cancelled ? colour.line : border }
}

const NAVIGATION_PATTERN = /vario\s*guide|brain\s*lab|\bairo\b/i

/** The system and how it is supplied, as one line. Uppercase, as the plan shows it. */
function systemLine(read) {
  const system = read.system ? read.system.toUpperCase() : undefined
  return [system, read.supply].filter(Boolean).join(' · ')
}

/**
 * A case card: three lines at most, and never a line of raw notes.
 *
 * Anything that could not be read is left out rather than shown as it was typed.
 * A raw line looks like data, so it is worse than a missing one — it takes a
 * second reading to work out that the app did not understand the booking.
 */
function CaseCard({ described, compact = false }) {
  const { read, surgeonColour, cancelled } = described
  const system = systemLine(read)
  return (
    <>
      <div style={{
        fontSize: 14, fontWeight: 600, color: cancelled ? colour.inkFaint : colour.navy,
        // Struck through rather than removed. The slot was booked and is now
        // free, which is information — and a case vanishing from a plan somebody
        // printed this morning is worse than one shown crossed out.
        textDecoration: cancelled ? 'line-through' : 'none'
      }}>
        {read.patient}
        <span style={{ color: colour.inkFainter, fontWeight: 400 }}> / </span>
        <span style={{ color: cancelled ? colour.inkFaint : surgeonColour }}>{read.surgeon}</span>
      </div>
      {cancelled && (
        <div style={{
          display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: radius.pill,
          background: colour.dangerSoft, color: colour.danger,
          // `micro` is the scale's uppercase label size. The type scale is closed
          // and a test enforces it — see design/consistency.test.js.
          ...text('micro'), textTransform: 'uppercase'
        }}>
          Cancelled
        </div>
      )}
      {read.operation && (
        <div style={{ fontSize: 12.5, color: colour.ink, marginTop: 2 }}>{read.operation}</div>
      )}
      {system && (
        <div style={{ fontSize: 12.5, color: colour.inkFaint, marginTop: 2, letterSpacing: '0.2px' }}>
          {system}
        </div>
      )}
    </>
  )
}

/**
 * Anything on the calendar that is not a theatre case.
 *
 * Deliberately quieter than a case rather than a different colour. The palette is
 * one accent by design, and giving leave, meetings, hours and reminders a hue each
 * would turn the day into a chart — five new colours competing with the surgeon
 * colours, which are the ones that carry real meaning.
 *
 * So the hierarchy does the work: a case is a white card with a thick coloured
 * bar, and everything else sits on the page ground with a thin one and says what
 * it is. Cases read first, at a glance, and the rest is still there to be read.
 */
function ItemCard({ event, described }) {
  const { kindLabel, cancelled } = described
  const time = formatTime(event.start)
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{
          ...text('bodyStrong'), color: cancelled ? colour.inkFaint : colour.ink, minWidth: 0,
          ...(cancelled ? { textDecoration: 'line-through' } : {})
        }}>
          {event.title}
        </div>
        <span style={{
          ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
          background: colour.lineSoft, borderRadius: radius.pill, padding: '2px 7px', flexShrink: 0
        }}>
          {cancelled ? 'Cancelled' : kindLabel}
        </span>
      </div>
      {(time || event.location) && (
        <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>
          {[time && `${time}${formatTime(event.end) ? ` – ${formatTime(event.end)}` : ''}`,
            event.location].filter(Boolean).join(' · ')}
        </div>
      )}
    </>
  )
}

/** The repeated uppercase group label. */
function SectionHeading({ children }) {
  return (
    <div style={{
      // `micro` is the scale's token for exactly this: an uppercase eyebrow
      // label. These were 12.5px bold with their own letter-spacing, which is a
      // size the scale does not have.
      ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', marginBottom: 8
    }}>
      {children}
    </div>
  )
}

/**
 * One row of the day, case or otherwise.
 *
 * The coloured panel down the left is the thing worth keeping from this screen —
 * it is what makes a day scannable — so both shapes have one, taken from the
 * calendar's own colour. What separates them is weight: a case is a white card
 * with a thick bar, and everything else sits on the page ground with a thin one.
 */
function ItemRow({ event, described }) {
  const { isCase } = described
  return (
    <div style={{
      background: isCase ? colour.surface : 'transparent',
      borderRadius: radius.card, marginBottom: 10, overflow: 'hidden', display: 'flex',
      border: `1px solid ${isCase ? colour.line : colour.lineSoft}`
    }}>
      <div aria-hidden="true"
        style={{ width: isCase ? 5 : 3, background: described.border, flexShrink: 0 }} />
      <div style={{ padding: isCase ? '12px 14px' : '10px 13px', flex: 1, minWidth: 0 }}>
        {isCase
          ? <CaseCard described={described} />
          : <ItemCard event={event} described={described} />}
      </div>
    </div>
  )
}

// RHH first, matching the order the case plan and the emailed document use.
const HOSPITAL_RANK = { RHH: 0, CLV: 1 }

/**
 * Groups a day's cases under their hospital, and leaves everything else after.
 *
 * The hospital is on the card's heading rather than the card, since every card
 * beneath a heading shares it.
 */
function groupByHospital(events) {
  const groups = new Map()
  const other = []
  for (const event of events) {
    const described = describe(event)
    if (!described.isCase) { other.push({ event, described }); continue }
    const code = described.read.hospital || hospitalCode(event.location) || 'Other'
    if (!groups.has(code)) groups.set(code, [])
    groups.get(code).push({ event, described })
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    (HOSPITAL_RANK[a[0]] ?? 9) - (HOSPITAL_RANK[b[0]] ?? 9) || a[0].localeCompare(b[0]))
  return { groups: ordered, other }
}

function formatTime(dateStr) {
  if (!dateStr || !dateStr.includes('T')) return null
  const d = new Date(dateStr)
  // Pinned to Hobart rather than left to the device. Every other part of the app
  // fixes the timezone, and this did not — so a rep away for a conference saw the
  // day's bookings shifted into wherever they happened to be standing.
  return d.toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Hobart', hour: 'numeric', minute: '2-digit', hour12: true
  }).toLowerCase().replace(/\s+/g, '')
}

// ─── Days are Hobart dates, written as strings ───────────────────────────────
// Not Date objects, and this is the fix for the app "getting the dates mixed up".
//
// The day was held as a `Date` and turned into a key with `toISOString()`, which
// is UTC — while the heading beside it came from `getDay()` and `getDate()`,
// which are the device's. In Hobart those two disagree for the first ten hours of
// every day (eleven in summer): at 8am on a Tuesday the heading read Tuesday and
// the events shown were Monday's. After 10am it agreed with itself again, which
// is why it looked intermittent.
//
// A `YYYY-MM-DD` string in Australia/Hobart has no such ambiguity, and the plan
// has used exactly this — `src/clinicalPlan/week.js` — all along. This screen
// simply was not using it.

/** The seven Hobart days of the week containing `dayStr`, Monday first. */
function weekDaysOf(dayStr) {
  const monday = mondayOf(parseDateStr(dayStr))
  return Array.from({ length: 7 }, (_, i) => toDateStr(addCivilDays(monday, i)))
}

const shiftDay = (dayStr, days) => toDateStr(addCivilDays(parseDateStr(dayStr), days))

/**
 * Whether a booking falls on a given Hobart day.
 *
 * Two corrections. A timed event is placed by converting its instant into a
 * Hobart date rather than by slicing the string it arrived as — Google returns
 * whatever offset the calendar is set to, and taking the characters before the
 * "T" trusts that offset to be Hobart's.
 *
 * An all-day event covers every day of its range, not only the first. Google's
 * all-day end date is exclusive. Leave is entered as one all-day booking across
 * a week, and it was appearing on the Monday and nowhere else.
 */
function eventOnDate(event, dayStr) {
  if (!event.start) return false
  if (event.allDay || !String(event.start).includes('T')) {
    const from = String(event.start).slice(0, 10)
    const toExclusive = event.end ? String(event.end).slice(0, 10) : null
    if (!toExclusive || toExclusive <= from) return dayStr === from
    return dayStr >= from && dayStr < toExclusive
  }
  const at = new Date(event.start)
  if (Number.isNaN(at.getTime())) return false
  return toDateStr(zonedCivil(at)) === dayStr
}

export default function TodayView({ user, switcher }) {
  const [view, setView] = useState('day')
  const [selectedDay, setSelectedDay] = useState(() => todayStr())
  const [weekAnchor, setWeekAnchor] = useState(() => todayStr())
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [syncedAt, setSyncedAt] = useState(null)

  // `quiet` is a poll rather than a first load: it must not put a spinner over
  // real content, and a failure must not blank it. Someone standing in a corridor
  // reading today's list should keep the list when the wifi drops.
  const loadEvents = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) { setLoading(true); setError(null) }
    try {
      const res = await fetch('/api/calendar/today', {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEvents(data.events || [])
      setSyncedAt(Date.now())
      setError(null)
    } catch (err) {
      if (!quiet) setError(err.message)
    }
    if (!quiet) setLoading(false)
  }, [user?.token])

  useEffect(() => { loadEvents() }, [loadEvents])

  // This screen used to fetch once on mount and never again, so it showed
  // whatever the calendar said when it was opened — which is how a case
  // cancelled for the next day was still on it. The week plan already polled;
  // this did not, and nothing connected the two.
  useLiveRefresh(useCallback(() => loadEvents({ quiet: true }), [loadEvents]), [loadEvents])

  // Recomputed on every render rather than held in state, so a screen left open
  // over midnight does not go on calling yesterday "Today".
  const today = todayStr()
  const weekDates = weekDaysOf(weekAnchor)
  const dayEvents = events.filter(e => eventOnDate(e, selectedDay))
  const allDayEvents = dayEvents.filter(e => e.allDay)
  const timedEvents = dayEvents.filter(e => !e.allDay)

  function prevWeek() { setWeekAnchor(shiftDay(weekAnchor, -7)) }
  function nextWeek() { setWeekAnchor(shiftDay(weekAnchor, 7)) }

  function selectDay(day) { setSelectedDay(day); setWeekAnchor(day); setView('day') }

  function goToDay(offset) {
    const next = shiftDay(selectedDay, offset)
    setSelectedDay(next)
    setWeekAnchor(next)
  }

  const isToday = day => day === today
  const isSelected = day => day === selectedDay
  function eventsOnDay(day) { return events.filter(e => eventOnDate(e, day)) }

  /** Day-of-month, month name and weekday, all read off the Hobart date string. */
  const dayNum = day => parseDateStr(day).day
  const monthShort = day => MONTHS_SHORT[parseDateStr(day).month - 1]
  const monthLong = day => MONTHS[parseDateStr(day).month - 1]
  const weekdayShort = day => DAYS[civilWeekday(parseDateStr(day)) - 1]

  return (
    <Page style={{ display:'flex', flexDirection:'column' }}>
      <Header eyebrow="This week" title="Calendar" subtitle="Everything the bookings calendar holds">
        {switcher}
        {/* Day or week, within the calendar view */}
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setView('day')} style={{ padding:'6px 16px', borderRadius:20, border:'none', background: view==='day'?'white':'rgba(255,255,255,0.12)', color: view==='day'?colour.navy:'white', fontSize:14, fontWeight:600, cursor:'pointer' }}>Day</button>
          <button onClick={() => setView('week')} style={{ padding:'6px 16px', borderRadius:20, border:'none', background: view==='week'?'white':'rgba(255,255,255,0.12)', color: view==='week'?colour.navy:'white', fontSize:14, fontWeight:600, cursor:'pointer' }}>Week</button>
          <button onClick={() => { const now = todayStr(); setSelectedDay(now); setWeekAnchor(now); setView('day') }} style={{ padding:'6px 16px', borderRadius:20, border:'1px solid rgba(255,255,255,0.3)', background:'transparent', color:'rgba(255,255,255,0.7)', fontSize:14, cursor:'pointer', marginLeft:'auto' }}>Today</button>
        </div>

        {/* Week strip */}
        <div style={{ background:'rgba(0,0,0,0.15)', borderRadius:'12px 12px 0 0', padding:'10px 8px 0' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, padding:'0 4px' }}>
            <button onClick={prevWeek} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:19, cursor:'pointer', padding:'0 4px' }}>‹</button>
            <span style={{ fontSize:14, fontWeight:600, color:'rgba(255,255,255,0.8)' }}>
              {monthShort(weekDates[0])} {dayNum(weekDates[0])} – {monthShort(weekDates[6])} {dayNum(weekDates[6])}, {parseDateStr(weekDates[6]).year}
            </span>
            <button onClick={nextWeek} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:19, cursor:'pointer', padding:'0 4px' }}>›</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, paddingBottom:0 }}>
            {weekDates.map(day => {
              const dayEvs = eventsOnDay(day)
              const sel = isSelected(day)
              const tod = isToday(day)
              return (
                <button key={day} onClick={() => selectDay(day)} style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'6px 2px 10px', background: sel?'rgba(24,154,133,0.25)':'transparent', border:'none', borderRadius:'8px 8px 0 0', cursor:'pointer', borderBottom: sel?`3px solid ${colour.accent}`:'3px solid transparent' }}>
                  <span style={{ fontSize:10.5, color: tod?colour.accent:'rgba(255,255,255,0.5)', fontWeight: tod?'700':'400', marginBottom:4 }}>{weekdayShort(day)}</span>
                  <span style={{ fontSize:16, fontWeight: sel||tod?'700':'400', color: tod?colour.accent:'white', width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%' }}>{dayNum(day)}</span>
                  <div style={{ display:'flex', gap:2, marginTop:4, height:6 }}>
                    {dayEvs.slice(0,3).map((e,j) => <div key={j} style={{ width:5, height:5, borderRadius:'50%', background: describe(e).border }} />)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </Header>

      {/* WEEK VIEW */}
      {view === 'week' && (
        <div style={{ flex:1, padding:'16px 16px 100px', overflowY:'auto' }}>
          <div style={{ fontSize:16, fontWeight:700, color:colour.navy, marginBottom:12 }}>
            Week of {dayNum(weekDates[0])} {monthLong(weekDates[0])}
          </div>
          {loading && <div style={{ textAlign:'center', padding:40, color:colour.inkFaint }}>Loading...</div>}
          {weekDates.map((day, i) => {
            const dayEvs = eventsOnDay(day)
            const tod = isToday(day)
            return (
              <div key={day} style={{ marginBottom:12 }}>
                <button onClick={() => selectDay(day)} style={{ display:'flex', alignItems:'center', gap:10, background:'none', border:'none', cursor:'pointer', marginBottom:6, padding:0, width:'100%', textAlign:'left' }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background: tod?colour.accent:colour.navy, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span style={{ fontSize:14, fontWeight:700, color:'white' }}>{dayNum(day)}</span>
                  </div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:700, color: tod?colour.accent:colour.navy }}>{tod ? 'Today' : weekdayName(day)}</div>
                    <div style={{ fontSize:12.5, color:colour.inkFainter }}>{monthShort(day)} {dayNum(day)}</div>
                  </div>
                  <div style={{ marginLeft:'auto', fontSize:12.5, color:colour.inkFainter }}>{dayEvs.length > 0 ? `${dayEvs.length} event${dayEvs.length>1?'s':''}` : 'No bookings'} →</div>
                </button>
                {dayEvs.length > 0 && (
                  <div style={{ marginLeft:46 }}>
                    {dayEvs.slice(0,3).map(e => {
                      const d = describe(e)
                      return (
                        <div key={e.id} onClick={() => selectDay(day)} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background:'white', borderRadius:8, marginBottom:4, cursor:'pointer', borderLeft:`3px solid ${d.border}` }}>
                          <div style={{ flex:1 }}>
                            {d.isCase ? <CaseCard described={d} compact /> : (
                              <>
                                <div style={{ fontSize:14, fontWeight:500, color:colour.navy }}>{e.title}</div>
                                {formatTime(e.start) && <div style={{ fontSize:12.5, color:colour.inkFainter }}>{formatTime(e.start)}{formatTime(e.end)?` – ${formatTime(e.end)}`:''}{e.location?` · ${e.location}`:''}</div>}
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {dayEvs.length > 3 && (
                      <div onClick={() => selectDay(day)} style={{ fontSize:12.5, color:colour.accent, padding:'4px 10px', cursor:'pointer', fontWeight:600 }}>+{dayEvs.length-3} more →</div>
                    )}
                  </div>
                )}
                {i < 6 && <div style={{ height:1, background:'rgba(26,43,74,0.08)', marginTop:8 }} />}
              </div>
            )
          })}
          <button onClick={loadEvents} style={{ width:'100%', padding:12, background:'transparent', border:'1px solid rgba(26,43,74,0.15)', borderRadius:8, fontSize:14, color:colour.inkFaint, cursor:'pointer', marginTop:8 }}>↻ Refresh</button>
        </div>
      )}

      {/* DAY VIEW */}
      {view === 'day' && (
        <div style={{ flex:1, padding:'16px 16px 100px', overflowY:'auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:22, fontWeight:'700', color:colour.navy }}>{isToday(selectedDay)?'Today':weekdayName(selectedDay)}</div>
              <div style={{ fontSize:14, color:colour.inkFaint }}>{dayNum(selectedDay)} {monthLong(selectedDay)} {parseDateStr(selectedDay).year}</div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => goToDay(-1)} style={{ width:36, height:36, borderRadius:'50%', background:'white', border:'1px solid rgba(26,43,74,0.12)', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>‹</button>
              <button onClick={() => goToDay(1)} style={{ width:36, height:36, borderRadius:'50%', background:'white', border:'1px solid rgba(26,43,74,0.12)', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>›</button>
            </div>
          </div>

          {loading && <div style={{ textAlign:'center', padding:'40px 20px', color:colour.inkFaint }}>Loading calendar...</div>}
          {error && <div style={{ background:colour.dangerSoft, color:colour.danger, padding:'12px 14px', borderRadius:10, fontSize:14, marginBottom:12 }}>Could not load calendar: {error}</div>}

          {!loading && allDayEvents.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <SectionHeading>All day</SectionHeading>
              {/* These were solid blocks of the calendar's colour with white text
                  on them, which made leave the loudest thing on a day full of
                  operating. Same card as everything else now, so the day reads in
                  order of what it asks of you. */}
              {allDayEvents.map(e => <ItemRow key={e.id} event={e} described={describe(e)} />)}
            </div>
          )}

          {!loading && timedEvents.length > 0 && (() => {
            const { groups, other } = groupByHospital(timedEvents)
            const card = ({ event, described }) => (
              <ItemRow key={event.id} event={event} described={described} />
            )
            return (
              <div>
                {groups.map(([code, items]) => (
                  <div key={code} style={{ marginBottom:6 }}>
                    <SectionHeading>{code} · {items.length} case{items.length === 1 ? '' : 's'}</SectionHeading>
                    {items.map(card)}
                  </div>
                ))}
                {other.length > 0 && (
                  <div>
                    <SectionHeading>{groups.length ? 'Also on' : 'Schedule'}</SectionHeading>
                    {other.map(card)}
                  </div>
                )}
              </div>
            )
          })()}

          {!loading && !error && dayEvents.length === 0 && (
            <div style={{ textAlign:'center', padding:'40px 20px' }}>
              <div style={{ fontSize:40, marginBottom:12 }}>✨</div>
              <div style={{ fontSize:16, fontWeight:600, color:colour.navy, marginBottom:6 }}>No bookings</div>
              <div style={{ fontSize:14, color:colour.inkFaint }}>Nothing scheduled for this day</div>
            </div>
          )}

          <button onClick={loadEvents} style={{ width:'100%', padding:12, background:'transparent', border:'1px solid rgba(26,43,74,0.15)', borderRadius:8, fontSize:14, color:colour.inkFaint, cursor:'pointer', marginTop:8 }}>↻ Refresh</button>
        </div>
      )}
    </Page>
  )
}
