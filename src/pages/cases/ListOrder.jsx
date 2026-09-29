import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { listsForDay, listKey, runningOrder, summarise, oursFirstUp, OURS, OTHER }
  from '../../clinicalPlan/listOrder.js'
import DictateBooking from './DictateBooking.jsx'

// ─── The evening ring-round, in the app ──────────────────────────────────────
// The team leader rings each hospital about four or five for the order of
// tomorrow's lists, and posts what they are told to the WhatsApp group. This is
// that message, where the people who need it are already looking.
//
// Position, not time. The hospital gives no times and the ones it does give move
// all day. What the position says is the thing anyone needs by the evening: is
// one of ours first up, so somebody is on site by half seven — or is there an
// ACDF and a craniotomy ahead of us and the morning is free.

/** How a case reads in the order — enough to recognise it, no more. */
function EntryRow({ entry, onUp, onDown, onRemove, editing }) {
  const ours = entry.kind === OURS
  const booking = entry.booking

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: space.sm,
      padding: space.sm, marginBottom: 6,
      borderRadius: radius.control,
      background: ours ? colour.surface : 'transparent',
      border: `1px solid ${ours ? colour.line : colour.lineSoft}`
    }}>
      <span style={{
        ...text('bodyStrong'), width: 22, flexShrink: 0, textAlign: 'center',
        color: entry.position === 1 ? colour.accentDeep : colour.inkFaint
      }}>{entry.position}</span>

      <span style={{ flex: 1, minWidth: 0 }}>
        {ours ? (
          <>
            <span style={{ ...text('bodyStrong'), color: colour.ink }}>
              {booking.patient}
              <span style={{ color: colour.inkFainter, fontWeight: 400 }}> / </span>
              {booking.surgeon}
            </span>
            <span style={{ ...text('caption'), color: colour.inkMuted, display: 'block' }}>
              {[booking.operation, booking.system].filter(Boolean).join(' · ')}
            </span>
          </>
        ) : (
          <>
            {/* Not ours, and said so. What it is matters — an ACDF is an hour
                and a half, a craniotomy is most of the morning — and that is
                the whole reason the order is worth ringing for. */}
            <span style={{ ...text('body'), color: colour.inkMuted }}>{entry.label}</span>
            {entry.note && (
              <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block' }}>
                {entry.note}
              </span>
            )}
          </>
        )}
      </span>

      {ours && (
        <span style={{
          ...text('micro'), textTransform: 'uppercase', flexShrink: 0,
          background: colour.accentSoft, color: colour.accentDeep,
          borderRadius: radius.pill, padding: '2px 8px'
        }}>Ours</span>
      )}

      {editing && (
        <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {/* Buttons, not drag. A drag handle on a phone competes with the
              scroll and fails silently when it loses; two arrows never do. */}
          <button onClick={onUp} disabled={!onUp} aria-label="Move up" style={arrow(!onUp)}>↑</button>
          <button onClick={onDown} disabled={!onDown} aria-label="Move down" style={arrow(!onDown)}>↓</button>
          {!ours && (
            <button onClick={onRemove} aria-label="Remove" style={arrow(false)}>×</button>
          )}
        </span>
      )}
    </div>
  )
}

const arrow = disabled => ({
  width: 32, height: 32, borderRadius: radius.control,
  border: `1px solid ${colour.line}`, background: colour.surface,
  color: disabled ? colour.inkFainter : colour.inkMuted,
  cursor: disabled ? 'default' : 'pointer', ...text('body'), padding: 0
})

