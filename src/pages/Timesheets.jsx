import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Page, Header, Overlay } from '../design/Shell.jsx'
import { extraDoubleTime, COVERED_HOURS } from '../clinicalPlan/callIn.js'
import { colour as tokenColour, text as typeToken } from '../design/tokens.js'
import { useIsDesktop } from '../design/viewport.js'
import { toilOverflow, contractFor, fortnightBalance, spreadShortfall } from '../timesheetRules.js'
import { workPatternFor } from '../staffConfig.js'
import { TOIL_TAKEN, earnsToil, totalOf, toilTakenCheck } from '../timesheetLeave.js'


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
      // On-call is an allowance, not time worked — kept out of the hours (mirrors api/_timesheetValidate.js).
      if (cat.unit === 'hours' && cat.key !== 'on_call') { byDay[day] = (byDay[day] || 0) + v; totalHours += v }
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


/**
 * One cell of the grid.
 *
 * On a phone it is a button that opens the number pad: the cells are about
 * 40px wide and typing into one is worse than tapping a big keypad.
 *
 * On a desktop it is an input you type into. Toni enters a fortnight on a
 * laptop with a number pad under her hands and had to click a cell, click
 * seven digits and click save, for every one — which is slower than the paper
 * it replaced and was reported, fairly, as painful.
 *
 * Tab moves across the week, because the inputs are in day order in the
 * document. Enter moves down to the same day in the next category, which is
 * the other way somebody fills this in. Focusing selects what is there, so
 * typing replaces rather than appending to a number already in the box.
 */
/**
 * Over or under the fortnight, asked before submit (Brent, 14 Nov 2026).
 * Over: bank the extra as TOIL, or keep it as paid hours. Under: take TOIL to
 * make it up (up to the balance), or leave it short.
 */
function FortnightQuestion({ balance, choice, available, onBank, onPaid, onTake, onShort }) {
  const btn = on => ({ flex: 1, padding: '11px 8px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? TEAL : BORDER}`, background: on ? TEAL : 'white', color: on ? 'white' : NAVY })
  if (balance.kind === 'over') {
    return (
      <div data-fortnight-question="over" style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4 }}>You're {balance.hours}h over your {balance.limit}h fortnight</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 10, lineHeight: 1.45 }}>Bank the extra as TOIL to take later, or keep it as paid hours?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" data-bank-toil onClick={onBank} style={btn(choice === 'bank')}>Bank {balance.hours}h as TOIL</button>
          <button type="button" data-keep-paid onClick={onPaid} style={btn(choice === 'paid')}>Keep as paid hours</button>
        </div>
      </div>
    )
  }
  const canTake = available == null ? balance.hours : Math.max(0, Math.min(balance.hours, available))
  return (
    <div data-fortnight-question="under" style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 4 }}>You're {balance.hours}h under your {balance.limit}h fortnight</div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 10, lineHeight: 1.45 }}>
        {canTake > 0
          ? <>Take TOIL to make it up?{available != null ? ` You have ${available}h available.` : ''}</>
          : 'You have no TOIL available to make it up.'}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {canTake > 0 && <button type="button" data-take-toil onClick={() => onTake(canTake)} style={btn(choice === 'take')}>Take {canTake}h TOIL</button>}
        <button type="button" data-leave-short onClick={onShort} style={btn(choice === 'short')}>Leave it short</button>
      </div>
    </div>
  )
}

