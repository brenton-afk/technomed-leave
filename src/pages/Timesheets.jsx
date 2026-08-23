import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Page, Header } from '../design/Shell.jsx'
import { colour as tokenColour, text as typeToken } from '../design/tokens.js'

// Points at the shared tokens rather than redefining them, so this screen
// cannot drift from the rest of the app. Amber and purple stay local: here they
// are data categories (overtime, on-call), not decoration.
const NAVY = tokenColour.navy
const TEAL = tokenColour.accent
const BLUE = tokenColour.navySoft
const AMBER = '#f59e0b'
const PURPLE = '#8e24aa'
const MUTED = tokenColour.inkFaint
const BORDER = tokenColour.line

const COLOURS = { navy: NAVY, teal: TEAL, blue: BLUE, amber: AMBER, purple: PURPLE }
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STANDARD_DAY = 7.6
const STANDARD_WEEK = 38

// ─── Helpers (mirror api/_timesheetValidate.js) ──────────────

function round2(n) { return Math.round(n * 100) / 100 }

function computeTotals(entries, categories, days) {
  const byDay = {}, byCategory = {}
  let totalHours = 0, callouts = 0
  for (const cat of categories) {
    const cell = entries[cat.key] || {}
    let sum = 0
    for (const day of days) {
      const v = Number(cell[day] || 0)
      if (!v) continue
      sum += v
      if (cat.unit === 'hours') { byDay[day] = (byDay[day] || 0) + v; totalHours += v }
    }
    if (sum) byCategory[cat.key] = round2(sum)
    if (cat.unit === 'count') callouts += sum
  }
  const weekHours = [0, 1].map(w => round2(days.slice(w * 7, w * 7 + 7).reduce((s, d) => s + (byDay[d] || 0), 0)))
  return { byDay, byCategory, totalHours: round2(totalHours), callouts: round2(callouts), weekHours }
}

function dayNumber(dateStr) { return Number(dateStr.slice(8, 10)) }
function isWeekend(index) { return index % 7 >= 5 }

// ─── Number pad ──────────────────────────────────────────────

