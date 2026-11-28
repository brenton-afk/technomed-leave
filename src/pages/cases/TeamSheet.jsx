import React, { useMemo } from 'react'
import { useBackLayer } from '../../backButton.js'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, statusTint } from '../../design/tokens.js'
import { whosWhere } from '../../clinicalPlan/whosWhere.js'
import { weekdayName, parseDateStr } from '../../clinicalPlan/week.js'
import WhosWhere from './WhosWhere.jsx'

// ─── The Team button and sheet (option B, Brent 25 Nov 2026) ────────────────
// "Have a cases page that is literally just cases": who's where, the day's kit
// jobs, + Task and the Inbox moved off the Cases page into one sheet, opened
// from a button on the band that shows a few faces and a count of what is
// waiting (kit jobs + bookings in the Inbox), so nothing is hidden.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = date => {
  const d = parseDateStr(date)
  return `${weekdayName(date).slice(0, 3)} ${d.day} ${MONTHS[d.month - 1]}`
}

/**
 * Who's where for one day of the week, as small faces (Brent, 27 Nov 2026:
 * the week view — the desktop's columns and the phone's week list — still
 * drew the old leave / training / on-call chips; phone and desktop must say
 * the same thing). Tapping opens the Team sheet for that day.
 */
export function TeamFaces({ date, days = [], away = [], entries = [], notes = 0, onClick }) {
  const day = days.find(d => d.date === date)
  const rows = useMemo(
    () => whosWhere({ date, day, away, entries }).filter(r => r.kind),
    [date, day, away, entries])
  // Always drawn, with an Edit pill, so every day can be opened — on a
  // desktop the week is the only view (Brent, 28 Nov 2026: "there's no way to
  // edit the team entries on a specific day").
  const label = rows.map(r => `${r.person.firstName} ${r.where || r.short || r.kind}`).join(', ')
  return (
    <button type="button" data-team-faces={date} onClick={() => onClick?.(date)}
      aria-label={`Team on ${shortDay(date)}${label ? `: ${label}` : ''}`}
      title={label}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, width: '100%',
        background: 'none', border: 'none', padding: 0, margin: '4px 0 2px', cursor: 'pointer'
      }}>
      {rows.map(r => {
        const tint = statusTint[r.kind] || statusTint.office
        return (
          <span key={r.person.email} data-team-face={r.person.firstName} data-status={r.kind} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, boxSizing: 'border-box',
            border: `1.5px solid ${tint.ring}`, background: tint.soft, color: tint.ink,
            borderRadius: radius.pill, padding: '1px 6px 1px 2px', ...text('micro'), letterSpacing: 0
          }}>
            <span aria-hidden="true" style={{
              width: 18, height: 18, borderRadius: 9, background: tint.ring, color: 'white',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...text('micro'), letterSpacing: 0, lineHeight: 1
            }}>{r.initials}</span>
            {r.person.firstName} · {r.short || r.kind}
          </span>
        )
      })}
      {notes > 0 && (
        <span data-team-faces-notes style={{
          ...text('micro'), letterSpacing: 0, color: colour.warning, background: colour.warningSoft,
          border: `1px solid ${colour.warningLine}`, borderRadius: radius.pill, padding: '1px 6px'
        }}>{notes} {notes === 1 ? 'note' : 'notes'}</span>
      )}
      <span data-team-faces-edit style={{
        ...text('micro'), letterSpacing: 0, color: colour.accentDeep, background: colour.surface,
        border: `1px dashed ${colour.inkFainter}`, borderRadius: radius.pill, padding: '1px 8px'
      }}>{rows.length ? 'Edit' : '+ Team'}</span>
    </button>
  )
}

