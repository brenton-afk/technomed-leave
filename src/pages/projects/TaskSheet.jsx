import React, { useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { columnOf } from '../../projects/model.js'
import { STAFF } from '../../staffConfig.js'
import { PRIORITY_LABELS, formatDate, tintOf } from './shared.js'

// ─── One task, opened ────────────────────────────────────────────────────────
// Two things live here that the card deliberately does not show.
//
// ── The thread ──
//
// "Comments and updates against a task — 'rang them, waiting on a date' — so
// the history lives with the work instead of in WhatsApp."
//
// Append-only, and shown oldest first. The value of a line like that is that it
// was written on the day and has not been tidied since; a thread you can edit
// is a thread nobody can rely on, and one that reads newest-first turns a
// sequence of events into a pile.
//
// ── Archive rather than delete ──
//
// The ✕ really deleted, which was wrong for a board that is meant to be the
// record. Erin keeping track of what has been completed needs the completed
// things to still exist, and somebody who puts the wrong task away at eleven at
// night needs it back in the morning. Delete is still here, behind a second
// tap, because occasionally a thing really is a mistake.

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: space.md }}>
      <span style={{
        ...text('micro'), color: colour.inkFaint, display: 'block', marginBottom: 4
      }}>{label}</span>
      {children}
    </label>
  )
}

const control = {
  width: '100%', boxSizing: 'border-box', padding: `${space.sm}px ${space.md}px`,
  border: `1px solid ${colour.line}`, borderRadius: radius.control
}

export default function TaskSheet({
  task, project, projects, busy, onChange, onComment, onArchive, onDelete, onClose
}) {
  const [update, setUpdate] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const thread = Array.isArray(task.comments) ? task.comments : []
  const tint = tintOf(project.colour)

  const send = () => {
    if (!update.trim()) return
    onComment(task, update.trim())
    setUpdate('')
  }

  return (
    <div role="dialog" aria-label={`Task: ${task.task}`}
      style={{
        background: colour.surface, borderRadius: radius.sheet,
        border: `1px solid ${colour.line}`, overflow: 'hidden'
      }}>
      <div style={{
        background: tint.wash, padding: `${space.md}px ${space.lg}px`,
        display: 'flex', alignItems: 'flex-start', gap: space.sm
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...text('micro'), color: tint.ink }}>{project.name}</div>
          <div style={{ ...text('heading'), color: colour.ink, marginTop: 2 }}>
            {task.task}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close this task"
          style={{
            ...text('body'), background: 'none', border: 'none',
            color: colour.inkFaint, cursor: 'pointer', padding: 0
          }}>✕</button>
      </div>

      <div style={{ padding: space.lg }}>
        <Field label="What it is">
          <input
            defaultValue={task.task}
            onBlur={e => {
              const next = e.target.value.trim()
              if (next && next !== task.task) onChange(task, { task: next })
            }}
            style={{ ...text('field'), ...control }} />
        </Field>

        <div style={{ display: 'flex', gap: space.sm }}>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <Field label="Who has it">
              <select value={task.assignee || 'Unassigned'}
                onChange={e => onChange(task, { assignee: e.target.value })}
                style={{ ...text('field'), ...control }}>
                <option value="Unassigned">Unassigned</option>
                {STAFF.map(p => <option key={p.email} value={p.name}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <Field label="Due">
              <input type="date" value={task.due_date || ''}
                onChange={e => onChange(task, { due_date: e.target.value })}
                style={{ ...text('field'), ...control }} />
            </Field>
          </div>
        </div>

        <div style={{ display: 'flex', gap: space.sm }}>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <Field label="Column">
              <select value={columnOf(task, project)}
                onChange={e => onChange(task, { column: e.target.value })}
                style={{ ...text('field'), ...control }}>
                {project.columns.map(c =>
                  <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <Field label="Priority">
              <select value={task.priority || 'normal'}
                onChange={e => onChange(task, { priority: e.target.value })}
                style={{ ...text('field'), ...control }}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) =>
                  <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <Field label="Project">
          <select value={project.id}
            onChange={e => onChange(task, { projectId: e.target.value })}
            style={{ ...text('field'), ...control }}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        {/* Where it came from, if anywhere. Kept because "we agreed this at the
            spine meeting on the 28th" is most of what makes a task credible a
            month later. */}
        {task.sourceMeetingTitle && (
          <div style={{ ...text('caption'), color: colour.inkFainter, marginBottom: space.md }}>
            From {task.sourceMeetingTitle} · {formatDate(task.sourceMeetingDate)}
          </div>
        )}

        {/* ── The thread ── */}
        <div style={{
          borderTop: `1px solid ${colour.line}`, paddingTop: space.md, marginTop: space.xs
        }}>
          <div style={{ ...text('micro'), color: colour.inkFaint, marginBottom: space.sm }}>
            Updates
          </div>

          {thread.length === 0 && (
            <div style={{ ...text('caption'), color: colour.inkFainter, marginBottom: space.sm }}>
              Nothing yet. Put what happened here and it stays with the task.
            </div>
          )}

          {thread.map(c => (
            <div key={c.id} style={{
              background: colour.canvas, borderRadius: radius.control,
              padding: `${space.sm}px ${space.md}px`, marginBottom: 6
            }}>
              <div style={{ ...text('body'), color: colour.ink }}>{c.text}</div>
              <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: 2 }}>
                {c.by || 'Someone'}{c.at ? ` · ${formatDate(String(c.at).slice(0, 10))}` : ''}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm }}>
            <input
              value={update}
              onChange={e => setUpdate(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send() }}
              placeholder="Rang them, waiting on a date…"
              style={{ ...text('field'), ...control, flex: 1, minWidth: 0 }} />
            <button type="button" onClick={send} disabled={!update.trim() || busy}
              style={{
                ...text('bodyStrong'), flexShrink: 0, padding: `0 ${space.lg}px`,
                minHeight: 40, border: 'none', borderRadius: radius.control,
                background: update.trim() ? colour.accent : colour.line,
                color: update.trim() ? 'white' : colour.inkFainter,
                cursor: update.trim() ? 'pointer' : 'default'
              }}>Add</button>
          </div>
        </div>

        {/* ── Putting it away ── */}
        <div style={{
          display: 'flex', gap: space.sm, marginTop: space.lg,
          borderTop: `1px solid ${colour.line}`, paddingTop: space.md
        }}>
          <button type="button" onClick={() => onArchive(task, !task.archived)}
            style={{
              ...text('bodyStrong'), flex: 1, minHeight: 42,
              border: `1px solid ${colour.line}`, borderRadius: radius.control,
              background: colour.surface, color: colour.inkMuted, cursor: 'pointer'
            }}>
            {task.archived ? 'Bring it back' : 'Archive'}
          </button>
          <button type="button"
            onClick={() => confirmingDelete ? onDelete(task) : setConfirmingDelete(true)}
            style={{
              ...text('bodyStrong'), flexShrink: 0, minHeight: 42,
              padding: `0 ${space.lg}px`,
              border: `1px solid ${confirmingDelete ? colour.danger : colour.line}`,
              borderRadius: radius.control, background: colour.surface,
              color: confirmingDelete ? colour.danger : colour.inkFainter,
              cursor: 'pointer'
            }}>
            {confirmingDelete ? 'Delete for good' : 'Delete'}
          </button>
        </div>
        {confirmingDelete && (
          <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 6 }}>
            Archiving keeps it and takes it off the board. Deleting cannot be undone.
          </div>
        )}
      </div>
    </div>
  )
}
