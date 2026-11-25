import React, { useMemo, useState } from 'react'
import { useBackLayer } from '../../backButton.js'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, statusTint } from '../../design/tokens.js'
import { whosWhere, groupWhosWhere, WHO_KINDS } from '../../clinicalPlan/whosWhere.js'
import { parseDateStr, weekdayName } from '../../clinicalPlan/week.js'
import StatusSheet from './StatusSheet.jsx'

// ─── Who's where (option B, Brent 25 Nov 2026) ───────────────────────────────
// A strip of avatars under the day's heading on Cases — a ring in the status
// colour, the person's first name and a short tag — with "+ Add" at the end
// and "Whole team ›" for the page grouped by status. It replaces the leave and
// away chips that sat on the day. Tapping a person shows where, when and why,
// with Edit status (and Remove, for one somebody added). The rules for who is
// where are in src/clinicalPlan/whosWhere.js.

const longDay = date => {
  const d = parseDateStr(date)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${weekdayName(date)} ${d.day} ${months[d.month - 1]}`
}

function Avatar({ row, size = 46 }) {
  const tint = statusTint[row.kind || 'none']
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: size / 2, boxSizing: 'border-box', flexShrink: 0,
      border: `3px solid ${tint.ring}`, background: tint.soft, color: tint.ink,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size > 50 ? 18 : 14
    }}>{row.initials}</span>
  )
}

const tagStyle = kind => {
  const tint = statusTint[kind || 'none']
  return {
    display: 'inline-block', ...text('micro'), color: tint.ink, background: tint.soft,
    borderRadius: radius.pill, padding: '1px 6px', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  }
}

/** The strip on the day. */
export default function WhosWhere({ date, days = [], away = [], entries = [], user, onChanged }) {
  const day = days.find(d => d.date === date)
  const rows = useMemo(() => whosWhere({ date, day, away, entries }), [date, day, away, entries])
  const [picked, setPicked] = useState(null)
  const [adding, setAdding] = useState(null)
  const [team, setTeam] = useState(false)

  return (
    <div data-whos-where style={{
      background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card,
      padding: `${space.sm}px ${space.md}px ${space.md}px`, marginBottom: space.md
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: space.sm }}>
        <span style={{ ...text('micro'), color: colour.inkFaint, flex: 1 }}>WHO'S WHERE</span>
        <button type="button" data-whos-where-team onClick={() => setTeam(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', ...text('caption'), fontWeight: 700, color: colour.accentDeep, padding: 0, minHeight: 32 }}>
          Whole team ›
        </button>
      </div>
      <div style={{ display: 'flex', gap: space.md, overflowX: 'auto', paddingBottom: 2 }}>
        {rows.map(row => (
          <button key={row.person.email} type="button" data-whos-where-person={row.person.firstName}
            data-status={row.kind || 'none'}
            aria-label={`${row.person.firstName}, ${row.kind ? WHO_KINDS[row.kind].label : 'no entry'}`}
            onClick={() => (row.kind ? setPicked(row) : setAdding({ email: row.person.email }))}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, minWidth: 56 }}>
            <Avatar row={row} />
            <span style={{ ...text('caption'), fontWeight: 700, color: colour.ink }}>{row.person.firstName}</span>
            <span style={tagStyle(row.kind)}>{row.kind ? row.short : '—'}</span>
          </button>
        ))}
        <button type="button" data-whos-where-add onClick={() => setAdding({})}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, minWidth: 56 }}>
          <span aria-hidden="true" style={{
            width: 46, height: 46, borderRadius: 23, boxSizing: 'border-box', border: `2px dashed ${colour.inkFainter}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', ...text('title'), color: colour.inkFaint
          }}>+</span>
          <span style={{ ...text('caption'), fontWeight: 700, color: colour.inkMuted }}>Add</span>
        </button>
      </div>

      {picked && (
        <PersonSheet row={picked} date={date} user={user}
          onClose={() => setPicked(null)}
          onEdit={() => { setAdding({ email: picked.person.email, kind: picked.kind }); setPicked(null) }}
          onChanged={() => { setPicked(null); onChanged?.() }} />
      )}
      {team && (
        <TeamPage date={date} days={days} away={away} entries={entries}
          onClose={() => setTeam(false)}
          onAdd={(email, d) => setAdding({ email, date: d })} />
      )}
      {adding && (
        <StatusSheet user={user} date={adding.date || date} email={adding.email} kind={adding.kind}
          onClose={() => setAdding(null)} onSaved={() => onChanged?.()} />
      )}
    </div>
  )
}

