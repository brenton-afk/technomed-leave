import React, { useState, useEffect, useRef } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { IconSearch } from '../../design/icons.jsx'
import { weekdayName, parseDateStr, todayStr } from '../../clinicalPlan/week.js'

// ─── Search the whole portal (Brent, 6 Nov 2026) ─────────────────────────────
// "Make the search hourglass at the top super powerful so it can search
// literally anything in the portal." Three layers, shown in this order:
//   1. screens to jump to — matched here, instantly (SCREENS);
//   2. bookings and tasks — the calendar search (action=search);
//   3. everything the portal holds — usage scans down to a code or lot number,
//      resupplies, kits and where they are, every tray list line, preference
//      cards and the Inbox (action=find, api/_portalSearch.js).
//
// Before that, it searched bookings only:
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

/**
 * Screens anyone can jump to, with the words people use for them. `admin` only
 * for admins. Each is a place in the app's own navigation ({tab, sub}).
 */
export const SCREENS = [
  { label: 'Timesheets', words: 'timesheet hours pay fortnight toil', to: { tab: 'me', sub: 'timesheets' } },
  { label: 'Apply for leave', words: 'leave annual sick personal holiday toil', to: { tab: 'me', sub: 'leave' } },
  { label: 'Payslips', words: 'payslip pay', to: { tab: 'me', sub: 'payslips' } },
  { label: 'Scan a usage form', words: 'scan usage form camera past scans amend', to: { tab: 'scan' }, kind: 'usage' },
  { label: 'Scan a resupply', words: 'resupply docket packing slip scan', to: { tab: 'scan' }, kind: 'resupply' },
  { label: 'Filed usage sheets', words: 'filed usage sheets dropbox files', to: { tab: 'me', sub: 'usagefiles' } },
  { label: 'Patient history', words: 'patient history previous implants revision', to: { tab: 'me', sub: 'patient' } },
  { label: 'Kit Room', words: 'kit kits room tray trays move loan where', to: { tab: 'kit', sub: 'kitroom' } },
  { label: 'Theatre guides & preference cards', words: 'theatre guide guides preference preferences cards surgeon', to: { tab: 'kit', sub: 'guides' } },
  { label: 'Resources', words: 'resources documents ifu brochures files', to: { tab: 'resources' } },
  { label: 'Team leader', words: 'team leader run sheet runsheet rota', to: { tab: 'cases', sub: 'teamlead' } },
  { label: 'Projects & To Do', words: 'projects project tasks to do todo meeting minutes actions', to: { tab: 'projects' } },
  { label: 'Stock take', words: 'stock take count', to: { tab: 'kit', sub: 'stock' } },
  { label: 'Messages', words: 'messages chat', to: { tab: 'me', sub: 'messages' } },
  { label: 'Notifications', words: 'notifications alerts push', to: { tab: 'me', sub: 'notifications' } },
  { label: 'Admin portal', words: 'admin invoices quotes notices email log approve leave timesheets system xero dropbox', to: { tab: 'admin' }, admin: true }
]

/** Screens whose name or words contain every word typed. */
export function matchScreens(q, { isAdmin = false } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return SCREENS
    .filter(sc => !sc.admin || isAdmin)
    .filter(sc => {
      const hay = `${sc.label} ${sc.words}`.toLowerCase()
      return words.every(w => hay.includes(w))
    })
    .slice(0, 4)
}

const GROUP_ICON = { chat: 'Chat', inbox: 'Inbox', usage: 'Usage', resupply: 'Resupply', kit: 'Kit', trayline: 'Tray', pref: 'Card' }

/** A result from anywhere else in the portal: a tag, a title, one line. */
function PortalResult({ result, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(result)} data-portal-result={result.type}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        background: colour.surface, border: `1px solid ${colour.line}`,
        borderRadius: radius.control, padding: `${space.sm}px ${space.md}px`, marginBottom: space.xs
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm }}>
        <span style={{
          ...text('micro'), textTransform: 'uppercase', color: colour.navy, background: colour.lineSoft,
          padding: '1px 6px', borderRadius: radius.pill, flexShrink: 0
        }}>{GROUP_ICON[result.type] || 'Item'}</span>
        <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{result.title}</span>
        {result.date && <span style={{ ...text('caption'), color: colour.inkFaint, flexShrink: 0 }}>{prettyDate(result.date)}</span>}
      </div>
      {result.detail && <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: 2, overflowWrap: 'anywhere' }}>{result.detail}</div>}
    </button>
  )
}