function NumberPad({ cell, categories, onSet, onClose }) {
  const category = categories.find(c => c.key === cell.categoryKey)
  const [value, setValue] = useState(cell.value ? String(cell.value) : '')
  const isCount = category?.unit === 'count'

  const press = k => setValue(v => {
    if (k === '.') return v.includes('.') ? v : (v === '' ? '0.' : v + '.')
    if (v === '0') return k
    return (v + k).slice(0, 5)
  })

  const quick = isCount ? [1, 2, 3] : [STANDARD_DAY, 4, 8, 12]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.55)', zIndex: 2000, display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'white', width: '100%', borderRadius: '18px 18px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{category?.label}</div>
          <div style={{ fontSize: 12.5, color: MUTED }}>{DAY_NAMES[cell.dayIndex % 7]} {cell.day.slice(8, 10)}/{cell.day.slice(5, 7)}</div>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>
          {isCount ? 'Number of callouts' : 'Hours'}{category?.hint ? ` · ${category.hint}` : ''}
        </div>

        <div style={{ background: tokenColour.canvas, borderRadius: 12, padding: '16px 18px', marginBottom: 12, textAlign: 'right', fontSize: 32, fontWeight: 700, color: NAVY, minHeight: 64, boxSizing: 'border-box' }}>
          {value || '0'}<span style={{ fontSize: 16, color: MUTED, marginLeft: 6 }}>{isCount ? '' : 'h'}</span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {quick.map(q => (
            <button key={q} onClick={() => setValue(String(q))}
              style={{ flex: 1, padding: '9px 0', background: '#eef4f3', color: TEAL, border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {q}{isCount ? '' : 'h'}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', isCount ? '' : '.', '0', '⌫'].map((k, i) => (
            <button key={i} disabled={!k} onClick={() => k === '⌫' ? setValue(v => v.slice(0, -1)) : k && press(k)}
              style={{ padding: '16px 0', background: k ? 'white' : 'transparent', border: k ? `1px solid ${BORDER}` : 'none', borderRadius: 10, fontSize: 19, fontWeight: 600, color: NAVY, cursor: k ? 'pointer' : 'default' }}>
              {k}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => { onSet(0); onClose() }}
            style={{ flex: 1, padding: 14, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 14, color: MUTED, cursor: 'pointer' }}>
            Clear
          </button>
          <button onClick={() => { onSet(Number(value) || 0); onClose() }}
            style={{ flex: 2, padding: 14, background: TEAL, color: 'white', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── On-call calculator ──────────────────────────────────────

function OnCallModal({ days, onApply, onClose }) {
  const [day, setDay] = useState(days[0])
  const [from, setFrom] = useState('17:00')
  const [to, setTo] = useState('07:00')

  const hours = useMemo(() => {
    const [fh, fm] = from.split(':').map(Number)
    const [th, tm] = to.split(':').map(Number)
    if ([fh, fm, th, tm].some(n => !Number.isFinite(n))) return 0
    let mins = (th * 60 + tm) - (fh * 60 + fm)
    if (mins <= 0) mins += 24 * 60 // crosses midnight
    return round2(mins / 60)
  }, [from, to])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 20, width: '100%', maxWidth: 380 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>On-call calculator</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16 }}>Overnight periods roll past midnight automatically.</div>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase' }}>Night starting</label>
        <select value={day} onChange={e => setDay(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, marginBottom: 12, background: 'white', color: NAVY }}>
          {days.map((d, i) => <option key={d} value={d}>{DAY_NAMES[i % 7]} {d.slice(8, 10)}/{d.slice(5, 7)}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          {[['From', from, setFrom], ['To', to, setTo]].map(([label, val, set]) => (
            <div key={label} style={{ flex: 1 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase' }}>{label}</label>
              <input type="time" value={val} onChange={e => set(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box', color: NAVY }} />
            </div>
          ))}
        </div>
        <div style={{ background: '#f4eefa', color: PURPLE, borderRadius: 10, padding: '12px 14px', fontSize: 14, fontWeight: 700, textAlign: 'center', marginBottom: 14 }}>
          {hours} on-call hours
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 13, background: tokenColour.canvas, border: 'none', borderRadius: 10, fontSize: 14, color: MUTED, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => { onApply(day, hours); onClose() }} disabled={!hours}
            style={{ flex: 2, padding: 13, background: hours ? PURPLE : '#c8d2dc', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: hours ? 'pointer' : 'default' }}>
            Add to timesheet
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Toni's admin / scientific split ─────────────────────────

function SplitModal({ days, onApply, onClose }) {
  const [day, setDay] = useState(days[0])
  const [hours, setHours] = useState(String(STANDARD_DAY))
  const [pct, setPct] = useState(50)

  const total = Number(hours) || 0
  const admin = round2(total * pct / 100)
  const scientific = round2(total - admin)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 20, width: '100%', maxWidth: 380 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Split a day</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16 }}>Divide the day between admin and scientific hours.</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase' }}>Day</label>
            <select value={day} onChange={e => setDay(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, background: 'white', color: NAVY }}>
              {days.map((d, i) => <option key={d} value={d}>{DAY_NAMES[i % 7]} {d.slice(8, 10)}/{d.slice(5, 7)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase' }}>Hours</label>
            <input type="number" step="0.1" value={hours} onChange={e => setHours(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box', color: NAVY }} />
          </div>
        </div>
        <input type="range" min="0" max="100" step="5" value={pct} onChange={e => setPct(Number(e.target.value))}
          style={{ width: '100%', marginBottom: 8, accentColor: NAVY }} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div style={{ flex: 1, background: '#eaeff4', color: NAVY, borderRadius: 10, padding: '11px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.4px', opacity: 0.7 }}>Admin {pct}%</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{admin}h</div>
          </div>
          <div style={{ flex: 1, background: '#eaf4fc', color: BLUE, borderRadius: 10, padding: '11px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.4px', opacity: 0.7 }}>Scientific {100 - pct}%</div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{scientific}h</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 13, background: tokenColour.canvas, border: 'none', borderRadius: 10, fontSize: 14, color: MUTED, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => { onApply(day, admin, scientific); onClose() }} disabled={!total}
            style={{ flex: 2, padding: 13, background: total ? TEAL : '#c8d2dc', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: total ? 'pointer' : 'default' }}>
            Apply split
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export default function Timesheets({ user, onBack }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState([])
  const [period, setPeriod] = useState(null)
  const [entries, setEntries] = useState({})
  const [activeWeek, setActiveWeek] = useState(0)
  const [padCell, setPadCell] = useState(null)
  const [showOnCall, setShowOnCall] = useState(false)
  const [showSplit, setShowSplit] = useState(false)
  const [callIns, setCallIns] = useState([])
  const [dismissedCallIns, setDismissedCallIns] = useState([])
  const [savedAt, setSavedAt] = useState('')
  const [stage, setStage] = useState('entry')
  const [submitted, setSubmitted] = useState(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState([])

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])

  useEffect(() => { boot() }, [])

  async function boot() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/timesheet/agent?action=payitems', { headers: authHeaders })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCategories(data.categories)
      setPeriod(data.period)

      const [draftRes, mineRes] = await Promise.all([
        fetch('/api/timesheet/agent?action=draft', { headers: authHeaders }).then(r => r.json()),
        fetch('/api/timesheet/agent?action=mine', { headers: authHeaders }).then(r => r.json())
      ])
      if (draftRes.draft?.periodStart === data.period.start) {
        setEntries(draftRes.draft.entries || {})
        setSavedAt(draftRes.draft.savedAt || '')
      }
      setHistory(mineRes.records || [])

      fetch(`/api/timesheet/agent?action=callins&periodStart=${data.period.start}`, { headers: authHeaders })
        .then(r => r.json()).then(d => setCallIns(d.suggestions || [])).catch(() => {})
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const days = period?.days || []
  const totals = useMemo(() => computeTotals(entries, categories, days), [entries, categories, days])

  const alreadySubmitted = history.find(r => r.periodStart === period?.start && r.status !== 'rejected')
  const rejected = history.find(r => r.periodStart === period?.start && r.status === 'rejected')

  const setCell = useCallback((categoryKey, day, value) => {
    setEntries(prev => {
      const next = { ...prev, [categoryKey]: { ...(prev[categoryKey] || {}) } }
      if (!value) delete next[categoryKey][day]
      else next[categoryKey][day] = value
      if (!Object.keys(next[categoryKey]).length) delete next[categoryKey]
      return next
    })
  }, [])

  function addToCell(categoryKey, day, delta) {
    const current = Number(entries[categoryKey]?.[day] || 0)
    setCell(categoryKey, day, round2(current + delta))
  }

  function fillStandardWeek(weekIndex) {
    const ordinary = categories.find(c => c.kind === 'ordinary')
    if (!ordinary) return
    const weekDays = days.slice(weekIndex * 7, weekIndex * 7 + 5) // Mon–Fri
    setEntries(prev => {
      const cell = { ...(prev[ordinary.key] || {}) }
      for (const d of weekDays) cell[d] = STANDARD_DAY
      return { ...prev, [ordinary.key]: cell }
    })
  }

  // Days over the standard day with no overtime recorded — offered as a nudge,
  // never applied automatically.
  const overtimeNudges = useMemo(() => {
    const ot = categories.filter(c => c.kind === 'overtime')
    if (!ot.length) return []
    return days.map((day, i) => {
      const total = totals.byDay[day] || 0
      const recorded = ot.reduce((s, c) => s + Number(entries[c.key]?.[day] || 0), 0)
      if (total <= STANDARD_DAY || recorded > 0) return null
      return { day, dayIndex: i, excess: round2(total - STANDARD_DAY) }
    }).filter(Boolean)
  }, [days, totals, entries, categories])

  function applyOvertime(nudge) {
    const ordinary = categories.find(c => c.kind === 'ordinary')
    const overtime = categories.find(c => c.key === 'overtime_1_5') || categories.find(c => c.kind === 'overtime')
    if (!ordinary || !overtime) return
    const current = Number(entries[ordinary.key]?.[nudge.day] || 0)
    setCell(ordinary.key, nudge.day, round2(Math.max(0, current - nudge.excess)))
    addToCell(overtime.key, nudge.day, nudge.excess)
  }

  async function saveDraft() {
    setBusy(true)
    try {
      const res = await fetch('/api/timesheet/agent?action=draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ periodStart: period.start, entries })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSavedAt(data.savedAt)
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function submit() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/timesheet/agent?action=submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ periodStart: period.start, entries })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSubmitted(data.record)
      setStage('done')
      boot()
    } catch (err) {
      setError(err.message)
      setStage('entry')
    }
    setBusy(false)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: MUTED, fontSize: 14 }}>Loading your timesheet…</div>

  if (error && !categories.length) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ background: '#fdecea', color: '#c0392b', padding: 14, borderRadius: 10, fontSize: 14, lineHeight: 1.5 }}>{error}</div>
        <button onClick={boot} style={{ width: '100%', marginTop: 12, padding: 12, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 14, color: MUTED, cursor: 'pointer' }}>Try again</button>
      </div>
    )
  }

  // ── Confirmation ─────────────────────────────────────────
  if (stage === 'done' && submitted) {
    return (
      <div style={{ padding: '28px 16px 90px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 32, background: '#e6f4f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 30, color: TEAL }}>✓</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: NAVY, marginBottom: 6 }}>Timesheet submitted</div>
        <div style={{ fontSize: 14, color: MUTED, marginBottom: 20, lineHeight: 1.6 }}>
          {submitted.periodStart} to {submitted.periodEnd}<br />Brenton and Erin have been notified.
        </div>
        <div style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, textAlign: 'left', marginBottom: 14 }}>
          {[['Total hours', `${submitted.totals.totalHours}h`],
            ['Week 1', `${submitted.totals.weekHours[0]}h`],
            ['Week 2', `${submitted.totals.weekHours[1]}h`],
            ...(submitted.totals.callouts ? [['Call-ins', submitted.totals.callouts]] : [])].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(26,43,74,0.06)', fontSize: 14 }}>
              <span style={{ color: MUTED }}>{l}</span><strong style={{ color: NAVY }}>{v}</strong>
            </div>
          ))}
        </div>
        {submitted.warnings?.length > 0 && (
          <div style={{ background: '#fff8e6', color: '#8a5a00', padding: 12, borderRadius: 10, fontSize: 12.5, textAlign: 'left', marginBottom: 14, lineHeight: 1.5 }}>
            {submitted.warnings.map((w, i) => <div key={i}>· {w}</div>)}
          </div>
        )}
        <button onClick={() => { setStage('entry'); setSubmitted(null) }}
          style={{ width: '100%', padding: 14, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 14, color: MUTED, cursor: 'pointer' }}>
          Back to timesheets
        </button>
      </div>
    )
  }

  // ── Review before submit ─────────────────────────────────
  if (stage === 'review') {
    return (
      <div style={{ padding: '16px 16px 90px' }}>
        <div style={{ fontSize: 19, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Review your timesheet</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16 }}>{period.start} to {period.end}</div>
        {error && <div style={{ background: '#fdecea', color: '#c0392b', padding: 12, borderRadius: 10, fontSize: 14, marginBottom: 12 }}>{error}</div>}

        <div style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          {categories.filter(c => totals.byCategory[c.key]).map(c => (
            <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(26,43,74,0.06)' }}>
              <span style={{ fontSize: 14, color: NAVY, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: COLOURS[c.colour] || NAVY }} />{c.label}
              </span>
              <strong style={{ fontSize: 14, color: NAVY }}>{totals.byCategory[c.key]}{c.unit === 'count' ? '' : 'h'}</strong>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 11, marginTop: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Total hours</span>
            <strong style={{ fontSize: 16, color: TEAL }}>{totals.totalHours}h</strong>
          </div>
        </div>

        <button onClick={submit} disabled={busy}
          style={{ width: '100%', padding: 16, background: busy ? '#c8d2dc' : TEAL, color: 'white', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: busy ? 'default' : 'pointer', marginBottom: 10 }}>
          {busy ? 'Submitting to Xero…' : 'Confirm and submit'}
        </button>
        <button onClick={() => setStage('entry')} disabled={busy}
          style={{ width: '100%', padding: 12, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 14, color: MUTED, cursor: 'pointer' }}>
          Keep editing
        </button>
      </div>
    )
  }

  // ── Entry grid ───────────────────────────────────────────
  const weekDays = days.slice(activeWeek * 7, activeWeek * 7 + 7)
  const visibleCallIns = callIns.filter(c => !dismissedCallIns.includes(c.id))
  const callInCategory = categories.find(c => c.key === 'call_in')
  const hasToniSplit = categories.some(c => c.key === 'ordinary_toni_admin') && categories.some(c => c.key === 'ordinary_toni_scientific')

  return (
    <Page style={{ paddingBottom: 130 }}>
      <Header
        eyebrow="Pay and time"
        title="Timesheet"
        subtitle={period ? `${period.start} to ${period.end}` : undefined}
        onBack={onBack}
      />
      <div style={{ padding: '14px 16px 0' }}>
        {error && <div style={{ background: '#fdecea', color: '#c0392b', padding: 12, borderRadius: 10, fontSize: 14, marginBottom: 12 }}>{error}</div>}

        {alreadySubmitted && (
          <div style={{ background: '#e6f4f2', color: TEAL, padding: 12, borderRadius: 10, fontSize: 14, marginBottom: 12, lineHeight: 1.5 }}>
            ✓ This fortnight was already <strong>{alreadySubmitted.status}</strong>. Any changes here won't be sent.
          </div>
        )}
        {rejected && (
          <div style={{ background: '#fdecea', color: '#c0392b', padding: 12, borderRadius: 10, fontSize: 14, marginBottom: 12, lineHeight: 1.5 }}>
            This fortnight was returned: <strong>{rejected.rejectionReason}</strong><br />Correct it below and resubmit.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[0, 1].map(w => (
            <button key={w} onClick={() => setActiveWeek(w)}
              style={{ flex: 1, padding: '9px 0', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, background: activeWeek === w ? NAVY : 'rgba(4,39,70,0.07)', color: activeWeek === w ? 'white' : MUTED }}>
              Week {w + 1} · {totals.weekHours[w]}h
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => fillStandardWeek(activeWeek)}
            style={{ flex: '1 1 46%', padding: '10px 8px', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: NAVY, cursor: 'pointer' }}>
            ⚡ Standard week
          </button>
          <button onClick={() => setShowOnCall(true)}
            style={{ flex: '1 1 46%', padding: '10px 8px', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: PURPLE, cursor: 'pointer' }}>
            🌙 On-call
          </button>
          {hasToniSplit && (
            <button onClick={() => setShowSplit(true)}
              style={{ flex: '1 1 100%', padding: '10px 8px', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: TEAL, cursor: 'pointer' }}>
              ◑ Split admin / scientific
            </button>
          )}
        </div>

        {overtimeNudges.filter(n => Math.floor(n.dayIndex / 7) === activeWeek).map(n => (
          <div key={n.day} style={{ background: '#fff8e6', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '11px 13px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 12.5, color: '#8a5a00', lineHeight: 1.4 }}>
              <strong>{DAY_NAMES[n.dayIndex % 7]}</strong> is {round2(totals.byDay[n.day])}h — {n.excess}h over a standard day.
            </div>
            <button onClick={() => applyOvertime(n)}
              style={{ padding: '8px 11px', background: AMBER, color: 'white', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              → Overtime
            </button>
          </div>
        ))}

        {callInCategory && visibleCallIns.filter(c => days.indexOf(c.day) >= activeWeek * 7 && days.indexOf(c.day) < activeWeek * 7 + 7).map(c => (
          <div key={c.id} style={{ background: '#f4eefa', border: '1px solid rgba(142,36,170,0.25)', borderRadius: 10, padding: '11px 13px', marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, color: PURPLE, fontWeight: 700, marginBottom: 3 }}>Called in for this case?</div>
            <div style={{ fontSize: 12.5, color: NAVY, lineHeight: 1.45 }}>{c.title} · {DAY_NAMES[days.indexOf(c.day) % 7]} {c.time} ({c.reason})</div>
            <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
              <button onClick={() => { addToCell(callInCategory.key, c.day, 1); setDismissedCallIns(p => [...p, c.id]) }}
                style={{ flex: 2, padding: 9, background: PURPLE, color: 'white', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                Add call-in allowance
              </button>
              <button onClick={() => setDismissedCallIns(p => [...p, c.id])}
                style={{ flex: 1, padding: 9, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12.5, color: MUTED, cursor: 'pointer' }}>
                No
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Grid: sticky category column, one column per day */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 0 8px' }}>
        <div style={{ minWidth: 460, padding: '0 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '104px repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
            <div />
            {weekDays.map((d, i) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: isWeekend(activeWeek * 7 + i) ? BLUE : MUTED, textTransform: 'uppercase' }}>
                {DAY_NAMES[i]}<div style={{ fontSize: 12.5, fontWeight: 600, color: NAVY }}>{dayNumber(d)}</div>
              </div>
            ))}
          </div>

          {categories.map(cat => (
            <div key={cat.key} style={{ display: 'grid', gridTemplateColumns: '104px repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: NAVY, lineHeight: 1.2, paddingRight: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: COLOURS[cat.colour] || NAVY, flexShrink: 0 }} />
                {cat.label}
              </div>
              {weekDays.map((day, i) => {
                const value = entries[cat.key]?.[day]
                const tint = COLOURS[cat.colour] || NAVY
                return (
                  <button key={day}
                    onClick={() => setPadCell({ categoryKey: cat.key, day, dayIndex: activeWeek * 7 + i, value })}
                    style={{
                      padding: '11px 0', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: value ? 700 : 400,
                      background: value ? tint : (isWeekend(activeWeek * 7 + i) ? 'rgba(4,39,70,0.035)' : 'white'),
                      color: value ? 'white' : 'rgba(26,43,74,0.25)',
                      border: value ? 'none' : `1px solid ${BORDER}`
                    }}>
                    {value ?? '·'}
                  </button>
                )
              })}
            </div>
          ))}

          <div style={{ display: 'grid', gridTemplateColumns: '104px repeat(7, 1fr)', gap: 3, marginTop: 7 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>Day total</div>
            {weekDays.map(day => {
              const v = round2(totals.byDay[day] || 0)
              return (
                <div key={day} style={{ textAlign: 'center', fontSize: 12.5, fontWeight: 700, padding: '7px 0', color: v > STANDARD_DAY ? AMBER : (v ? NAVY : 'rgba(26,43,74,0.22)') }}>
                  {v || '·'}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ padding: '10px 16px 0' }}>
        <button onClick={saveDraft} disabled={busy}
          style={{ width: '100%', padding: 12, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 14, color: MUTED, cursor: 'pointer' }}>
          {busy ? 'Saving…' : savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })} — save again` : 'Save draft'}
        </button>
      </div>

      {/* Running total bar, above the app's bottom nav */}
      <div className="tm-fixed" style={{ position: 'fixed', bottom: 'calc(70px + env(safe-area-inset-bottom, 0px))', background: NAVY, padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 90 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Fortnight total</div>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'white', lineHeight: 1.15 }}>
            {totals.totalHours}h
            <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', fontWeight: 400, marginLeft: 7 }}>
              {totals.weekHours[0]} + {totals.weekHours[1]}
              {totals.callouts ? ` · ${totals.callouts} call-in${totals.callouts === 1 ? '' : 's'}` : ''}
            </span>
          </div>
        </div>
        <button onClick={() => { setError(''); setStage('review') }} disabled={!totals.totalHours && !totals.callouts}
          style={{ padding: '12px 20px', background: (totals.totalHours || totals.callouts) ? TEAL : 'rgba(255,255,255,0.15)', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: (totals.totalHours || totals.callouts) ? 'pointer' : 'default' }}>
          Submit
        </button>
      </div>

      {padCell && (
        <NumberPad cell={padCell} categories={categories}
          onSet={v => setCell(padCell.categoryKey, padCell.day, v)}
          onClose={() => setPadCell(null)} />
      )}
      {showOnCall && (
        <OnCallModal days={days} onClose={() => setShowOnCall(false)}
          onApply={(day, hours) => {
            const onCall = categories.find(c => c.key === 'on_call')
            if (onCall) addToCell(onCall.key, day, hours)
          }} />
      )}
      {showSplit && (
        <SplitModal days={days} onClose={() => setShowSplit(false)}
          onApply={(day, admin, scientific) => {
            setCell('ordinary_toni_admin', day, admin)
            setCell('ordinary_toni_scientific', day, scientific)
          }} />
      )}
    </Page>
  )
}
