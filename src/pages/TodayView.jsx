import React, { useState, useEffect } from 'react'
import { Page, Header, Body } from '../design/Shell.jsx'
import { colour, text, space, radius, border } from '../design/tokens.js'
import { readBooking } from '../clinicalPlan/parse.js'
import { accentTextFor, NAVIGATION_ACCENT } from '../clinicalPlan/theme.js'
import { surgeonForColourName, colourNameFor } from '../clinicalPlan/colours.js'
import { hospitalCode } from '../clinicalPlan/labelledFields.js'

// Google Calendar's event palette, by colorId. Three of these were wrong: 9, 10
// and 11 were carrying Basil, Tomato and Graphite's values a place out, so a
// Basil booking — Gupta's colour — drew pink, and Blueberry drew green. The
// colour is how surgeon allocation is read at a glance, so being a place out is
// not cosmetic.
const COLOR_MAP = {
  '1':'#7986cb','2':'#33b679','3':'#8e24aa','4':'#e67c73',
  '5':'#f6c026','6':'#f5511d','7':'#039be5','8':'#616161',
  '9':'#3f51b5','10':'#0b8043','11':'#d50000'
}
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const DAYS_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getColor(colorId) { return COLOR_MAP[colorId] || colour.navy }

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
  if (!read) return { isCase: false, border }
  return { isCase: true, read, border, surgeonColour: accentTextFor(read.surgeon) }
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
  const { read, surgeonColour } = described
  const system = systemLine(read)
  return (
    <>
      <div style={{ fontSize: 14, fontWeight: 600, color: colour.navy }}>
        {read.patient}
        <span style={{ color: colour.inkFainter, fontWeight: 400 }}> / </span>
        <span style={{ color: surgeonColour }}>{read.surgeon}</span>
      </div>
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

function dateKey(date) {
  return date.toISOString().split('T')[0]
}

function getWeekDates(baseDate) {
  const dates = []
  const start = new Date(baseDate)
  start.setDate(start.getDate() - start.getDay())
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    dates.push(d)
  }
  return dates
}

function eventOnDate(event, dateStr) {
  if (!event.start) return false
  return event.start.split('T')[0] === dateStr
}