const sectionLabel = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.md}px 0 ${space.xs}px` }

/** The search button for the Cases header. */
export function SearchButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label="Search the portal"
      style={{
        width: 36, height: 36, flexShrink: 0, borderRadius: radius.pill, cursor: 'pointer',
        // Solid, not see-through: the band behind it carries the logo's tiles.
        border: 'none', background: colour.navySoft, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 2px 6px rgba(0,0,0,0.28)',
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

export default function CaseSearch({ user, onClose, onOpen, onOpenPortal = () => {} }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState({ status: 'idle', results: [], more: false, error: '', groups: [] })
  const latest = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setState({ status: 'idle', results: [], more: false, error: '', groups: [] }); return undefined }
    const ticket = ++latest.current
    // A pause in typing, not every keystroke: each search reads years of calendar.
    const timer = setTimeout(async () => {
      setState(s => ({ ...s, status: 'searching', error: '' }))
      const headers = user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      const ask = action => fetch(`/api/calendar/today?action=${action}&q=${encodeURIComponent(q)}`, { headers })
        .then(async res => ({ res, data: await res.json() }))
      // Both at once; either can fail without losing the other's results.
      const [cal, rest] = await Promise.allSettled([ask('search'), ask('find')])
      if (ticket !== latest.current) return
      const calOk = cal.status === 'fulfilled' && cal.value.res.ok && !cal.value.data.error
      const restOk = rest.status === 'fulfilled' && rest.value.res.ok && !rest.value.data.error
      const groups = restOk ? (rest.value.data.groups || []) : []
      if (!calOk && !restOk) {
        const said = cal.status === 'fulfilled' ? cal.value.data.error : ''
        setState({ status: 'error', results: [], more: false, groups: [], error: said || 'Search is unavailable right now.' })
        return
      }
      setState({
        status: 'done',
        results: calOk ? cal.value.data.results || [] : [],
        more: calOk && Boolean(cal.value.data.more),
        groups,
        error: calOk ? '' : 'Bookings could not be searched just now — showing the rest.'
      })
    }, 350)
    return () => clearTimeout(timer)
  }, [query, user?.token])

  const today = todayStr()
  const screens = matchScreens(query.trim(), { isAdmin: Boolean(user?.isAdmin) })
  const nothing = state.status === 'done' && !state.results.length && !state.groups.length && !screens.length
  const upcoming = state.results.filter(r => r.date >= today).reverse() // soonest first
  const past = state.results.filter(r => r.date < today)                // most recent first

  return (
    <Overlay>
      <div role="dialog" aria-label="Search the portal" style={{
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
              placeholder="Search anything — patient, code, lot, kit…" aria-label="Search the portal"
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
              Bookings and tasks from 2020 to a year ahead, usage scans down to a code or lot
              number, resupplies, kits, tray lists, preference cards, the Inbox — and any screen.
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
          {nothing && (
            <div style={{ ...text('caption'), color: colour.inkFaint, textAlign: 'center', marginTop: space.lg }}>
              Nothing found for “{query.trim()}”.
            </div>
          )}
          {state.status === 'done' && state.error && (
            <div role="alert" style={{ ...text('caption'), color: colour.warning, marginBottom: space.sm }}>{state.error}</div>
          )}

          {screens.length > 0 && (
            <section aria-label="Go to">
              <div style={{ ...sectionLabel, marginTop: space.xs }}>Go to</div>
              {screens.map(sc => (
                <button key={sc.label} type="button" data-go-to onClick={() => onOpenPortal({ type: 'screen', ...sc })}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    textAlign: 'left', cursor: 'pointer', background: colour.accentSoft, border: 'none',
                    borderRadius: radius.control, padding: `${space.sm}px ${space.md}px`, marginBottom: space.xs,
                    ...text('bodyStrong'), color: colour.accentDeep
                  }}>
                  {sc.label}<span aria-hidden="true">›</span>
                </button>
              ))}
            </section>
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
          {state.groups.map(g => (
            <section key={g.key} aria-label={g.label}>
              <div style={sectionLabel}>{g.label}</div>
              {g.items.map(r => <PortalResult key={`${r.type}:${r.id}`} result={r} onOpen={onOpenPortal} />)}
              {g.more && (
                <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.xs }}>
                  More than shown — add a word to narrow it down.
                </div>
              )}
            </section>
          ))}
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
