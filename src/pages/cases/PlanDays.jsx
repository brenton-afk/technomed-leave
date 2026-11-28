import React, { useEffect, useMemo, useState } from 'react'
import { useBackLayer } from '../../backButton.js'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, statusTint } from '../../design/tokens.js'
import { AWAY_REASONS, kindsFor } from '../../clinicalPlan/away.js'
import { WHO_PEOPLE, WHO_KINDS, dayRuns, plannedOn } from '../../clinicalPlan/whosWhere.js'
import { addCivilDays, mondayOf, parseDateStr, toDateStr, todayStr } from '../../clinicalPlan/week.js'

const addDays = (d, n) => toDateStr(addCivilDays(parseDateStr(d), n))
const mondayStr = d => toDateStr(mondayOf(parseDateStr(d)))

// ─── Plan days (Brent, 28 Nov 2026) ──────────────────────────────────────────
// "Staff should be able to easily bulk update their days with a calendar style
// editor instead of having to open each day." Pick who, pick a status, tap the
// days on a five-week calendar, save once. Each run of days in a row is one
// entry (`dayRuns`), saved one after another so no save is lost. "Clear" takes
// the person's portal statuses off the chosen days. What the calendar itself
// says (Erin's "Erin - office" notes, leave) still shows on the strip — this
// edits only what the portal keeps.

const WEEKS = 5
// Fits a phone's narrow cell (seven across at 360px).
const CELL_TAG = { theatre: 'Thtr', office: 'Office', wfh: 'WFH', training: 'Train', away: 'Away', leave: 'Leave', notworking: 'Off' }
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pill = on => ({
  ...text('bodyStrong'), padding: `${space.xs}px ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
  minHeight: 38, border: `1px solid ${on ? colour.navy : colour.line}`,
  background: on ? colour.navy : colour.surface, color: on ? 'white' : colour.ink
})
const Label = ({ children }) => (
  <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.md}px 0 6px` }}>{children}</div>
)

