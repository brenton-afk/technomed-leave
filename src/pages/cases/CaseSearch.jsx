import React, { useState, useEffect, useRef } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { IconSearch } from '../../design/icons.jsx'
import { weekdayName, parseDateStr, todayStr } from '../../clinicalPlan/week.js'

// ─── Search every booking ─────────────────────────────────────────────────────
// "The search for patients who are booked or who have been booked needs to be
// somewhere on the cases page, similar to how Google Calendar has a search
// glass at the top."
//
// A surname, a surgeon, a system, a procedure or a hospital — past and future,
// newest first, split into what is coming and what has happened. Tapping a
// result opens the booking, exactly as tapping its card does.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function prettyDate(date) {
  const { year, month, day } = parseDateStr(date)
  return `${weekdayName(date).slice(0, 3)} ${day} ${MONTHS[month - 1]} ${year}`
}

/** The search button for the Cases header. */
export function SearchButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label="Search bookings"
      style={{
        width: 36, height: 36, flexShrink: 0, borderRadius: radius.pill, cursor: 'pointer',
        border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.08)',
        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
      <IconSearch size={19} />
    </button>
  )
}

// A task — from the calendar or the Projects board — as a task: what it is,
// whose, and whether it is done. A calendar task opens its sheet, as tapping it
// in the week does; a board item says where it lives.
function TaskResult({ result, onOpen }) {
  const onBoard = result.type === 'project'
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm }}>
        <span style={{
          ...text('micro'), textTransform: 'uppercase', color: colour.accentDeep, background: colour.accentSoft,
          padding: '1px 6px', borderRadius: radius.pill, flexShrink: 0
        }}>{onBoard ? 'Project task' : 'Task'}</span>
        <span style={{
          ...text('bodyStrong'), color: result.done ? colour.inkFaint : colour.ink, flex: 1, minWidth: 0,
          textDecoration: result.done ? 'line-through' : 'none'
        }}>{result.what}</span>
        {result.date && <span style={{ ...text('caption'), color: colour.inkFaint, flexShrink: 0 }}>{prettyDate(result.date)}</span>}
      </div>
      <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: 2 }}>
        {[result.who ? `For ${result.who}` : '', result.done ? 'Done' : 'Open', onBoard ? 'on the Projects board' : ''].filter(Boolean).join(' · ')}
      </div>
    </>
  )
  const box = {
    display: 'block', width: '100%', textAlign: 'left', background: colour.surface,
    border: `1px solid ${colour.line}`, borderRadius: radius.control,
    padding: `${space.sm}px ${space.md}px`, marginBottom: space.sm
  }
  return onBoard
    ? <div style={box}>{body}</div>
    : <button type="button" onClick={() => onOpen(result)} style={{ ...box, cursor: 'pointer' }}>{body}</button>
}

function Result({ result, onOpen }) {
  if (result.type === 'task' || result.type === 'project') return <TaskResult result={result} onOpen={onOpen} />
  return (
    <button type="button" onClick={() => onOpen(result)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        background: colour.surface, border: `1px solid ${colour.line}`,
        borderRadius: radius.control, padding: `${space.sm}px ${space.md}px`, marginBottom: space.xs
      }}>
      <div style={{ display: 'flex', gap: space.sm, alignItems: 'baseline' }}>
        <span style={{
          ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0,
          textDecoration: result.cancelled ? 'line-through' : 'none'
        }}>
          {result.patient || 'Name to come'}{result.surgeon ? ` / ${result.surgeon}` : ''}
        </span>
        <span style={{ ...text('caption'), color: colour.inkMuted, flexShrink: 0 }}>
          {prettyDate(result.date)}
        </span>
      </div>
      <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: 2 }}>
        {[result.operation, result.system, result.hospital].filter(Boolean).join(' · ')}
        {result.cancelled ? ' · cancelled' : ''}
      </div>
    </button>
  )
}