/** One theatre's list, read-only, as it appears under the day. */
export function ListCard({ list, order, onEdit }) {
  const where = [list.hospital === 'CALVARY LENAH VALLEY' ? 'Calvary' : list.hospital,
    list.theatre ? `Theatre ${list.theatre}` : null].filter(Boolean).join(' · ')
  const line = summarise(order)
  const first = oursFirstUp(order)

  return (
    <div style={{
      border: `1px solid ${first ? colour.warningLine : colour.line}`,
      background: first ? colour.warningSoft : colour.surface,
      borderRadius: radius.card, padding: space.md, marginBottom: space.md
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, marginBottom: space.xs }}>
        <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1 }}>{where}</span>
        <button onClick={onEdit} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          ...text('caption'), color: colour.accentDeep, padding: 0
        }}>{order.recorded ? 'Change' : 'Set order'}</button>
      </div>

      {!order.recorded && (
        <div style={{ ...text('caption'), color: colour.inkFaint }}>
          Order not taken yet.
        </div>
      )}

      {line && (
        <div style={{
          ...text('bodyStrong'),
          color: first ? colour.ink : colour.inkMuted, marginBottom: space.xs
        }}>
          {/* The answer to the evening's question, before the list itself. */}
          {first ? `▶ ${line} — on site by 07:30` : line}
        </div>
      )}

      {order.entries.map(entry => (
        <EntryRow key={`${entry.position}`} entry={entry} editing={false} />
      ))}

      {order.unplaced.length > 0 && (
        <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.xs }}>
          {/* Added after the ring-round. Not silently last. */}
          Not in the order yet: {order.unplaced.map(c => c.patient).join(', ')}
        </div>
      )}

      {order.updatedBy && (
        <div style={{ ...text('micro'), color: colour.inkFainter, marginTop: space.xs }}>
          Taken by {order.updatedBy}
        </div>
      )}
    </div>
  )
}

