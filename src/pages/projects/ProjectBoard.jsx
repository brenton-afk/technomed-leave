import React, { useState, useMemo } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { columnOf, progressOf, tasksOf, commentCount } from '../../projects/model.js'
import { STAFF } from '../../staffConfig.js'
import {
  tintOf, PRIORITY_COLOURS, dueState, DUE_TONES, updatesLabel, formatShort
} from './shared.js'

// ─── One project's board ─────────────────────────────────────────────────────
// "We want it similar to monday.com as a true project page."
//
// ── Why the phone shows one column at a time ──
//
// monday.com puts the columns side by side, which is right on a laptop and
// unusable on a phone: six columns across 390 points is six slivers, and the
// thing people actually do — look at what is in one state — needs horizontal
// scrolling to do at all. So the phone gets the columns as a row of chips with
// their counts, and the one you tap fills the screen. The desktop gets them
// side by side, which is what the width is for.
//
// Same board, same data, same order. The difference is how much glass there is,
// which is the rule the case views already follow.
//
// ── Why tasks move by arrow and not only by dragging ──
//
// Dragging on a phone fights with scrolling and loses, and a task that will not
// drop is a task somebody gives up on. The ‹ › arrows on every card work the
// same everywhere and are the only way that works one-handed in a corridor.
// Dragging is on top of that on the desktop, not instead of it.

function Progress({ fraction, tint }) {
  return (
    <div style={{
      height: 6, borderRadius: radius.pill, background: tint.wash, overflow: 'hidden'
    }}>
      <div style={{
        width: `${Math.round(fraction * 100)}%`, height: '100%',
        background: tint.solid, borderRadius: radius.pill,
        transition: 'width 200ms'
      }} />
    </div>
  )
}

function Chip({ on, children, onClick, tint, title }) {
  return (
    <button type="button" onClick={onClick} title={title}
      style={{
        ...text('caption'), fontWeight: 700, whiteSpace: 'nowrap',
        padding: '6px 11px', borderRadius: radius.pill, cursor: 'pointer',
        border: on ? 'none' : `1px solid ${colour.line}`,
        background: on ? tint.solid : colour.surface,
        color: on ? 'white' : colour.inkFaint
      }}>
      {children}
    </button>
  )
}

/**
 * One task, as it appears on the board.
 *
 * The order is Brent's for the case cards and holds here for the same reason:
 * what the job is, then who has it, then when, then the trail. The arrows are
 * last and deliberately quiet — they are used often but read never.
 */
function TaskCard({ task, project, column, onOpen, onMove, dragging, onDragStart, onDragEnd }) {
  const columns = project.columns
  const at = columns.findIndex(c => c.key === column)
  const tint = tintOf(project.colour)
  const due = dueState(task.due_date, dragging?.today)
  const updates = commentCount(task)

  return (
    <div
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        background: colour.surface, borderRadius: radius.control,
        border: `1px solid ${colour.line}`,
        borderLeft: `3px solid ${PRIORITY_COLOURS[task.priority] || colour.inkFainter}`,
        marginBottom: space.sm, overflow: 'hidden',
        opacity: dragging?.id === task.id ? 0.4 : 1
      }}>
      <button type="button" onClick={() => onOpen(task)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', border: 'none',
          background: 'none', padding: `${space.sm}px ${space.md}px 6px`, cursor: 'pointer'
        }}>
        <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>
          {task.task}
        </span>
        <span style={{
          ...text('caption'), color: colour.inkFaint, display: 'block', marginTop: 2
        }}>
          {task.assignee || 'Unassigned'}
        </span>
        {(due || updates > 0) && (
          <span style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
            {due && (
              <span style={{
                ...text('micro'), textTransform: 'none', letterSpacing: 0,
                padding: '2px 7px', borderRadius: radius.pill,
                color: DUE_TONES[due.tone].colour,
                background: DUE_TONES[due.tone].background,
                border: due.tone === 'calm' ? `1px solid ${colour.line}` : 'none'
              }}>{due.label}</span>
            )}
            {updates > 0 && (
              <span style={{
                ...text('micro'), textTransform: 'none', letterSpacing: 0,
                padding: '2px 7px', borderRadius: radius.pill,
                color: colour.inkFaint, border: `1px solid ${colour.line}`
              }}>{updatesLabel(updates)}</span>
            )}
          </span>
        )}
      </button>

      {/* The one-handed move. Quiet, because they are pressed often and read
          never, and disabled rather than hidden at each end so the row does
          not change width as a task travels across the board. */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 2,
        padding: `0 ${space.sm}px 6px`
      }}>
        {[[-1, '‹', 'back'], [1, '›', 'on']].map(([by, glyph, way]) => {
          const to = columns[at + by]
          return (
            <button key={way} type="button"
              disabled={!to}
              onClick={() => to && onMove(task, to.key)}
              aria-label={to ? `Move ${task.task} ${way} to ${to.label}` : `No column ${way}`}
              style={{
                ...text('caption'), fontWeight: 700, minWidth: 30, minHeight: 28,
                border: `1px solid ${to ? colour.line : 'transparent'}`,
                borderRadius: radius.control, background: 'none',
                color: to ? colour.inkFaint : colour.lineSoft,
                cursor: to ? 'pointer' : 'default'
              }}>{glyph}</button>
          )
        })}
      </div>
    </div>
  )
}