export default function PlanDays({ user, date, email: presetEmail = '', onClose, onSaved }) {
  useBackLayer(true, onClose)
  const me = WHO_PEOPLE.find(p => p.email === String(user?.email || '').toLowerCase())
  const [email, setEmail] = useState(presetEmail || me?.email || '')
  const [kind, setKind] = useState('office')
  const [reason, setReason] = useState('RDO')
  const [start, setStart] = useState(mondayStr(date || todayStr()))
  const [picked, setPicked] = useState(() => new Set())
  const [entries, setEntries] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}
  const end = addDays(start, WEEKS * 7 - 1)

  async function load() {
    try {
      const res = await fetch(`/api/calendar/today?action=away&from=${start}&to=${end}`, { headers: auth })
      const data = await res.json().catch(() => ({}))
      if (Array.isArray(data.entries)) setEntries(data.entries)
    } catch { /* shown empty; saving still works */ }
  }
  useEffect(() => { load() }, [start])

  const kinds = useMemo(() => kindsFor(email), [email])
  useEffect(() => { if (kind !== 'clear' && !kinds.some(k => k.id === kind)) setKind('office') }, [kinds])

  const days = useMemo(() => Array.from({ length: WEEKS * 7 }, (_, i) => addDays(start, i)), [start])
  const today = todayStr()
  const toggle = d => setPicked(set => { const n = new Set(set); n.has(d) ? n.delete(d) : n.add(d); return n })
  const pickWeekdays = () => setPicked(new Set(days.filter((d, i) => i % 7 < 5 && d >= today)))

  async function save() {
    if (!email || !picked.size) return
    setBusy(true); setError(''); setDone('')
    try {
      if (kind === 'clear') {
        const ids = [...new Set(entries
          .filter(e => String(e.email || '').toLowerCase() === email && [...picked].some(d => e.from <= d && e.to >= d))
          .map(e => e.id))]
        const spills = entries.filter(e => ids.includes(e.id) && (e.from !== e.to))
        if (spills.length && !window.confirm('Some of these are part of a longer entry — the whole entry comes off. Carry on?')) { setBusy(false); return }
        for (const id of ids) {
          const res = await fetch(`/api/calendar/today?action=away&id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || data.error) throw new Error(data.error || 'Could not take one off.')
        }
        setDone(ids.length ? `Cleared ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}.` : 'Nothing to clear on those days.')
      } else {
        const runs = dayRuns([...picked])
        for (const run of runs) {
          const res = await fetch('/api/calendar/today?action=away', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth },
            body: JSON.stringify({ email, kind, reason: kind === 'away' ? reason : '', from: run.from, to: run.to, allDay: true })
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || data.error) throw new Error(data.error || 'Could not save one of the days.')
        }
        setDone(`${picked.size} ${picked.size === 1 ? 'day' : 'days'} saved.`)
      }
      setPicked(new Set())
      await load()
      onSaved?.()
    } catch (err) {
      setError(err.message)
      await load()
      onSaved?.()
    } finally {
      setBusy(false)
    }
  }

  const label = kind === 'clear' ? 'Clear' : (WHO_KINDS[kind]?.label || kind)
  const who = WHO_PEOPLE.find(p => p.email === email)?.firstName

  return (
    <Overlay>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
      }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Plan days" data-plan-days-sheet className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 520, maxHeight: '94%',
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, display: 'flex', flexDirection: 'column'
          }}>
          <div style={{ padding: `${space.md}px ${space.md}px ${space.sm}px`, borderBottom: `1px solid ${colour.line}`, display: 'flex', alignItems: 'center', gap: space.sm, flexShrink: 0 }}>
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Plan days</span>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', ...text('heading'), color: colour.inkFaint, lineHeight: 1 }}>×</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden' }}>
            <Label>Who</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {WHO_PEOPLE.map(p => (
                <button key={p.email} type="button" data-plan-person={p.firstName}
                  onClick={() => { setEmail(p.email); setPicked(new Set()) }} style={pill(email === p.email)}>{p.firstName}</button>
              ))}
            </div>

            <Label>Set the days to</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[...kinds.map(k => k.id), 'clear'].map(id => {
                const on = kind === id
                const tint = statusTint[id] || statusTint.none
                return (
                  <button key={id} type="button" data-plan-kind={id} onClick={() => setKind(id)} style={{
                    ...text('bodyStrong'), minHeight: 38, padding: `${space.xs}px ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
                    border: `2px solid ${on ? tint.ring : colour.line}`, background: on ? tint.soft : colour.surface, color: on ? tint.ink : colour.ink
                  }}>{id === 'clear' ? 'Clear' : WHO_KINDS[id]?.label || id}</button>
                )
              })}
            </div>
            {kind === 'away' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
                {AWAY_REASONS.map(r => <button key={r} type="button" data-plan-reason={r} onClick={() => setReason(r)} style={pill(reason === r)}>{r}</button>)}
              </div>
            )}
            {kind === 'boysweek' && (
              <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: space.sm }}>
                Late start and early finish. Where he is (theatre, office) still shows as well.
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, margin: `${space.md}px 0 ${space.sm}px` }}>
              <button type="button" data-plan-prev aria-label="Earlier weeks" onClick={() => setStart(s => addDays(s, -28))} style={pill(false)}>‹</button>
              <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, textAlign: 'center' }}>
                {fmt(start)} – {fmt(end)}
              </span>
              <button type="button" data-plan-next aria-label="Later weeks" onClick={() => setStart(s => addDays(s, 28))} style={pill(false)}>›</button>
            </div>

            <div data-plan-grid style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
              {DAY_NAMES.map(n => <div key={n} style={{ ...text('micro'), color: colour.inkFaint, textAlign: 'center', paddingBottom: 2 }}>{n}</div>)}
              {days.map((d, i) => {
                const on = picked.has(d)
                const { place, boys } = plannedOn(entries, email, d)
                const tint = place ? statusTint[place.kind] || statusTint.none : null
                const weekend = i % 7 >= 5
                return (
                  <button key={d} type="button" data-plan-day={d} data-picked={on ? 'yes' : 'no'}
                    data-planned={place?.kind || ''} onClick={() => toggle(d)}
                    aria-label={`${d}${place ? `, ${WHO_KINDS[place.kind]?.label || place.kind}` : ''}${on ? ', chosen' : ''}`}
                    style={{
                      minHeight: 54, minWidth: 0, borderRadius: radius.control, cursor: 'pointer', padding: '4px 2px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                      border: on ? `2px solid ${colour.navy}` : `1px solid ${d === today ? colour.accent : colour.line}`,
                      background: on ? colour.navy : weekend ? colour.canvas : colour.surface,
                      color: on ? 'white' : d < today ? colour.inkFaint : colour.ink
                    }}>
                    <span style={{ ...text('caption'), fontWeight: 700 }}>{Number(d.slice(8))}</span>
                    {place && (
                      <span style={{
                        ...text('micro'), maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        padding: '0 4px', borderRadius: radius.pill, background: on ? 'rgba(255,255,255,0.2)' : tint.soft, color: on ? 'white' : tint.ink
                      }}>{CELL_TAG[place.kind] || ''}</span>
                    )}
                    {boys && <span aria-label="Boys week" title="Boys week" style={{ width: 6, height: 6, borderRadius: 3, background: statusTint.boysweek.ring }} />}
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' }}>
              <button type="button" data-plan-weekdays onClick={pickWeekdays} style={pill(false)}>Every weekday shown</button>
              {picked.size > 0 && <button type="button" data-plan-unpick onClick={() => setPicked(new Set())} style={pill(false)}>Untick all</button>}
            </div>

            {error && <div role="alert" style={{ ...text('body'), color: colour.danger, marginTop: space.md }}>{error}</div>}
            {done && <div role="status" data-plan-done style={{ ...text('body'), color: colour.accentDeep, marginTop: space.md }}>✓ {done}</div>}
          </div>

          <div style={{ padding: space.md, borderTop: `1px solid ${colour.line}`, flexShrink: 0 }}>
            <button type="button" data-plan-save disabled={busy || !email || !picked.size} onClick={save} style={{
              width: '100%', minHeight: 48, borderRadius: radius.pill, border: 'none', cursor: 'pointer',
              background: busy || !picked.size ? colour.inkFainter : colour.accent, color: 'white', ...text('bodyStrong')
            }}>
              {busy ? 'Saving…' : picked.size
                ? `${kind === 'clear' ? 'Clear' : `Set ${picked.size} ${picked.size === 1 ? 'day' : 'days'} to ${label}`}${who ? ` · ${who}` : ''}`
                : 'Tap the days to change'}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}

function fmt(d) {
  return `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`
}