export default function TodayView({ user, onBack }) {
  const [view, setView] = useState('day')
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [weekBase, setWeekBase] = useState(new Date())
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { loadEvents() }, [])

  async function loadEvents() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/calendar/today')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEvents(data.events || [])
    } catch(err) { setError(err.message) }
    setLoading(false)
  }

  const today = new Date()
  const weekDates = getWeekDates(weekBase)
  const selectedKey = dateKey(selectedDate)
  const dayEvents = events.filter(e => eventOnDate(e, selectedKey))
  const allDayEvents = dayEvents.filter(e => e.allDay)
  const timedEvents = dayEvents.filter(e => !e.allDay)

  function prevWeek() { const d = new Date(weekBase); d.setDate(d.getDate()-7); setWeekBase(d) }
  function nextWeek() { const d = new Date(weekBase); d.setDate(d.getDate()+7); setWeekBase(d) }

  function selectDay(date) { setSelectedDate(date); setView('day') }

  function goToDay(offset) {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + offset)
    setSelectedDate(d)
    setWeekBase(d)
  }

  const isToday = (d) => dateKey(d) === dateKey(today)
  const isSelected = (d) => dateKey(d) === selectedKey
  function eventsOnDay(date) { return events.filter(e => eventOnDate(e, dateKey(date))) }

  return (
    <Page style={{ display:'flex', flexDirection:'column' }}>
      <Header eyebrow="Case support" title="Calendar" subtitle="Bookings and leave, week by week" onBack={onBack}>
        {/* View toggle */}
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setView('day')} style={{ padding:'6px 16px', borderRadius:20, border:'none', background: view==='day'?'white':'rgba(255,255,255,0.12)', color: view==='day'?colour.navy:'white', fontSize:14, fontWeight:600, cursor:'pointer' }}>Day</button>
          <button onClick={() => setView('week')} style={{ padding:'6px 16px', borderRadius:20, border:'none', background: view==='week'?'white':'rgba(255,255,255,0.12)', color: view==='week'?colour.navy:'white', fontSize:14, fontWeight:600, cursor:'pointer' }}>Week</button>
          <button onClick={() => { setSelectedDate(new Date()); setWeekBase(new Date()); setView('day') }} style={{ padding:'6px 16px', borderRadius:20, border:'1px solid rgba(255,255,255,0.3)', background:'transparent', color:'rgba(255,255,255,0.7)', fontSize:14, cursor:'pointer', marginLeft:'auto' }}>Today</button>
        </div>

        {/* Week strip */}
        <div style={{ background:'rgba(0,0,0,0.15)', borderRadius:'12px 12px 0 0', padding:'10px 8px 0' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, padding:'0 4px' }}>
            <button onClick={prevWeek} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:19, cursor:'pointer', padding:'0 4px' }}>‹</button>
            <span style={{ fontSize:14, fontWeight:600, color:'rgba(255,255,255,0.8)' }}>
              {MONTHS_SHORT[weekDates[0].getMonth()]} {weekDates[0].getDate()} – {MONTHS_SHORT[weekDates[6].getMonth()]} {weekDates[6].getDate()}, {weekDates[6].getFullYear()}
            </span>
            <button onClick={nextWeek} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:19, cursor:'pointer', padding:'0 4px' }}>›</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, paddingBottom:0 }}>
            {weekDates.map((date, i) => {
              const dayEvs = eventsOnDay(date)
              const sel = isSelected(date)
              const tod = isToday(date)
              return (
                <button key={i} onClick={() => selectDay(date)} style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'6px 2px 10px', background: sel?'rgba(24,154,133,0.25)':'transparent', border:'none', borderRadius:'8px 8px 0 0', cursor:'pointer', borderBottom: sel?`3px solid ${colour.accent}`:'3px solid transparent' }}>
                  <span style={{ fontSize:10.5, color: tod?colour.accent:'rgba(255,255,255,0.5)', fontWeight: tod?'700':'400', marginBottom:4 }}>{DAYS[date.getDay()]}</span>
                  <span style={{ fontSize:16, fontWeight: sel||tod?'700':'400', color: tod?colour.accent:'white', width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%' }}>{date.getDate()}</span>
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
            Week of {weekDates[0].getDate()} {MONTHS[weekDates[0].getMonth()]}
          </div>
          {loading && <div style={{ textAlign:'center', padding:40, color:colour.inkFaint }}>Loading...</div>}
          {weekDates.map((date, i) => {
            const dayEvs = eventsOnDay(date)
            const tod = isToday(date)
            return (
              <div key={i} style={{ marginBottom:12 }}>
                <button onClick={() => selectDay(date)} style={{ display:'flex', alignItems:'center', gap:10, background:'none', border:'none', cursor:'pointer', marginBottom:6, padding:0, width:'100%', textAlign:'left' }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background: tod?colour.accent:colour.navy, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <span style={{ fontSize:14, fontWeight:700, color:'white' }}>{date.getDate()}</span>
                  </div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:700, color: tod?colour.accent:colour.navy }}>{tod ? 'Today' : DAYS_FULL[date.getDay()]}</div>
                    <div style={{ fontSize:12.5, color:colour.inkFainter }}>{MONTHS_SHORT[date.getMonth()]} {date.getDate()}</div>
                  </div>
                  <div style={{ marginLeft:'auto', fontSize:12.5, color:colour.inkFainter }}>{dayEvs.length > 0 ? `${dayEvs.length} event${dayEvs.length>1?'s':''}` : 'No bookings'} →</div>
                </button>
                {dayEvs.length > 0 && (
                  <div style={{ marginLeft:46 }}>
                    {dayEvs.slice(0,3).map(e => {
                      const d = describe(e)
                      return (
                        <div key={e.id} onClick={() => selectDay(date)} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background:'white', borderRadius:8, marginBottom:4, cursor:'pointer', borderLeft:`3px solid ${d.border}` }}>
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
                      <div onClick={() => selectDay(date)} style={{ fontSize:12.5, color:colour.accent, padding:'4px 10px', cursor:'pointer', fontWeight:600 }}>+{dayEvs.length-3} more →</div>
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
              <div style={{ fontSize:22, fontWeight:'700', color:colour.navy }}>{isToday(selectedDate)?'Today':DAYS_FULL[selectedDate.getDay()]}</div>
              <div style={{ fontSize:14, color:colour.inkFaint }}>{selectedDate.getDate()} {MONTHS[selectedDate.getMonth()]} {selectedDate.getFullYear()}</div>
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
              <div style={{ fontSize:12.5, fontWeight:600, color:colour.inkFaint, letterSpacing:'1px', textTransform:'uppercase', marginBottom:8 }}>All day</div>
              {allDayEvents.map(e => (
                <div key={e.id} style={{ background:getColor(e.colorId), borderRadius:10, padding:'10px 14px', marginBottom:8 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:'white' }}>{e.title}</div>
                  {e.location && <div style={{ fontSize:12.5, color:'rgba(255,255,255,0.75)', marginTop:2 }}>📍 {e.location}</div>}
                </div>
              ))}
            </div>
          )}

          {!loading && timedEvents.length > 0 && (() => {
            const { groups, other } = groupByHospital(timedEvents)
            const card = ({ event, described }) => (
              <div key={event.id} style={{ background:'white', borderRadius:12, marginBottom:10, overflow:'hidden', display:'flex', border:'1px solid rgba(26,43,74,0.06)' }}>
                <div style={{ width:5, background:described.border, flexShrink:0 }} />
                <div style={{ padding:'12px 14px', flex:1 }}>
                  {described.isCase ? <CaseCard described={described} /> : (
                    <>
                      <div style={{ fontSize:14, fontWeight:600, color:colour.navy, marginBottom:3 }}>{event.title}</div>
                      {/* Meetings and handovers keep their times: unlike a
                          theatre list, those do not move. */}
                      {formatTime(event.start) && <div style={{ fontSize:12.5, color:colour.inkFaint, marginBottom:event.location?3:0 }}>🕐 {formatTime(event.start)}{formatTime(event.end)?` – ${formatTime(event.end)}`:''}</div>}
                      {event.location && <div style={{ fontSize:12.5, color:colour.inkFaint }}>📍 {event.location}</div>}
                    </>
                  )}
                </div>
              </div>
            )
            return (
              <div>
                {groups.map(([code, items]) => (
                  <div key={code} style={{ marginBottom:6 }}>
                    <div style={{ fontSize:12.5, fontWeight:700, color:colour.inkFaint, letterSpacing:'1px', textTransform:'uppercase', marginBottom:8 }}>
                      {code} · {items.length} case{items.length === 1 ? '' : 's'}
                    </div>
                    {items.map(card)}
                  </div>
                ))}
                {other.length > 0 && (
                  <div>
                    <div style={{ fontSize:12.5, fontWeight:700, color:colour.inkFaint, letterSpacing:'1px', textTransform:'uppercase', marginBottom:8 }}>
                      {groups.length ? 'Also on' : 'Schedule'}
                    </div>
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
