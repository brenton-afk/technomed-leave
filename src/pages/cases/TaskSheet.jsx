import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'

// ─── One task, opened ────────────────────────────────────────────────────────
// "I need to click and then be able to interact and tell the portal I have
// completed." A tap used to tick the task on the spot, with nothing to say it
// had — so it read as a row that did nothing, and a stray tap ticked a job
// nobody had done. Now a tap opens it: what it is, who it is for, who added
// it, and one clear button.

function shortDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' })
}

export default function TaskSheet({ task, onClose, onDone, kind = 'Task' }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const done = Boolean(task.done)

  async function toggle() {
    setBusy(true); setError('')
    try {
      const data = await onDone(task, !done)
      if (!data) throw new Error('Not saved — check your connection and try again')
      setResult({ done: !done, copies: data.copies || [], projectItems: data.projectItems || [] })
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  const row = (label, value) => value ? (
    <div style={{ display: 'flex', gap: space.sm, padding: `${space.xs + 2}px 0`, borderBottom: border.hairlineSoft }}>
      <div style={{ ...text('caption'), color: colour.inkFaint, width: 80, flexShrink: 0 }}>{label}</div>
      <div style={{ ...text('body'), color: colour.ink }}>{value}</div>
    </div>
  ) : null

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label={task.what} className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 480, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1, ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint }}>{kind}{task.date ? ` · due ${shortDate(task.date)}` : ''}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>Close</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            <div style={{ ...text('heading'), color: colour.ink, marginBottom: space.sm,
              ...(done && !result ? { textDecoration: 'line-through', color: colour.inkFaint } : {}) }}>{task.what}</div>
            {row('For', task.who || 'Anyone')}
            {row('Item', task.thing && task.thing !== task.what ? task.thing : null)}
            {row('From', task.from)}
            {row('To', task.to)}
            {row('Case', task.forCase)}
            {row('Note', task.note)}
            {row('Added by', task.addedBy)}
            {done && !result && row('Done', `${task.doneBy || 'Somebody'}${task.doneOn ? ` on ${task.doneOn}` : ''}`
              + (task.doneElsewhere ? ` (ticked on ${shortDate(task.doneElsewhere)})` : ''))}

            {result && (
              <div role="status" style={{ ...text('body'), marginTop: space.md, padding: space.md, borderRadius: radius.control,
                background: result.done ? colour.successSoft : colour.surface, border: border.hairline, color: colour.ink }}>
                <strong>{result.done ? 'Done — thanks. It stays on the day, ticked.' : 'Back on the list.'}</strong>
                {result.copies.length > 0 && (
                  <div style={{ ...text('caption'), marginTop: 4 }}>
                    The same task on the calendar for {result.copies.map(shortDate).join(', ')} {result.done ? 'is ticked off too' : 'is back on too'}.
                  </div>
                )}
                {result.projectItems.length > 0 && (
                  <div style={{ ...text('caption'), marginTop: 4 }}>
                    Project list {result.done ? 'updated' : 'reopened'}: {result.projectItems.join('; ')}.
                  </div>
                )}
              </div>
            )}
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}
          </div>

          <div style={{ padding: space.md, borderTop: border.hairline, display: 'grid', gap: space.sm }}>
            {!result && (
              <button disabled={busy} onClick={toggle} style={{
                ...text('bodyStrong'), padding: space.md, borderRadius: radius.control, cursor: 'pointer',
                border: done ? border.hairline : 'none', background: done ? colour.surface : colour.accent,
                color: done ? colour.ink : 'white', opacity: busy ? 0.6 : 1
              }}>
                {busy ? 'Saving…' : done ? 'Not done — put it back on the list' : 'Mark as done'}
              </button>
            )}
            {result && (
              <button onClick={onClose} style={{ ...text('bodyStrong'), padding: space.md, borderRadius: radius.control, cursor: 'pointer',
                border: 'none', background: colour.accent, color: 'white' }}>Close</button>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