/** Setting one list's order. */
function EditList({ list, order, date, user, onClose, onSaved }) {
  const [entries, setEntries] = useState(() => {
    const placed = order.entries.map(e => e.kind === OURS
      ? { kind: OURS, eventId: e.booking.id, booking: e.booking }
      : { kind: OTHER, label: e.label, note: e.note })
    // Ours that nobody has placed go on the end, so the starting point is the
    // whole list rather than a blank one.
    return [...placed, ...order.unplaced.map(b => ({ kind: OURS, eventId: b.id, booking: b }))]
  })
  const [adding, setAdding] = useState('')
  const [status, setStatus] = useState('ready')
  const [error, setError] = useState('')
  const [dictating, setDictating] = useState(false)

  const move = (from, to) => setEntries(list_ => {
    if (to < 0 || to >= list_.length) return list_
    const next = [...list_]
    const [taken] = next.splice(from, 1)
    next.splice(to, 0, taken)
    return next
  })

  async function save() {
    setStatus('saving'); setError('')
    try {
      const res = await fetch(`/api/calendar/today?action=listorder&date=${date}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
        },
        body: JSON.stringify({
          key: listKey(date, list.hospital, list.theatre),
          hospital: list.hospital,
          theatre: list.theatre,
          entries: entries.map(e => e.kind === OURS
            ? { kind: 'ours', eventId: e.eventId }
            : { kind: 'other', label: e.label, note: e.note })
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That did not save')
      onSaved()
    } catch (err) {
      setError(err.message)
      setStatus('ready')
    }
  }

  /**
   * What was dictated, turned into an order.
   *
   * Spoken surnames are matched against the cases already on this list; anything
   * else said becomes a case that is not ours. "ACDF competitor cage, then Kon,
   * then Rowe" is the whole entry.
   */
  function applySpoken(fields) {
    const said = `${fields.patient || ''} ${fields.procedure || ''} ${fields.note || ''}`
    const parts = said.split(/,|\bthen\b|\bfollowed by\b/i).map(p => p.trim()).filter(Boolean)
    if (!parts.length) return

    const ours = new Map(entries
      .filter(e => e.kind === OURS)
      .map(e => [e.booking.patient.toLowerCase(), e]))

    const next = []
    for (const part of parts) {
      const match = [...ours.entries()].find(([surname]) =>
        part.toLowerCase().includes(surname))
      if (match) {
        next.push(match[1])
        ours.delete(match[0])
      } else {
        next.push({ kind: OTHER, label: part, note: '' })
      }
    }
    // Anything of ours not mentioned keeps its place at the end rather than
    // being dropped by a sentence that forgot it.
    setEntries([...next, ...ours.values()])
    setDictating(false)
  }

  return (
    <Overlay>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
      }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Set the list order"
          className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 560,
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
            display: 'flex', flexDirection: 'column'
          }}>

          <div style={{
            padding: `${space.md}px ${space.md}px ${space.sm}px`,
            borderBottom: `1px solid ${colour.line}`, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: space.sm
          }}>
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>
              {list.hospital === 'CALVARY LENAH VALLEY' ? 'Calvary' : list.hospital}
              {list.theatre ? ` · Theatre ${list.theatre}` : ''}
            </span>
            {!dictating && (
              <button onClick={() => setDictating(true)} aria-label="Say the order"
                style={{
                  background: 'none', border: `1px solid ${colour.line}`,
                  borderRadius: radius.pill, padding: `4px ${space.sm}px`,
                  cursor: 'pointer', ...text('caption'), color: colour.inkMuted
                }}>🎤 Say it</button>
            )}
            <button onClick={onClose} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              ...text('body'), color: colour.inkFaint
            }}>Close</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', flex: 1 }}>
            {dictating && (
              <DictateBooking user={user}
                onFilled={applySpoken}
                onClose={() => setDictating(false)} />
            )}

            {error && (
              <div style={{
                background: colour.dangerSoft, border: `1px solid ${colour.dangerLine}`,
                color: colour.danger, borderRadius: radius.control,
                padding: space.sm, marginBottom: space.md, ...text('caption')
              }}>{error}</div>
            )}

            <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
              Put them in the order the hospital gave you. Cases that are not ours count too.
            </div>

            {entries.map((entry, i) => (
              <EntryRow key={i} editing
                entry={{
                  ...entry, position: i + 1,
                  booking: entry.booking, label: entry.label, note: entry.note
                }}
                onUp={i > 0 ? () => move(i, i - 1) : null}
                onDown={i < entries.length - 1 ? () => move(i, i + 1) : null}
                onRemove={() => setEntries(list_ => list_.filter((_, at) => at !== i))} />
            ))}

            <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm }}>
              <input
                value={adding}
                onChange={e => setAdding(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter' || !adding.trim()) return
                  setEntries(list_ => [...list_, { kind: OTHER, label: adding.trim(), note: '' }])
                  setAdding('')
                }}
                placeholder="Another surgeon's case — e.g. ACDF, competitor cage"
                aria-label="Add another case"
                style={{
                  flex: 1, padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
                  border: `1px solid ${colour.line}`, borderRadius: radius.control,
                  ...text('field'), color: colour.ink, background: colour.surface, outline: 'none'
                }} />
              <button
                onClick={() => {
                  if (!adding.trim()) return
                  setEntries(list_ => [...list_, { kind: OTHER, label: adding.trim(), note: '' }])
                  setAdding('')
                }}
                style={{
                  padding: `0 ${space.md}px`, borderRadius: radius.control,
                  border: `1px solid ${colour.line}`, background: colour.surface,
                  color: colour.inkMuted, cursor: 'pointer', ...text('bodyStrong')
                }}>Add</button>
            </div>
          </div>

          <div style={{
            padding: `${space.sm}px ${space.md}px calc(${space.md}px + env(safe-area-inset-bottom, 0px))`,
            borderTop: `1px solid ${colour.line}`, display: 'flex', gap: space.sm, flexShrink: 0
          }}>
            <button onClick={onClose} style={{
              flex: 1, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
              background: 'transparent', color: colour.inkMuted,
              border: `1px solid ${colour.line}`, borderRadius: radius.control
            }}>Cancel</button>
            <button onClick={save} disabled={status === 'saving'} style={{
              flex: 2, padding: space.sm, ...text('bodyStrong'), color: 'white', border: 'none',
              borderRadius: radius.control,
              background: status === 'saving' ? colour.inkFainter : colour.accent,
              cursor: status === 'saving' ? 'default' : 'pointer'
            }}>{status === 'saving' ? 'Saving…' : 'Save the order'}</button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}

/** Every list on one day, with its order. */
export default function ListOrders({ date, cases, user }) {
  const [recorded, setRecorded] = useState({})
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendar/today?action=listorder&date=${date}`, {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      if (!res.ok) return
      const data = await res.json()
      setRecorded(data.lists || {})
    } catch {
      // An order that cannot be read is not a reason to hide the day.
    }
  }, [date, user])

  useEffect(() => { load() }, [load])

  const lists = useMemo(() => listsForDay(cases || []), [cases])
  if (!lists.length) return null

  return (
    <>
      {lists.map(list => {
        const key = listKey(date, list.hospital, list.theatre)
        const order = runningOrder(recorded[key], list.cases)
        return (
          <ListCard key={key} list={list} order={order}
            onEdit={() => setEditing({ list, order })} />
        )
      })}

      {editing && (
        <EditList
          list={editing.list}
          order={editing.order}
          date={date}
          user={user}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }} />
      )}
    </>
  )
}