/** One column, with whatever is in it. */
function Column({
  column, project, tasks, onOpen, onMove, wide, dragging,
  setDragging, onRename, onRemove, today
}) {
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(column.label)
  const tint = tintOf(project.colour)

  const drop = e => {
    e.preventDefault()
    if (dragging?.id) onMove({ id: dragging.id, task: dragging.task }, column.key)
    setDragging(null)
  }

  return (
    <div
      onDragOver={e => { if (dragging) e.preventDefault() }}
      onDrop={drop}
      data-column={column.key}
      style={{
        background: wide ? colour.canvas : 'transparent',
        borderRadius: radius.card,
        padding: wide ? space.sm : 0,
        minWidth: 0,
        ...(wide ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : {})
      }}>

      {wide && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: `2px ${space.xs}px ${space.sm}px`
        }}>
          {renaming ? (
            <input
              autoFocus
              value={label}
              onChange={e => setLabel(e.target.value)}
              onBlur={() => { setRenaming(false); onRename(column.key, label) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { setRenaming(false); onRename(column.key, label) }
                if (e.key === 'Escape') { setRenaming(false); setLabel(column.label) }
              }}
              style={{
                ...text('field'), flex: 1, minWidth: 0, padding: '2px 6px',
                border: `1px solid ${colour.line}`, borderRadius: 6
              }} />
          ) : (
            <button type="button" onClick={() => project.fixed ? null : setRenaming(true)}
              title={project.fixed ? '' : 'Rename this column'}
              style={{
                ...text('micro'), color: tint.ink, background: 'none', border: 'none',
                padding: 0, cursor: project.fixed ? 'default' : 'pointer'
              }}>{column.label}</button>
          )}
          <span style={{ ...text('caption'), color: colour.inkFainter, marginLeft: 'auto' }}>
            {tasks.length}
          </span>
          {!project.fixed && !renaming && (
            <button type="button" onClick={() => onRemove(column.key)}
              aria-label={`Remove the ${column.label} column`}
              style={{
                ...text('caption'), background: 'none', border: 'none',
                color: colour.inkFainter, cursor: 'pointer', padding: '0 2px'
              }}>✕</button>
          )}
        </div>
      )}

      {tasks.length === 0 ? (
        <div style={{
          ...text('caption'), color: colour.inkFainter, textAlign: 'center',
          padding: `${space.lg}px 0`,
          border: `1px dashed ${colour.line}`, borderRadius: radius.control
        }}>
          Nothing here
        </div>
      ) : tasks.map(t => (
        <TaskCard key={t.id} task={t} project={project} column={column.key}
          onOpen={onOpen} onMove={onMove}
          dragging={{ ...dragging, today }}
          onDragStart={wide ? () => setDragging({ id: t.id, task: t }) : undefined}
          onDragEnd={wide ? () => setDragging(null) : undefined} />
      ))}
    </div>
  )
}

