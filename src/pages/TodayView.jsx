import React, { useState, useEffect } from 'react'

const COLOR_MAP = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
  '5': '#f6c026', '6': '#f5511d', '7': '#039be5', '8': '#616161',
  '9': '#0b8043', '10': '#d81b60', '11': '#616161'
}

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function formatTime(dateStr) {
  if (!dateStr || !dateStr.includes('T')) return null
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
}

function parseColor(colorId) {
  return COLOR_MAP[colorId] || '#042746'
}

function isLight(hex) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return (r*299 + g*587 + b*114) / 1000 > 128
}

export default function TodayView({ user }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [date, setDate] = useState('')

  useEffect(() => {
    fetch('/api/calendar/today')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setEvents(data.events || [])
        setDate(data.date || '')
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const now = new Date()
  const dayName = DAY_NAMES[now.getDay()]
  const dateDisplay = `${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`

  const allDayEvents = events.filter(e => e.allDay)
  const timedEvents = events.filter(e => !e.allDay)

  return (
    <div style={{ minHeight:'100vh', background:'#f0f3f7', fontFamily:'-apple-system,sans-serif' }}>
      {/* Header */}
      <div style={{ background:'#042746', padding:'48px 20px 20px' }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height:40, width:'auto', marginBottom:4 }} />
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:12 }}>Staff Portal</div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end' }}>
          <div>
            <div style={{ fontSize:28, fontWeight:'700', color:'white', lineHeight:1 }}>{dayName}</div>
            <div style={{ fontSize:14, color:'rgba(255,255,255,0.55)', marginTop:4 }}>{dateDisplay}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)' }}>Hi, {user?.name?.split(' ')[0]}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', marginTop:2 }}>Bookings Calendar</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding:'16px 16px 100px' }}>

        {loading && (
          <div style={{ textAlign:'center', padding:'60px 20px' }}>
            <div style={{ fontSize:32, marginBottom:12 }}>📅</div>
            <div style={{ color:'#6b7a8d', fontSize:14 }}>Loading today's schedule...</div>
          </div>
        )}

        {error && (
          <div style={{ background:'#fdecea', border:'1px solid rgba(192,57,43,0.2)', borderRadius:12, padding:'14px 16px', fontSize:13, color:'#c0392b', marginBottom:12 }}>
            Could not load calendar: {error}
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div style={{ textAlign:'center', padding:'60px 20px' }}>
            <div style={{ fontSize:48, marginBottom:16 }}>✨</div>
            <div style={{ fontSize:18, fontWeight:600, color:'#042746', marginBottom:8 }}>No bookings today</div>
            <div style={{ fontSize:14, color:'#6b7a8d' }}>Enjoy a clear schedule</div>
          </div>
        )}

        {!loading && allDayEvents.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#6b7a8d', letterSpacing:'1px', textTransform:'uppercase', marginBottom:8, paddingLeft:4 }}>All day</div>
            {allDayEvents.map(event => {
              const color = parseColor(event.colorId)
              const light = isLight(color)
              return (
                <div key={event.id} style={{ background:color, borderRadius:10, padding:'10px 14px', marginBottom:8 }}>
                  <div style={{ fontSize:14, fontWeight:600, color: light ? '#042746' : 'white' }}>{event.title}</div>
                  {event.location && <div style={{ fontSize:12, color: light ? 'rgba(4,39,70,0.6)' : 'rgba(255,255,255,0.7)', marginTop:2 }}>📍 {event.location}</div>}
                </div>
              )
            })}
          </div>
        )}

        {!loading && timedEvents.length > 0 && (
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:'#6b7a8d', letterSpacing:'1px', textTransform:'uppercase', marginBottom:8, paddingLeft:4 }}>Schedule</div>
            {timedEvents.map(event => {
              const color = parseColor(event.colorId)
              const startTime = formatTime(event.start)
              const endTime = formatTime(event.end)
              return (
                <div key={event.id} style={{ background:'white', borderRadius:12, marginBottom:10, overflow:'hidden', display:'flex', border:'1px solid rgba(26,43,74,0.06)' }}>
                  <div style={{ width:5, background:color, flexShrink:0 }} />
                  <div style={{ padding:'12px 14px', flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:600, color:'#042746', marginBottom:3 }}>{event.title}</div>
                    {startTime && (
                      <div style={{ fontSize:12, color:'#6b7a8d', marginBottom: event.location ? 3 : 0 }}>
                        🕐 {startTime}{endTime ? ` – ${endTime}` : ''}
                      </div>
                    )}
                    {event.location && (
                      <div style={{ fontSize:12, color:'#6b7a8d' }}>📍 {event.location}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Refresh button */}
        {!loading && (
          <button onClick={() => { setLoading(true); setError(null); fetch('/api/calendar/today').then(r=>r.json()).then(d=>{ setEvents(d.events||[]); setLoading(false) }).catch(e=>{ setError(e.message); setLoading(false) }) }}
            style={{ width:'100%', padding:12, background:'transparent', border:'1px solid rgba(26,43,74,0.15)', borderRadius:8, fontSize:13, color:'#6b7a8d', cursor:'pointer', marginTop:8 }}>
            ↻ Refresh
          </button>
        )}
      </div>
    </div>
  )
}