export default function CaseSearch({ user, onClose, onOpen }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState({ status: 'idle', results: [], more: false, error: '' })
  const latest = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setState({ status: 'idle', results: [], more: false, error: '' }); return undefined }
    const ticket = ++latest.current
    // A pause in typing, not every keystroke: each search reads years of calendar.
    const timer = setTimeout(async () => {
      setState(s => ({ ...s, status: 'searching', error: '' }))
      try {
        const res = await fetch(`/api/calendar/today?action=search&q=${encodeURIComponent(q)}`,
          { headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {} })
        const data = await res.json()
        if (ticket !== latest.current) return
        if (!res.ok || data.error) throw new Error(data.error || 'Search is unavailable right now.')
        setState({ status: 'done', results: data.results || [], more: Boolean(data.more), error: '' })
      } catch (err) {
        if (ticket !== latest.current) return
        setState({ status: 'error', results: [], more: false, error: err.message })
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query, user?.token])

  const today = todayStr()
  const upcoming = state.results.filter(r => r.date >= today).reverse() // soonest first
  const past = state.results.filter(r => r.date < today)                // most recent first

  return (
    <Overlay>
      <div role="dialog" aria-label="Search bookings" style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: colour.canvas,
        display: 'flex', flexDirection: 'column'
      }}>
        <div style={{
          background: colour.navy, flexShrink: 0,
          padding: `calc(env(safe-area-inset-top, 0px) + ${space.md}px) ${space.md}px ${space.md}px`,
          display: 'flex', gap: space.sm, alignItems: 'center'
        }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: space.sm,
            background: colour.surface, borderRadius: radius.pill, padding: `0 ${space.md}px`
          }}>
            <span style={{ color: colour.inkFaint, display: 'flex' }}><IconSearch size={18} /></span>
            <input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Surname, surgeon, system, task…" aria-label="Search bookings"
              style={{
                flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                padding: `${space.sm}px 0`, ...text('field'), color: colour.ink
              }} />
          </div>
          <button type="button" onClick={onClose} style={{
            background: 'none', border: 'none', color: 'white', cursor: 'pointer',
            ...text('bodyStrong'), padding: space.xs
          }}>Close</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: space.md }}>
          {state.status === 'idle' && (
            <div style={{ ...text('caption'), color: colour.inkFaint, textAlign: 'center', marginTop: space.lg }}>
              Every booking and task from 2020 to a year ahead.
            </div>
          )}
          {state.status === 'searching' && (
            <div role="status" style={{ ...text('caption'), color: colour.inkFaint, textAlign: 'center', marginTop: space.lg }}>
              Searching…
            </div>
          )}
          {state.status === 'error' && (
            <div role="alert" style={{ ...text('caption'), color: colour.danger, textAlign: 'center', marginTop: space.lg }}>
              {state.error}
            </div>
          )}
          {state.status === 'done' && !state.results.length && (
            <div style={{ ...text('caption'), color: colour.inkFaint, textAlign: 'center', marginTop: space.lg }}>
              No bookings found for “{query.trim()}”.
            </div>
          )}

          {upcoming.length > 0 && (
            <section aria-label="Upcoming">
              <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.xs}px 0` }}>
                Coming up
              </div>
              {upcoming.map(r => <Result key={r.id} result={r} onOpen={onOpen} />)}
            </section>
          )}
          {past.length > 0 && (
            <section aria-label="Past">
              <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.md}px 0 ${space.xs}px` }}>
                Past
              </div>
              {past.map(r => <Result key={r.id} result={r} onOpen={onOpen} />)}
            </section>
          )}
          {state.more && (
            <div style={{ ...text('caption'), color: colour.inkFaint, textAlign: 'center', marginTop: space.sm }}>
              Showing the most recent matches — add a word to narrow it down.
            </div>
          )}
        </div>
      </div>
    </Overlay>
  )
}