export default function ProjectBoard({
  project, items, wide, today, onOpen, onMove, onRenameColumn,
  onAddColumn, onRemoveColumn
}) {
  const mine = useMemo(() => tasksOf(project.id, items), [project.id, items])
  const [showing, setShowing] = useState(project.columns[0]?.key)
  const [dragging, setDragging] = useState(null)
  const [adding, setAdding] = useState('')

  const tint = tintOf(project.colour)
  const progress = progressOf(project, items)

  const inColumn = key => mine.filter(t => columnOf(t, project) === key)
  // A column removed while it was on screen leaves `showing` pointing at
  // nothing, which would draw an empty board and look like lost work.
  const open = project.columns.find(c => c.key === showing) || project.columns[0]

  return (
    <div>
      {/* How far through, which is the question a project page exists to
          answer and the one the old flat list could not. */}
      <div style={{ marginBottom: space.md }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: space.sm, marginBottom: 6
        }}>
          <span style={{ ...text('caption'), color: colour.inkFaint }}>
            {progress.done} of {progress.total} done
          </span>
          {project.due && (
            <span style={{ ...text('caption'), color: colour.inkFainter, marginLeft: 'auto' }}>
              Due {formatShort(project.due)}
            </span>
          )}
        </div>
        <Progress fraction={progress.fraction} tint={tint} />
      </div>

      {/* The phone picks a column; the desktop shows them all. */}
      {!wide && (
        <div style={{
          display: 'flex', gap: 6, marginBottom: space.md,
          overflowX: 'auto', paddingBottom: 2
        }}>
          {project.columns.map(c => (
            <Chip key={c.key} tint={tint} on={c.key === open.key}
              onClick={() => setShowing(c.key)}>
              {/* One string, not two nodes. Split across elements it is
                  unreadable to anything matching on text — a screen reader
                  included, which announces it as two separate things. */}
              {`${c.label} · ${inColumn(c.key).length}`}
            </Chip>
          ))}
        </div>
      )}

      {wide ? (
        <div style={{ display: 'flex', gap: space.sm, alignItems: 'flex-start' }}>
          {project.columns.map(c => (
            <Column key={c.key} column={c} project={project} tasks={inColumn(c.key)}
              wide today={today}
              onOpen={onOpen} onMove={onMove}
              dragging={dragging} setDragging={setDragging}
              onRename={onRenameColumn} onRemove={onRemoveColumn} />
          ))}
          {!project.fixed && project.columns.length < 8 && (
            <div style={{ flexShrink: 0, width: 150 }}>
              <input
                value={adding}
                onChange={e => setAdding(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && adding.trim()) {
                    onAddColumn(adding.trim()); setAdding('')
                  }
                }}
                placeholder="+ Add a column"
                style={{
                  ...text('field'), width: '100%', boxSizing: 'border-box',
                  padding: `${space.sm}px ${space.md}px`,
                  border: `1px dashed ${colour.line}`, borderRadius: radius.card,
                  background: 'transparent'
                }} />
            </div>
          )}
        </div>
      ) : (
        <Column column={open} project={project} tasks={inColumn(open.key)}
          today={today}
          onOpen={onOpen} onMove={onMove}
          dragging={dragging} setDragging={setDragging}
          onRename={onRenameColumn} onRemove={onRemoveColumn} />
      )}
    </div>
  )
}

export { Progress, TaskCard }

/** The staff list a picker offers, with nobody as a first-class answer. */
export const ASSIGNEES = ['Unassigned', ...STAFF.map(s => s.name)]