/** The band's button: up to four faces of people with a status that day. */
export function TeamButton({ date, days = [], away = [], entries = [], waiting = 0, onClick }) {
  const day = days.find(d => d.date === date)
  const faces = useMemo(
    () => whosWhere({ date, day, away, entries }).filter(r => r.kind).slice(0, 4),
    [date, day, away, entries])
  return (
    <button type="button" data-team-button onClick={onClick}
      aria-label={`Team today${waiting ? ` — ${waiting} waiting` : ''}`}
      style={{
        position: 'relative', height: 36, flexShrink: 0, borderRadius: radius.pill, cursor: 'pointer',
        border: 'none', background: colour.navySoft, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 2px 6px rgba(0,0,0,0.28)',
        color: 'white', display: 'flex', alignItems: 'center', gap: 6, padding: `0 ${space.md}px 0 6px`
      }}>
      <span aria-hidden="true" style={{ display: 'flex', paddingRight: faces.length ? 6 : 0 }}>
        {faces.map(r => {
          const tint = statusTint[r.kind]
          return (
            <span key={r.person.email} style={{
              width: 24, height: 24, borderRadius: 12, boxSizing: 'border-box', marginRight: -6,
              border: `2px solid ${tint.ring}`, background: tint.soft, color: tint.ink,
              display: 'flex', alignItems: 'center', justifyContent: 'center', ...text('micro'), letterSpacing: 0
            }}>{r.initials}</span>
          )
        })}
      </span>
      <span style={{ ...text('caption'), fontWeight: 700 }}>Team</span>
      {waiting > 0 && (
        <span data-team-waiting style={{
          minWidth: 18, height: 18, borderRadius: 9, padding: '0 5px', boxSizing: 'border-box',
          background: colour.warning, color: 'white', ...text('micro'),
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>{waiting}</span>
      )}
    </button>
  )
}

/**
 * The sheet. `jobs` are the day's kit jobs, drawn by `renderJob` (CaseWeek's
 * own TaskRow, so they look and tick exactly as they did on the page).
 */
export default function TeamSheet({ date, days, away, entries, user, onChanged, jobs = [], renderJob, also = [], notes = [], renderItem, onInbox, queueCount = 0, onClose }) {
  useBackLayer(true, onClose)
  const button = { flex: 1, minHeight: 44, borderRadius: radius.control, cursor: 'pointer', ...text('bodyStrong'), fontWeight: 700, whiteSpace: 'nowrap' }
  return (
    <Overlay>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 2900, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Team" data-team-sheet className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 520, maxHeight: '88%', overflowY: 'auto', overflowX: 'hidden',
            boxSizing: 'border-box', borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, padding: space.lg
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.md }}>
            <h2 style={{ margin: 0, flex: 1, ...text('title'), color: colour.ink }}>Team · {shortDay(date)}</h2>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ width: 40, height: 40, borderRadius: 20, border: 'none', background: colour.surface, cursor: 'pointer', ...text('heading'), color: colour.ink }}>✕</button>
          </div>

          <WhosWhere date={date} days={days} away={away} entries={entries} user={user} onChanged={onChanged} />

          {/* Hours and on-call notes from the calendar — "Ben - LATE START",
              "Ben on Call 5:00pm Fri - 7:30am Mon" (Brent, 27 Nov 2026). */}
          {notes.length > 0 && (
            <div data-team-notes style={{ background: colour.warningSoft, border: `1px solid ${colour.warningLine}`, borderRadius: radius.card, padding: space.md, marginBottom: space.md }}>
              <div style={{ ...text('micro'), color: colour.inkFaint, marginBottom: space.sm }}>HOURS AND ON CALL</div>
              {notes.map((n, i) => <div key={i} style={{ ...text('body'), color: colour.ink, padding: `${space.xs}px 0` }}>{n.text}</div>)}
            </div>
          )}

          <div data-team-jobs style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md, marginBottom: space.md }}>
            <div style={{ ...text('micro'), color: colour.inkFaint, marginBottom: space.sm }}>KIT JOBS</div>
            {jobs.length
              ? jobs.map(job => <React.Fragment key={job.id}>{renderJob(job)}</React.Fragment>)
              : <div style={{ ...text('caption'), color: colour.inkFaint }}>No kit to move today.</div>}
          </div>

          {/* What else is on the calendar today — meetings, reminders, notes
              (moved off the Cases page, Brent 25 Nov 2026). */}
          {also.length > 0 && (
            <div data-team-also style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md, marginBottom: space.md }}>
              <div style={{ ...text('micro'), color: colour.inkFaint, marginBottom: space.sm }}>ALSO ON TODAY</div>
              {also.map((item, i) => <React.Fragment key={i}>{renderItem ? renderItem(item) : <div style={{ ...text('body') }}>{item.title || item.text}</div>}</React.Fragment>)}
            </div>
          )}

          {/* + Task is gone (Brent, 25 Nov 2026: tasks will come mostly from kit
              movement, not be typed in). */}
          <button type="button" onClick={onInbox} aria-label="Check the bookings inbox"
            style={{
              ...button, width: '100%',
              border: `1px solid ${queueCount > 0 ? colour.warningLine : colour.line}`,
              background: queueCount > 0 ? colour.warningSoft : colour.surface, color: colour.ink
            }}>
            Inbox{queueCount > 0 ? ` · ${queueCount}` : ''}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
