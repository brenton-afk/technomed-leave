import React, { useState } from 'react'
import { colour as tokenColour } from '../../design/tokens.js'
import { workingDaysBetween } from '../../clinicalPlan/toil.js'

// ─── Choosing the days off ───────────────────────────────────────────────────
// Two native date fields, one opening the other, and no way to say which one
// you were in. A native picker is an operating-system sheet: it has no title
// we can set, so the only thing marking the jump from the first day to the
// last was the calendar blinking and reopening. Reported, fairly, as having no
// idea the app had moved on.
//
// So the calendar is ours. It can say what it is for at the top, it can show
// the range filling in as it is chosen, and it counts the days while somebody
// looks at it — which is the question they are answering anyway. It also
// behaves the same on a phone, a Mac and a PC, which two native pickers did
// not.

const NAVY = tokenColour.navy
const TEAL = tokenColour.accent
const MUTED = tokenColour.inkFaint
const BORDER = tokenColour.line

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const iso = date => date.toISOString().slice(0, 10)
const parse = value => new Date(`${value}T00:00:00Z`)
const isWeekend = date => [0, 6].includes(date.getUTCDay())

/** Every cell of a month grid, Monday first, padded to whole weeks. */
function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1))
  // getUTCDay is Sunday-first; the week here starts on Monday.
  const lead = (first.getUTCDay() + 6) % 7
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  const at = new Date(first)
  while (at.getUTCMonth() === month) {
    cells.push(new Date(at))
    at.setUTCDate(at.getUTCDate() + 1)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/**
 * A calendar for picking a first and last day.
 *
 * @param {string} start  YYYY-MM-DD, or ''
 * @param {string} end    YYYY-MM-DD, or ''
 * @param {(range: {start: string, end: string}) => void} onChange
 */
export default function DateRange({ start, end, onChange }) {
  const today = new Date()
  const anchor = start ? parse(start) : today
  const [shown, setShown] = useState({
    year: anchor.getUTCFullYear(), month: anchor.getUTCMonth()
  })

  // Which day is being chosen. Having a start and no end means the last day is
  // what the next tap sets — the same state the two fields encoded, said out
  // loud instead of left to be inferred from a calendar blinking.
  const choosing = start && !end ? 'last' : 'first'

  function tap(date) {
    const value = iso(date)
    if (choosing === 'first' || value < start) {
      // Before the start is not a range, it is somebody changing their mind
      // about where it begins.
      onChange({ start: value, end: '' })
      return
    }
    onChange({ start, end: value })
  }

  function step(by) {
    setShown(({ year, month }) => {
      const at = new Date(Date.UTC(year, month + by, 1))
      return { year: at.getUTCFullYear(), month: at.getUTCMonth() }
    })
  }

  const cells = monthGrid(shown.year, shown.month)
  const days = start && end ? workingDaysBetween(start, end) : 0

  return (
    <div style={{
      background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12,
      overflow: 'hidden', marginBottom: 12
    }}>
      {/* The thing the native picker could never say. */}
      <div style={{
        background: choosing === 'first' ? NAVY : TEAL,
        padding: '13px 16px', transition: 'background 180ms'
      }}>
        <div style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.8px',
          textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)'
        }}>
          Step {choosing === 'first' ? '1 of 2' : '2 of 2'}
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, color: 'white', marginTop: 2 }}>
          {choosing === 'first' ? 'Pick your first day' : 'Now pick your last day'}
        </div>
        {choosing === 'last' && (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.8)', marginTop: 3 }}>
            Away from {parse(start).getUTCDate()} {MONTHS[parse(start).getUTCMonth()].slice(0, 3)}
            {' · '}
            <button type="button"
              onClick={() => onChange({ start: '', end: '' })}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'white', fontSize: 12.5, fontWeight: 700,
                textDecoration: 'underline'
              }}>
              change
            </button>
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 10px 4px'
      }}>
        <button type="button" onClick={() => step(-1)} aria-label="Previous month"
          style={monthArrow}>‹</button>
        <span style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>
          {MONTHS[shown.month]} {shown.year}
        </span>
        <button type="button" onClick={() => step(1)} aria-label="Next month"
          style={monthArrow}>›</button>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        padding: '0 8px', gap: 2
      }}>
        {DAY_INITIALS.map((d, i) => (
          <div key={i} style={{
            textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: MUTED,
            textTransform: 'uppercase', padding: '4px 0'
          }}>{d}</div>
        ))}

        {cells.map((date, i) => {
          if (!date) return <div key={i} />
          const value = iso(date)
          const isStart = value === start
          const isEnd = value === end
          const inRange = start && end && value > start && value < end
          const selected = isStart || isEnd
          const weekend = isWeekend(date)
          return (
            <button key={i} type="button" onClick={() => tap(date)}
              aria-label={`${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`}
              aria-pressed={selected}
              style={{
                // 40px: this is tapped with a thumb, and a calendar is the
                // densest grid of targets in the app.
                minHeight: 40, border: 'none', cursor: 'pointer', padding: 0,
                borderRadius: selected ? 9 : inRange ? 0 : 9,
                background: selected ? TEAL : inRange ? '#e6f4f2' : 'transparent',
                color: selected ? 'white' : weekend ? MUTED : NAVY,
                fontSize: 14, fontWeight: selected ? 700 : weekend ? 400 : 600
              }}>
              {date.getUTCDate()}
            </button>
          )
        })}
      </div>

      <div style={{
        borderTop: `1px solid ${BORDER}`, marginTop: 8, padding: '11px 16px',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12
      }}>
        <span style={{ fontSize: 12.5, color: MUTED }}>
          {days > 0 ? 'Weekends not counted' : 'Tap a day to start'}
        </span>
        {days > 0 && (
          <strong style={{ fontSize: 16, color: TEAL }}>
            {days} working day{days === 1 ? '' : 's'}
          </strong>
        )}
      </div>
    </div>
  )
}

const monthArrow = {
  width: 40, height: 40, borderRadius: 999, border: 'none', background: 'transparent',
  color: NAVY, fontSize: 19, cursor: 'pointer', lineHeight: 1
}