function GridCell({ desktop, value, tint, weekend, onOpen, onSet, cellRef, onEnter }) {
  // What is being typed, which is not always a number yet.
  //
  // The bug this fixes: the cell showed `value`, and the parent turned every
  // keystroke into Number(raw) before handing it back. Type "7", then ".", and
  // the parent stored Number("7.") — which is 7 — so the point was wiped on
  // the very next render. 7.6 was unreachable, and a full day is 7.6 hours, so
  // the one number everybody needed most was the one that could not be typed.
  //
  // The draft holds the half-finished string while the cell has focus; the
  // parent still gets a number, so the fortnight's total keeps up as you type.
  //
  // Declared above the branch below, not after it. A hook that only runs on
  // one side of an early return changes the hook count when somebody drags a
  // window across 1024px, and React takes the page down for it.
  const [draft, setDraft] = useState(null)

  // A value that no longer agrees with the draft came from somewhere else —
  // an undo, or the standard-week fill — so the draft is stale and the cell
  // would otherwise keep showing a number that has already been taken back.
  // While typing, "7." and 7 agree, so this leaves the draft alone.
  useEffect(() => {
    if (draft !== null && Number(draft || 0) !== Number(value || 0)) setDraft(null)
    // Only when the stored value moves. Watching the draft would undo typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  if (!desktop) {
    return (
      <button onClick={onOpen}
        style={{
          padding: '11px 0', borderRadius: 8, cursor: 'pointer', fontSize: 14,
          fontWeight: value ? 700 : 400,
          background: value ? tint : (weekend ? 'rgba(4,39,70,0.035)' : 'white'),
          color: value ? 'white' : 'rgba(26,43,74,0.25)',
          border: value ? 'none' : `1px solid ${BORDER}`
        }}>
        {value ?? '·'}
      </button>
    )
  }

  return (
    <input
      ref={cellRef}
      type="text"
      inputMode="decimal"
      value={draft ?? (value ?? '')}
      onFocus={e => e.target.select()}
      onBlur={() => setDraft(null)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); setDraft(null); onEnter?.() }
        if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
      }}
      onChange={e => {
        const raw = e.target.value.trim()
        if (raw === '') { setDraft(''); return onSet('') }
        // Anything that is not a number is simply not entered — no error, no
        // flash. A stray keystroke in a grid of boxes should do nothing.
        if (!/^\d*\.?\d*$/.test(raw)) return
        setDraft(raw)
        onSet(raw)
      }}
      style={{
        width: '100%', minHeight: 42, textAlign: 'center', boxSizing: 'border-box',
        padding: '0 2px', borderRadius: 8, fontSize: 16,
        fontWeight: value ? 700 : 400, fontFamily: 'inherit', outline: 'none',
        background: value ? tint : (weekend ? 'rgba(4,39,70,0.035)' : 'white'),
        color: value ? 'white' : NAVY,
        border: value ? `1px solid ${tint}` : `1px solid ${BORDER}`
      }} />
  )
}

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
    <Overlay>
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

        {/* Entered in one unit, paid in another. A call-in is counted; if its
            Xero pay item is set up in hours then entering 1 records one hour
            instead of one call-in, and the person short-changed is the one who
            got out of bed. The app cannot fix the pay item from here, so it
            says so where somebody is about to type the number. */}
        {category?.mismatch && (
          <div style={{
            background: '#fdecea', color: '#c0392b', border: '1px solid #f5c6cb',
            borderRadius: 10, padding: 10, fontSize: 12.5, lineHeight: 1.45,
            marginBottom: 12
          }}>
            ⚠ {category.mismatch}
          </div>
        )}

        {/* Xero takes this pay item only in the pay run, not on a timesheet. */}
        {category?.timesheetOk === false && (
          <div data-pay-run-only style={{ color: MUTED, fontSize: 12.5, lineHeight: 1.45, marginBottom: 12 }}>
            Recorded here and paid through the pay run — Xero does not take this pay item on a timesheet.
          </div>
        )}

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
    </Overlay>
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
    <Overlay>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 20, width: '100%', maxWidth: 380 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>On-call calculator</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16 }}>Overnight periods roll past midnight automatically.</div>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase' }}>Night starting</label>
        <select value={day} onChange={e => setDay(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 16, marginBottom: 12, background: 'white', color: NAVY }}>
          {days.map((d, i) => <option key={d} value={d}>{DAY_NAMES[i % 7]} {d.slice(8, 10)}/{d.slice(5, 7)}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          {[['From', from, setFrom], ['To', to, setTo]].map(([label, val, set]) => (
            <div key={label} style={{ flex: 1 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase' }}>{label}</label>
              <input type="time" value={val} onChange={e => set(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 16, boxSizing: 'border-box', color: NAVY }} />
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
    </Overlay>
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
    <Overlay>
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 20, width: '100%', maxWidth: 380 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Split a day</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16 }}>Divide the day between admin and scientific hours.</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase' }}>Day</label>
            <select value={day} onChange={e => setDay(e.target.value)} style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 16, background: 'white', color: NAVY }}>
              {days.map((d, i) => <option key={d} value={d}>{DAY_NAMES[i % 7]} {d.slice(8, 10)}/{d.slice(5, 7)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase' }}>Hours</label>
            <input type="number" step="0.1" value={hours} onChange={e => setHours(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 16, boxSizing: 'border-box', color: NAVY }} />
          </div>
        </div>
        <input type="range" min="0" max="100" step="5" value={pct} onChange={e => setPct(Number(e.target.value))}
          style={{ fontSize: 16, width: '100%', marginBottom: 8, accentColor: NAVY }} />
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
    </Overlay>
  )
}

// ─── Main ────────────────────────────────────────────────────

export default function Timesheets({ user, onBack }) {
  // Whether this person is one payroll expects a timesheet from. An admin can
  // open the screen without being on it — to check it, or to sit with somebody
  // stuck on it — but submitting posts to Xero, so it is not theirs to press.
  const canSubmit = user?.staff?.hasTimesheets === true
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState([])
  const [period, setPeriod] = useState(null)
  const [entries, setEntries] = useState({})
  const [activeWeek, setActiveWeek] = useState(0)
  const [padCell, setPadCell] = useState(null)
  // Every desktop cell, so Enter can move down a column.
  const cellRefs = useRef({})
  // Typed cells on a desktop, a tapped number pad on a phone. Different
  // hardware, different right answer — see GridCell.
  const desktop = useIsDesktop()
  const [showOnCall, setShowOnCall] = useState(false)
  const [showSplit, setShowSplit] = useState(false)
  const [callIns, setCallIns] = useState([])
  const [dismissedCallIns, setDismissedCallIns] = useState([])
  // How long each call-in ran, keyed by the calendar event. The allowance
  // covers five hours and double time starts after that, so the claim is not
  // complete without it.
  const [callInHours, setCallInHours] = useState({})
  // The on-call weekends this fortnight, read off the calendar roster with the
  // hours already worked out. Offered rather than filled in: the roster gets
  // amended and the person filing is the one who knows whether it was them.
  const [onCall, setOnCall] = useState(null)
  const [onCallDone, setOnCallDone] = useState(false)
  // What this person has in the TOIL bank. Worked out by the app from the
  // timesheets it has filed and the TOIL leave it has sent to Xero, because
  // Xero accrues nothing from a timesheet line.
  const [toil, setToil] = useState(null)
  // Approved leave on the days of this period, from the leave store, so it
  // shows on the timesheet and the standard week does not claim it again.
  const [leaveDays, setLeaveDays] = useState({})
  // The leave on this fortnight by type — the portal's and Xero's own — shown
  // as rows on the grid (Brent, 12 Nov 2026), and what TOIL can be taken.
  const [periodLeave, setPeriodLeave] = useState({ rows: [], pending: [], total: 0, byDay: {} })
  const [toilRoom, setToilRoom] = useState(null)
  // Every pay item, invented, so the whole screen can be looked at. Brent's own
  // Xero template has one rate on it, so without this the screen he checks is
  // not the screen anybody uses.
  const [demo, setDemo] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [stage, setStage] = useState('entry')
  const [submitted, setSubmitted] = useState(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState([])

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])

  // Re-reads when the demo switch moves, which is the only thing that
  // changes which pay items come back.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { boot() }, [demo])

  async function boot() {
    setLoading(true); setError('')
    try {
      const res = await fetch(
        `/api/timesheet/agent?action=payitems${demo ? '&demo=1' : ''}`, { headers: authHeaders })
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
        .then(r => r.json())
        .then(d => {
          setCallIns(d.suggestions || [])
          setOnCall(d.onCall || null)
          // On-call hours are the roster's (Brent, 14 Nov 2026) — put on the
          // grid as the calendar has them, replacing anything there.
          if (d.onCall) {
            setEntries(prev => ({ ...prev, on_call: { ...(d.onCall.byDay || {}) } }))
          }
          // Logged on the server just now (Brent, 7 Nov 2026): put the same
          // call-ins on the grid on screen, which was read before they were.
          if (d.logged?.length) {
            setEntries(prev => {
              const row = { ...(prev.call_in || {}) }
              for (const c of d.logged) row[c.day] = (Number(row[c.day]) || 0) + 1
              return { ...prev, call_in: row }
            })
          }
        })
        .catch(() => {})
      fetch('/api/timesheet/agent?action=toil', { headers: authHeaders })
        .then(r => r.json()).then(d => setToil(d.me || null)).catch(() => {})
      fetch(`/api/timesheet/agent?action=leavedays&periodStart=${data.period.start}`, { headers: authHeaders })
        .then(r => r.json()).then(d => {
          setLeaveDays(d.days || {})
          if (d.leave) setPeriodLeave(d.leave)
          setToilRoom(d.toil || null)
        }).catch(() => {})
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const days = period?.days || []
  const totals = useMemo(() => computeTotals(entries, categories, days), [entries, categories, days])

  const alreadySubmitted = history.find(r => r.periodStart === period?.start && r.status !== 'rejected')
  const rejected = history.find(r => r.periodStart === period?.start && r.status === 'rejected')

  // ── Putting a wrong number back ──
  // Asked for after an entry went in the wrong box. Everything here is a grid
  // of near-identical cells and the whole thing is typed at speed, so landing
  // a 7.6 on the wrong day or the wrong row is the normal mistake, not the
  // rare one — and until now the only way back was to remember what had been
  // there and retype it.
  //
  // One step per cell, not per keystroke. Typing "7.6" fires setCell three
  // times, and an undo that walked back through "7." and "7" would take three
  // presses to undo one number.
  const past = useRef([])
  const lastTouched = useRef('')
  const [undoDepth, setUndoDepth] = useState(0)
  const entriesRef = useRef(entries)
  useEffect(() => { entriesRef.current = entries }, [entries])

  const remember = useCallback(key => {
    if (lastTouched.current === key) return   // same cell, still typing
    lastTouched.current = key
    past.current.push(entriesRef.current)
    // Deep enough to cover a bad run of entries, bounded so a long session
    // does not quietly accumulate a fortnight of snapshots.
    if (past.current.length > 40) past.current.shift()
    setUndoDepth(past.current.length)
  }, [])

  const undo = useCallback(() => {
    const previous = past.current.pop()
    setUndoDepth(past.current.length)
    // The next edit starts a new step, even if it is the cell just restored.
    lastTouched.current = ''
    if (previous) setEntries(previous)
  }, [])

  const setCell = useCallback((categoryKey, day, value) => {
    remember(`${categoryKey}|${day}`)
    setEntries(prev => {
      const next = { ...prev, [categoryKey]: { ...(prev[categoryKey] || {}) } }
      // TOIL taken on a day comes off the ordinary hours already there — the
      // same hours cannot be worked and taken off.
      if (categoryKey === TOIL_TAKEN) {
        const more = round2(Number(value || 0) - Number(prev[TOIL_TAKEN]?.[day] || 0))
        const ordinaryKey = Object.keys(prev).find(k => k.startsWith('ordinary') && prev[k]?.[day])
        if (more > 0 && ordinaryKey) {
          const left = round2(Math.max(0, Number(prev[ordinaryKey][day]) - more))
          next[ordinaryKey] = { ...prev[ordinaryKey] }
          if (left > 0) next[ordinaryKey][day] = left
          else delete next[ordinaryKey][day]
          if (!Object.keys(next[ordinaryKey]).length) delete next[ordinaryKey]
        }
      }
      if (!value) delete next[categoryKey][day]
      else next[categoryKey][day] = value
      if (!Object.keys(next[categoryKey]).length) delete next[categoryKey]
      return next
    })
  }, [remember])

  function addToCell(categoryKey, day, delta) {
    const current = Number(entries[categoryKey]?.[day] || 0)
    setCell(categoryKey, day, round2(current + delta))
  }

  // The person's own week where they have one — Toni's is Mon, Wed and Thu at
  // 5.5 — and 7.6 Mon–Fri otherwise. Approved leave on a day comes off it:
  // that time is paid as leave, and claiming it as ordinary hours as well is
  // paying it twice. Erin's days change, so hers is left for her to enter.
  const pattern = workPatternFor(user?.email)
  const canFillWeek = pattern?.kind !== 'flexible'

  function fillStandardWeek(weekIndex) {
    const ordinary = categories.find(c => c.kind === 'ordinary')
    if (!ordinary || !canFillWeek) return
    const weekDays = days.slice(weekIndex * 7, weekIndex * 7 + 7)
    setEntries(prev => {
      const cell = { ...(prev[ordinary.key] || {}) }
      weekDays.forEach((d, i) => {
        const usual = pattern?.kind === 'fixed' ? Number(pattern.days[i] || 0) : (i < 5 ? STANDARD_DAY : 0)
        const off = Number(periodLeave.byDay?.[d] ?? leaveDays[d]?.hours ?? 0) + Number(prev[TOIL_TAKEN]?.[d] || 0)
        const worked = round2(Math.max(0, usual - off))
        if (worked > 0) cell[d] = worked
        else if (usual > 0) delete cell[d]
      })
      return { ...prev, [ordinary.key]: cell }
    })
  }

  // Hours past a full-time contract, banked as TOIL on submit — shown here
  // first so nobody is surprised by their payslip. No per-day flag: "allow
  // staff to just enter the hours they worked". See src/timesheetRules.js.
  const takesToil = earnsToil(user?.email)
  const toilTaken = takesToil ? (entries[TOIL_TAKEN] || {}) : {}
  const toilTakenTotal = totalOf(toilTaken)
  const toilCheck = toilTakenCheck({ taken: toilTakenTotal, balance: toilRoom?.balance ?? null, alreadyClaimed: toilRoom?.claimed || 0 })
  const leaveTotal = round2(Number(periodLeave.total || 0) + toilTakenTotal)
  const overflow = useMemo(() => toilOverflow({
    entries, categories, days, contract: contractFor(user?.email),
    leaveHours: Number(periodLeave.total || 0) + toilTakenTotal
  }), [entries, categories, days, user?.email, periodLeave, toilTakenTotal])
  // Over or under the fortnight — asked on review (Brent, 14 Nov 2026).
  const [fortnightChoice, setFortnightChoice] = useState(null)
  const balance = useMemo(() => takesToil
    ? fortnightBalance({ entries, categories, contract: contractFor(user?.email), leaveHours: Number(periodLeave.total || 0), toilTaken: toilTakenTotal })
    : { kind: 'none', hours: 0 }, [takesToil, entries, categories, user?.email, periodLeave, toilTakenTotal])
  const keepPaid = balance.kind === 'over' && fortnightChoice === 'paid'
  const needsAnswer = (balance.kind === 'over' || balance.kind === 'under') && !fortnightChoice
  const filed = keepPaid ? entries : overflow.entries
  const filedTotals = useMemo(() => computeTotals(filed, categories, days), [filed, categories, days])

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
        body: JSON.stringify({ periodStart: period.start, entries: takesToil && toilTakenTotal ? { ...filed, [TOIL_TAKEN]: toilTaken } : filed, bankToil: !keepPaid })
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
      <div className="tm-measure" style={{ padding: 16 }}>
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
          {categories.filter(c => filedTotals.byCategory[c.key]).map(c => (
            <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(26,43,74,0.06)' }}>
              <span style={{ fontSize: 14, color: NAVY, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: COLOURS[c.colour] || NAVY }} />{c.label}
              </span>
              <strong style={{ fontSize: 14, color: NAVY }}>{filedTotals.byCategory[c.key]}{c.unit === 'count' ? '' : 'h'}</strong>
            </div>
          ))}
          {overflow.moved.length > 0 && (
            <div style={{ fontSize: 12.5, color: MUTED, padding: '8px 0' }}>
              Includes {overflow.excess}h TOIL: ordinary hours over your {overflow.limit}h fortnight.
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 11, marginTop: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Hours worked</span>
            <strong style={{ fontSize: 16, color: TEAL }}>{filedTotals.totalHours}h</strong>
          </div>
          {[...(periodLeave.rows || []).map(r => [r.label, r.total]), ...(toilTakenTotal ? [['TOIL taken', toilTakenTotal]] : [])].map(([label, hours]) => (
            <div key={label} data-review-leave={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(26,43,74,0.06)' }}>
              <span style={{ fontSize: 14, color: NAVY }}>{label}</span>
              <strong style={{ fontSize: 14, color: NAVY }}>{hours}h</strong>
            </div>
          ))}
          {leaveTotal > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 9, borderTop: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Worked + leave</span>
              <strong style={{ fontSize: 16, color: NAVY }}>{round2(filedTotals.totalHours + leaveTotal)}h</strong>
            </div>
          )}
          {leaveTotal > 0 && (
            <div style={{ fontSize: 12.5, color: MUTED, paddingTop: 6, lineHeight: 1.45 }}>
              Leave goes to Xero as leave, not on the timesheet{toilTakenTotal ? ' — your TOIL taken is sent when Erin approves this' : ''}.
            </div>
          )}
        </div>

        {!toilCheck.ok && (
          <div role="alert" style={{ background: '#fdecea', color: '#c0392b', padding: 12, borderRadius: 10, fontSize: 14, marginBottom: 12, lineHeight: 1.45 }}>{toilCheck.error}</div>
        )}
        {/* Over or under the fortnight (Brent, 14 Nov 2026): asked here, and
            the answer goes to Xero — banked TOIL as a TOIL line on the
            timesheet, TOIL taken as a TOIL leave application on approval. */}
        {(balance.kind === 'over' || balance.kind === 'under') && (
          <FortnightQuestion balance={balance} choice={fortnightChoice}
            available={toilRoom?.available != null ? round2(Math.max(0, toilRoom.available - toilTakenTotal)) : null}
            onBank={() => setFortnightChoice('bank')}
            onPaid={() => setFortnightChoice('paid')}
            onShort={() => setFortnightChoice('short')}
            onTake={hours => {
              const add = spreadShortfall({ hours, email: user?.email, days, entries, categories, leaveByDay: periodLeave.byDay || {}, taken: toilTaken })
              setEntries(prev => {
                const row = { ...(prev[TOIL_TAKEN] || {}) }
                for (const [d, h] of Object.entries(add)) row[d] = round2(Number(row[d] || 0) + h)
                return { ...prev, [TOIL_TAKEN]: row }
              })
              setFortnightChoice('take')
            }} />
        )}
        <button onClick={submit} disabled={busy || !canSubmit || !toilCheck.ok || needsAnswer}
          style={{ width: '100%', padding: 16, background: (busy || !canSubmit || !toilCheck.ok || needsAnswer) ? '#c8d2dc' : TEAL, color: 'white', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: (busy || !canSubmit || !toilCheck.ok) ? 'default' : 'pointer', marginBottom: 10 }}>
          {busy ? 'Submitting to Xero…'
            : canSubmit ? 'Confirm and submit' : 'Not yours to submit'}
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
  // A logged call-in is shown only while it is on the grid: one somebody took
  // off stays off, and is not offered again either.
  const visibleCallIns = callIns.filter(c => !dismissedCallIns.includes(c.id)
    && (!c.auto || Number(entries.call_in?.[c.day] || 0) > 0))
  const callInCategory = categories.find(c => c.key === 'call_in')
  const onCallCategory = categories.find(c => c.key === 'on_call')
  const doubleCategory = categories.find(c => c.key === 'overtime_double')
  const hasToniSplit = categories.some(c => c.key === 'ordinary_toni_admin') && categories.some(c => c.key === 'ordinary_toni_scientific')

  return (
    <Page style={{ paddingBottom: 130 }}>
      <Header
        eyebrow="Pay and time"
        title="Timesheet"
        subtitle={period ? `${period.start} to ${period.end}` : undefined}
        onBack={onBack}
      />
      <div className="tm-measure" style={{ padding: '14px 16px 0' }}>
        {!canSubmit && (
          <div style={{
            background: 'rgba(4,39,70,0.05)', border: `1px solid ${BORDER}`,
            color: MUTED, padding: 12, borderRadius: 10, fontSize: 14,
            marginBottom: 12, lineHeight: 1.5
          }}>
            You are not on fortnightly timesheets, so this one will not be
            submitted. Everything else works — fill it in, open the drawers, try
            to break it. <strong style={{ color: NAVY }}>Confirm and submit</strong> is
            the only thing switched off.
          </div>
        )}
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

        {/* Shown to an admin only, because it is a tool for checking the
            screen rather than a feature of it. It announces loudly what it is:
            a timesheet full of invented pay items is exactly the thing that
            should never be mistaken for a real one. */}
        {user?.staff?.isAdmin && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, marginBottom: 12, padding: '9px 13px', borderRadius: 10,
            background: demo ? '#fff4e5' : 'transparent',
            border: `1px solid ${demo ? '#f0c187' : BORDER}`
          }}>
            <span style={{ fontSize: 12.5, color: demo ? '#8a5200' : MUTED, lineHeight: 1.45 }}>
              {demo
                ? 'Demo — made-up pay items so every part of the screen shows. Nothing here can be filed.'
                : 'Only seeing one pay item? Your Xero template has one.'}
            </span>
            <button onClick={() => setDemo(d => !d)}
              style={{
                flexShrink: 0, padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${demo ? '#8a5200' : BORDER}`,
                background: 'transparent', fontSize: 12.5, fontWeight: 700,
                color: demo ? '#8a5200' : NAVY
              }}>
              {demo ? 'Show mine' : 'Show them all'}
            </button>
          </div>
        )}

        {/* The bank, where somebody can see it before deciding whether to
            claim more or take some back. It was only ever a number in Brent's
            head and a manual adjustment in Xero. */}
        {toil && ((toil.bank ?? toil.balance) !== 0 || toil.accrued !== 0) && (
          <div style={{
            background: '#e6f4f2', border: `1px solid rgba(42,181,160,0.3)`,
            borderRadius: 10, padding: '10px 13px', marginBottom: 12,
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10
          }}>
            <span style={{ fontSize: 12.5, color: NAVY }}>
              TOIL balance
              {toil.pending.accrued > 0 && (
                <span style={{ color: MUTED }}> · {toil.pending.accrued}h awaiting approval</span>
              )}
              {(toil.xeroParts || []).length > 1 && (
                <span style={{ display: 'block', color: MUTED, fontSize: 12.5 }}>
                  {toil.xeroParts.map(p => `${p.name} ${p.hours}h`).join(' · ')}
                </span>
              )}
            </span>
            <strong style={{ fontSize: 16, color: TEAL }}>{toil.bank ?? toil.balance}h</strong>
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
          {canFillWeek && <button onClick={() => fillStandardWeek(activeWeek)}
            style={{ flex: '1 1 46%', padding: '10px 8px', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: NAVY, cursor: 'pointer' }}>
            ⚡ {pattern ? 'My usual week' : 'Standard week'}
          </button>}
          {/* Only once there is something to undo. A permanently greyed button
              is a permanent invitation to wonder what it would have done. */}
          {undoDepth > 0 && (
            <button onClick={undo}
              style={{ flex: '1 1 100%', padding: '10px 8px', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: MUTED, cursor: 'pointer' }}>
              ↩︎ Undo last change
            </button>
          )}
          {hasToniSplit && (
            <button onClick={() => setShowSplit(true)}
              style={{ flex: '1 1 100%', padding: '10px 8px', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: TEAL, cursor: 'pointer' }}>
              ◑ Split admin / scientific
            </button>
          )}
        </div>

        {/* Leave already approved for days in this week. Shown so nobody
            enters ordinary hours for a day they were paid as leave. */}
        {(periodLeave.pending || []).length > 0 && (
          <div data-pending-leave style={{ background: 'rgba(4,39,70,0.05)', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 13px', marginBottom: 8, fontSize: 12.5, color: MUTED, lineHeight: 1.45 }}>
            Waiting for approval, not counted yet: {periodLeave.pending.map(p => `${p.label} ${p.total}h`).join(' · ')}
          </div>
        )}
        {[...(periodLeave.notes || []), ...(periodLeave.xeroError ? [periodLeave.xeroError] : [])].length > 0 && (
          <div data-leave-notes style={{ background: 'rgba(4,39,70,0.05)', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 13px', marginBottom: 8, fontSize: 12.5, color: MUTED, lineHeight: 1.45 }}>
            {[...(periodLeave.notes || []), ...(periodLeave.xeroError ? [periodLeave.xeroError] : [])].map((n, i) => <div key={i}>{n}</div>)}
          </div>
        )}
        {periodLeave.rows?.some(r => !r.inXero) && (
          <div style={{ background: '#fff8e6', color: '#8a5a00', borderRadius: 10, padding: '9px 13px', marginBottom: 8, fontSize: 12.5, lineHeight: 1.45 }}>
            Some of your leave was approved in the portal but did not reach Xero — Erin will see this too.
          </div>
        )}
        {takesToil && toilTakenTotal > 0 && !toilCheck.ok && (
          <div role="alert" data-toil-block style={{ background: '#fdecea', color: '#c0392b', borderRadius: 10, padding: '9px 13px', marginBottom: 8, fontSize: 12.5, lineHeight: 1.45 }}>
            {toilCheck.error}
          </div>
        )}

        {overflow.excess > 0 && (
          <div style={{ background: '#e6f4f2', border: '1px solid rgba(42,181,160,0.3)', borderRadius: 10, padding: '11px 13px', marginBottom: 8, fontSize: 12.5, color: NAVY, lineHeight: 1.45 }}>
            {overflow.toilKey
              ? <><strong>{overflow.excess}h over your {overflow.limit}h fortnight.</strong> When you submit you'll be asked whether to bank it as TOIL or keep it as paid hours. To be paid it as double time, enter those hours under Overtime — Double.</>
              : <><strong>{overflow.excess}h over your {overflow.limit}h fortnight.</strong> There is no TOIL pay item on your timesheet to bank it in — check with Brent before submitting.</>}
          </div>
        )}

        {/* The whole weekend in one tap. On call runs 17:00 Friday to 07:00
            Monday — 62 hours across four days — and entering that by hand
            meant four trips through the time picker and the arithmetic done
            in somebody's head at the end of a fortnight.

            The roster comes off the calendar, which is where it is amended
            when somebody swaps, so this is what the calendar says rather than
            a rotation worked out from a start date. Offered and not filled
            in: the person filing is the one who knows whether it was really
            them. */}
        {onCallCategory && onCall?.offered && (
          <div data-on-call-auto style={{ background: '#f4eefa', border: '1px solid rgba(142,36,170,0.25)', borderRadius: 10, padding: '11px 13px', marginBottom: 8, fontSize: 12.5, color: NAVY, lineHeight: 1.45 }}>
            🌙 On call this fortnight: <strong>{onCall.hours} hours</strong> from the roster, 17:00 Friday to 07:00 Monday. Filled in for you — change the roster on the calendar if it is wrong.
          </div>
        )}

        {callInCategory && visibleCallIns.filter(c => days.indexOf(c.day) >= activeWeek * 7 && days.indexOf(c.day) < activeWeek * 7 + 7).map(c => (
          <div key={c.id} data-call-in={c.auto ? 'logged' : 'offered'} style={{ background: '#f4eefa', border: '1px solid rgba(142,36,170,0.25)', borderRadius: 10, padding: '11px 13px', marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, color: PURPLE, fontWeight: 700, marginBottom: 3 }}>
              {c.auto ? '✓ Call-in logged on your timesheet' : 'Called in for this case?'}
            </div>
            <div style={{ fontSize: 12.5, color: NAVY, lineHeight: 1.45 }}>
              {c.title} · {DAY_NAMES[days.indexOf(c.day) % 7]} {c.time} ({c.auto ? 'you were on call' : c.reason})
            </div>

            {/* How long it ran. The allowance covers the first five hours;
                past that every hour or part thereof is double the ordinary
                rate, so the hours have to be known before the claim is right.
                Asked here rather than left to somebody to work out and enter
                in a second place. */}
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 9, marginBottom: 5 }}>
              How long were you there?
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {[2, 4, 5, 6, 7, 8].map(h => {
                const on = callInHours[c.id] === h
                return (
                  <button key={h} onClick={() => setCallInHours(p => ({ ...p, [c.id]: h }))}
                    style={{
                      minWidth: 44, minHeight: 36, padding: '0 10px', borderRadius: 8,
                      cursor: 'pointer', fontSize: 14, fontWeight: 700,
                      border: `1px solid ${on ? PURPLE : BORDER}`,
                      background: on ? PURPLE : 'transparent',
                      color: on ? 'white' : NAVY
                    }}>
                    {h}h
                  </button>
                )
              })}
            </div>
            {extraDoubleTime(callInHours[c.id]) > 0 && (
              <div style={{ fontSize: 12.5, color: PURPLE, marginTop: 7, lineHeight: 1.45 }}>
                Over {COVERED_HOURS} hours — <strong>{extraDoubleTime(callInHours[c.id])}h double time</strong>{' '}
                will be added as well.
              </div>
            )}

            {c.auto ? (
            <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
              {/* Already on the grid: all that is left is the double time past
                  five hours, or taking it off if it was not a call-in. */}
              <button
                onClick={() => {
                  const extra = extraDoubleTime(callInHours[c.id])
                  if (extra > 0 && doubleCategory) addToCell(doubleCategory.key, c.day, extra)
                  setDismissedCallIns(p => [...p, c.id])
                }}
                style={{ flex: 2, padding: 9, background: PURPLE, color: 'white', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                {extraDoubleTime(callInHours[c.id]) > 0 ? `Add ${extraDoubleTime(callInHours[c.id])}h double` : 'Done'}
              </button>
              <button onClick={() => { addToCell(callInCategory.key, c.day, -1); setDismissedCallIns(p => [...p, c.id]) }}
                style={{ flex: 1, padding: 9, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12.5, color: MUTED, cursor: 'pointer' }}>
                Take it off
              </button>
            </div>
            ) : (
            <div style={{ display: 'flex', gap: 7, marginTop: 9 }}>
              <button
                onClick={() => {
                  addToCell(callInCategory.key, c.day, 1)
                  const extra = extraDoubleTime(callInHours[c.id])
                  if (extra > 0 && doubleCategory) addToCell(doubleCategory.key, c.day, extra)
                  setDismissedCallIns(p => [...p, c.id])
                }}
                style={{ flex: 2, padding: 9, background: PURPLE, color: 'white', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                Add call-in{extraDoubleTime(callInHours[c.id]) > 0
                  ? ` + ${extraDoubleTime(callInHours[c.id])}h double`
                  : ' allowance'}
              </button>
              <button onClick={() => setDismissedCallIns(p => [...p, c.id])}
                style={{ flex: 1, padding: 9, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 12.5, color: MUTED, cursor: 'pointer' }}>
                No
              </button>
            </div>
            )}
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
                // Call-ins are counted by tapping (Brent, 14 Nov 2026: "tap call
                // ins as a button on the day … tallies the number"). Each tap
                // adds one; − takes one off.
                if (cat.key === 'call_in') {
                  const n = Number(value) || 0
                  return (
                    <div key={day} data-call-in-cell style={{ position: 'relative', minHeight: 44, display: 'flex' }}>
                      <button type="button" data-call-in-add aria-label={`Add a call-in on ${day}`}
                        onClick={() => setCell(cat.key, day, n + 1)}
                        style={{ flex: 1, minHeight: 44, borderRadius: 10, cursor: 'pointer', fontSize: n ? 16 : 18, fontWeight: 700, border: `1px solid ${n ? tint : BORDER}`, background: n ? tint : 'white', color: n ? 'white' : MUTED }}>
                        {n || '+'}
                      </button>
                      {n > 0 && (
                        <button type="button" data-call-in-remove aria-label={`Take a call-in off ${day}`}
                          onClick={() => setCell(cat.key, day, n - 1 || '')}
                          style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 11, border: `1px solid ${BORDER}`, background: 'white', color: NAVY, fontSize: 14, lineHeight: '18px', padding: 0, cursor: 'pointer' }}>
                          −
                        </button>
                      )}
                    </div>
                  )
                }
                // The roster's hours: shown, never typed (14 Nov 2026).
                if (cat.key === 'on_call') {
                  return (
                    <div key={day} data-on-call-cell style={{ minHeight: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: value ? tint : MUTED, background: value ? '#f4eefa' : 'transparent', border: `1px dashed ${value ? 'rgba(142,36,170,0.35)' : BORDER}` }}>
                      {value || '·'}
                    </div>
                  )
                }
                return (
                  <GridCell key={day}
                    desktop={desktop}
                    value={value}
                    tint={tint}
                    weekend={isWeekend(activeWeek * 7 + i)}
                    onOpen={() => setPadCell({ categoryKey: cat.key, day, dayIndex: activeWeek * 7 + i, value })}
                    onSet={raw => setCell(cat.key, day, raw === '' ? '' : Number(raw))}
                    cellRef={el => { cellRefs.current[`${cat.key}|${day}`] = el }}
                    onEnter={() => {
                      // Down a row, same day — the other way a fortnight gets
                      // filled in.
                      const at = categories.findIndex(c => c.key === cat.key)
                      const next = categories[at + 1]
                      cellRefs.current[`${next?.key}|${day}`]?.focus()
                    }} />
                )
              })}
            </div>
          ))}

          {/* Leave on these days, as rows (Brent, 12 Nov 2026): read only —
              it is leave, sent to Xero as leave, never on the timesheet. */}
          {(periodLeave.rows || []).map(row => (
            <div key={row.type} data-leave-row={row.type} style={{ display: 'grid', gridTemplateColumns: '104px repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: NAVY, lineHeight: 1.2, paddingRight: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: PURPLE, flexShrink: 0 }} />
                {row.label}{!row.inXero ? ' ⚠' : ''}
              </div>
              {weekDays.map(day => {
                const v = row.byDay[day]
                return (
                  <div key={day} title={row.notInXero.includes(day) ? 'Approved in the portal but not in Xero' : undefined}
                    style={{ padding: '11px 0', borderRadius: 8, fontSize: 14, textAlign: 'center',
                      fontWeight: v ? 700 : 400, color: v ? PURPLE : 'rgba(26,43,74,0.2)',
                      background: v ? '#f4eefa' : 'transparent', border: v ? '1px dashed rgba(142,36,170,0.4)' : 'none' }}>
                    {v ?? '·'}
                  </div>
                )
              })}
            </div>
          ))}

          {/* TOIL taken (Brent, 12 Nov 2026): typed like ordinary hours, by
              those who earn TOIL. Never more than the balance; sent to Xero
              as TOIL leave when Erin approves the timesheet. */}
          {takesToil && (
            <div data-toil-taken-row style={{ display: 'grid', gridTemplateColumns: '104px repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', fontSize: 10.5, fontWeight: 600, color: NAVY, lineHeight: 1.2, paddingRight: 4 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: PURPLE, flexShrink: 0 }} />TOIL taken
                </span>
                {toilRoom?.available !== null && toilRoom?.available !== undefined && (
                  <span style={{ color: MUTED, fontWeight: 400 }}>{toilRoom.available}h available</span>
                )}
              </div>
              {weekDays.map((day, i) => (
                <GridCell key={day}
                  desktop={desktop}
                  value={entries[TOIL_TAKEN]?.[day]}
                  tint={PURPLE}
                  weekend={isWeekend(activeWeek * 7 + i)}
                  onOpen={() => setPadCell({ categoryKey: TOIL_TAKEN, day, dayIndex: activeWeek * 7 + i, value: entries[TOIL_TAKEN]?.[day] })}
                  onSet={raw => setCell(TOIL_TAKEN, day, raw === '' ? '' : Number(raw))}
                  cellRef={el => { cellRefs.current[`${TOIL_TAKEN}|${day}`] = el }}
                  onEnter={() => {}} />
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '104px repeat(7, 1fr)', gap: 3, marginTop: 7 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>Day total</div>
            {weekDays.map(day => {
              const v = round2(totals.byDay[day] || 0)
              return (
                <div key={day} style={{ textAlign: 'center', fontSize: 12.5, fontWeight: 700, padding: '7px 0', color: v ? NAVY : 'rgba(26,43,74,0.22)' }}>
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
              {leaveTotal ? ` · + ${leaveTotal}h leave` : ''}
              {totals.callouts ? ` · ${totals.callouts} call-in${totals.callouts === 1 ? '' : 's'}` : ''}
              {totals.byCategory?.on_call ? ` · ${totals.byCategory.on_call}h on call` : ''}
            </span>
          </div>
        </div>
        <button onClick={() => { setError(''); setFortnightChoice(null); setStage('review') }} disabled={!totals.totalHours && !totals.callouts && !toilTakenTotal}
          style={{ padding: '12px 20px', background: (totals.totalHours || totals.callouts) ? TEAL : 'rgba(255,255,255,0.15)', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: (totals.totalHours || totals.callouts) ? 'pointer' : 'default' }}>
          Submit
        </button>
      </div>

      {padCell && (
        <NumberPad cell={padCell} categories={[...categories, { key: TOIL_TAKEN, label: 'TOIL taken', unit: 'hours', hint: toilRoom?.available != null ? `${toilRoom.available}h available` : '' }]}
          onSet={v => setCell(padCell.categoryKey, padCell.day, v)}
          onClose={() => setPadCell(null)} />
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