/** One person: where, when, why — and Edit status. */
function PersonSheet({ row, date, user, onClose, onEdit, onChanged }) {
  useBackLayer(true, onClose)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canRemove = row.entry?.id
  async function remove() {
    if (!window.confirm('Take this status off?')) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/calendar/today?action=away&id=${encodeURIComponent(row.entry.id)}`, {
        method: 'DELETE', headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'Could not take it off.')
      onChanged()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const tag = WHO_KINDS[row.kind]?.tag
  const why = row.source === 'bookings' ? 'From the bookings' : row.source === 'default' ? 'Usual office day' : row.source === 'calendar' ? 'From the Staff Leave calendar' : 'Added in the portal'
  return (
    <Overlay>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label={`${row.person.firstName}'s status`} data-whos-where-card className="tm-sheet"
          style={{ background: colour.surface, width: '100%', maxWidth: 460, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, padding: space.lg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
            <Avatar row={row} size={56} />
            <div style={{ minWidth: 0 }}>
              <div style={{ ...text('title'), color: colour.ink }}>{row.person.firstName} <span style={tagStyle(row.kind)}>{tag}</span></div>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>{longDay(date)} · {why}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: `${space.xs}px ${space.md}px`, marginTop: space.md }}>
            <span style={{ ...text('micro'), color: colour.inkFaint }}>WHERE</span>
            <span style={{ ...text('body'), color: colour.ink }}>{row.where}</span>
            <span style={{ ...text('micro'), color: colour.inkFaint }}>WHEN</span>
            <span style={{ ...text('body'), color: colour.ink }}>{row.when}</span>
          </div>
          {row.note && <div style={{ ...text('body'), color: colour.inkMuted, marginTop: space.sm }}>{row.note}</div>}
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}
          <div style={{ display: 'flex', gap: space.sm, marginTop: space.lg }}>
            <button type="button" onClick={onEdit} data-whos-where-edit style={{ flex: 1, minHeight: 46, borderRadius: radius.control, border: 'none', background: colour.navy, color: 'white', ...text('bodyStrong'), cursor: 'pointer' }}>
              {row.entry ? 'Add another status' : 'Edit status'}
            </button>
            {canRemove && (
              <button type="button" onClick={remove} disabled={busy} data-whos-where-remove style={{ minHeight: 46, borderRadius: radius.control, border: `1px solid ${colour.line}`, background: colour.surface, color: colour.danger, ...text('bodyStrong'), padding: `0 ${space.md}px`, cursor: 'pointer' }}>
                Remove
              </button>
            )}
            <button type="button" onClick={onClose} style={{ minHeight: 46, borderRadius: radius.control, border: `1px solid ${colour.line}`, background: colour.surface, color: colour.ink, ...text('bodyStrong'), padding: `0 ${space.md}px`, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}

/** The whole team for a day, grouped by status, with the week's days to step through. */
function TeamPage({ date: firstDate, days, away, entries, onClose, onAdd }) {
  useBackLayer(true, onClose)
  const [date, setDate] = useState(firstDate)
  const at = days.findIndex(d => d.date === date)
  const rows = whosWhere({ date, day: days[at], away, entries })
  const groups = groupWhosWhere(rows)
  const step = by => { const next = days[at + by]; if (next) setDate(next.date) }
  const arrow = enabled => ({ width: 44, height: 44, borderRadius: 22, border: `1px solid ${colour.line}`, background: colour.surface, ...text('title'), color: enabled ? colour.ink : colour.inkFainter, cursor: enabled ? 'pointer' : 'default' })
  return (
    <Overlay>
      <div data-whos-where-page style={{ position: 'fixed', inset: 0, zIndex: 3000, background: colour.canvas, display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: colour.navy, color: 'white', padding: `calc(env(safe-area-inset-top) + ${space.md}px) ${space.md}px ${space.md}px`, display: 'flex', alignItems: 'center', gap: space.sm }}>
          <button type="button" onClick={onClose} aria-label="Back" data-whos-where-back style={{ width: 44, height: 44, borderRadius: 22, border: 'none', background: colour.navySoft, color: 'white', ...text('title'), cursor: 'pointer' }}>‹</button>
          <span style={{ ...text('title'), flex: 1 }}>Who's where</span>
          <button type="button" onClick={() => onAdd('', date)} style={{ minHeight: 40, borderRadius: radius.pill, border: 'none', background: colour.accent, color: 'white', ...text('bodyStrong'), padding: `0 ${space.md}px`, cursor: 'pointer' }}>+ Add</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: space.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.md }}>
            <button type="button" aria-label="Day before" onClick={() => step(-1)} style={arrow(at > 0)}>‹</button>
            <span data-whos-where-day style={{ ...text('heading'), color: colour.ink, flex: 1, textAlign: 'center' }}>{longDay(date)}</span>
            <button type="button" aria-label="Day after" onClick={() => step(1)} style={arrow(at < days.length - 1)}>›</button>
          </div>
          {groups.map(g => (
            <div key={g.key} data-whos-where-group={g.key} style={{ marginBottom: space.lg }}>
              <div style={{ ...text('micro'), color: colour.inkFaint, marginBottom: space.xs }}>{g.label.toUpperCase()} · {g.rows.length}</div>
              {g.key === 'none' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {g.rows.map(r => (
                    <button key={r.person.email} type="button" onClick={() => onAdd(r.person.email, date)}
                      style={{ minHeight: 40, borderRadius: radius.pill, border: `1px dashed ${colour.inkFainter}`, background: colour.surface, ...text('bodyStrong'), color: colour.inkMuted, padding: `0 ${space.md}px`, cursor: 'pointer' }}>
                      {r.person.firstName} +
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card }}>
                  {g.rows.map((r, i) => (
                    <div key={r.person.email} style={{ display: 'flex', alignItems: 'center', gap: space.md, padding: `${space.sm}px ${space.md}px`, borderTop: i ? `1px solid ${colour.lineSoft}` : 'none' }}>
                      <Avatar row={r} size={40} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...text('bodyStrong'), color: colour.ink }}>{r.person.firstName}</div>
                        <div style={{ ...text('caption'), color: colour.inkFaint }}>{[r.kind === 'leave' ? 'Leave' : r.where, r.note].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span style={{ ...text('caption'), color: colour.inkFaint, flexShrink: 0 }}>{r.when}</span>
                    </div>
                  ))}
                </div>
              )}
              {g.key === 'off' && (
                <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.xs }}>Leave shows as "Leave" only. The reason stays in Xero.</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  )
}
