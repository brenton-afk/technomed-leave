import React from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { commentCount } from '../../projects/model.js'
import { formatShort } from './shared.js'

// ─── Your to-do list, on the phone (Brent, 6 Nov 2026) ───────────────────────
// "The best way for this to function would be to produce a daily to do list
// for each staff member, so that they can just open the projects page and
// 'Ben's To Do list' with check boxes is there ready to go for them to tick
// off." Approved from the mock-up (Phone 1).
//
// Your open tasks, by when they are due — Overdue, Today, This week, Later,
// No date — then what you ticked today. A to-do is the same task as on the
// desktop table: ticking it here moves it to its board's done column there.
// Tapping one opens the task sheet, which is where its notes and comments are;
// discussion of a whole project stays on the project, not on this list.

const DAY = 86400000
const daysFrom = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

/** Your tasks in the sections the list shows, in order. Pure, so it is tested directly. */
export function toDoSections(tasks, today) {
  const open = tasks.filter(t => t.status !== 'done')
  const byDue = (a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))
  const sections = [
    ['overdue', 'Overdue', open.filter(t => t.due_date && t.due_date < today)],
    ['today', 'Today', open.filter(t => t.due_date === today)],
    ['week', 'This week', open.filter(t => t.due_date > today && daysFrom(today, t.due_date) <= 7)],
    ['later', 'Later', open.filter(t => t.due_date && daysFrom(today, t.due_date) > 7)],
    ['undated', 'No date', open.filter(t => !t.due_date)],
    ['done', 'Done today', tasks.filter(t => t.status === 'done' && String(t.doneAt || '').slice(0, 10) === today)]
  ]
  return sections
    .map(([key, label, list]) => ({ key, label, tasks: [...list].sort(byDue) }))
    .filter(s => s.tasks.length)
}

/** Today's tally for the ring: what was due by today, and how much of it is done. */
export function todayTally(sections) {
  const count = key => sections.find(s => s.key === key)?.tasks.length || 0
  const done = count('done')
  return { done, total: done + count('overdue') + count('today') }
}

function Ring({ done, total }) {
  const size = 56
  const r = 22
  const c = 2 * Math.PI * r
  const fraction = total ? done / total : 0
  return (
    <span role="img" aria-label={`${done} of ${total} done today`} style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour.lineSoft} strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour.accent} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${c * fraction} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span style={{ ...text('caption'), fontWeight: 700, color: colour.ink, position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {done}/{total}
      </span>
    </span>
  )
}

export default function MyToDo({ name, tasks, today, projectFor, tintFor, onTick, onOpenTask, quickAdd }) {
  const sections = toDoSections(tasks, today)
  const { done, total } = todayTally(sections)
  const left = total - done
  const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${today}T00:00:00Z`))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.md, marginBottom: space.md }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ ...text('title'), margin: 0, color: colour.ink }}>{name ? `${name}'s To Do` : 'My To Do'}</h2>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            {weekday} · {left ? `${left} left today` : total ? 'all done for today' : 'nothing due today'}
          </div>
        </div>
        <Ring done={done} total={total} />
      </div>

      {sections.length === 0 && (
        <div style={{ ...text('body'), color: colour.inkFaint, textAlign: 'center', padding: space.xl, background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card }}>
          Nothing on your list. Add one below.
        </div>
      )}

      {sections.map(section => (
        <section key={section.key} style={{ marginBottom: space.md }}>
          <h3 style={{
            ...text('micro'), textTransform: 'uppercase', margin: `0 0 ${space.xs}px`, padding: `0 ${space.xs}px`,
            color: section.key === 'overdue' ? colour.danger : section.key === 'done' ? colour.accentDeep : colour.inkFaint
          }}>{section.label} · {section.tasks.length}</h3>
          <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, overflow: 'hidden' }}>
            {section.tasks.map(task => {
              const finished = task.status === 'done'
              const project = projectFor(task)
              const notes = commentCount(task)
              const late = section.key === 'overdue'
              return (
                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: space.xs, minHeight: 58, padding: `0 ${space.sm}px 0 2px`, borderBottom: `1px solid ${colour.lineSoft}` }}>
                  <button type="button" onClick={() => onTick(task)} aria-pressed={finished}
                    aria-label={finished ? `Not done: ${task.task}` : `Done: ${task.task}`}
                    style={{ width: 44, height: 44, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                    <span aria-hidden="true" style={{
                      width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center',
                      border: `2px solid ${finished ? colour.accent : colour.inkFainter}`,
                      background: finished ? colour.accent : colour.surface, color: 'white', ...text('bodyStrong')
                    }}>{finished ? '✓' : ''}</span>
                  </button>
                  <button type="button" onClick={() => onOpenTask(task)}
                    style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: `${space.sm}px 0`, cursor: 'pointer' }}>
                    <span style={{
                      ...text('bodyStrong'), display: 'block', overflowWrap: 'anywhere',
                      color: finished ? colour.inkFainter : colour.ink, textDecoration: finished ? 'line-through' : 'none'
                    }}>{task.task}</span>
                    <span style={{ ...text('caption'), color: colour.inkFaint, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: tintFor(project).solid }} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</span>
                      {task.due_date && (
                        <span style={{ color: late ? colour.danger : colour.inkFaint, fontWeight: late ? 700 : 400, whiteSpace: 'nowrap' }}>
                          · {task.due_date === today ? 'Today' : formatShort(task.due_date)}
                        </span>
                      )}
                    </span>
                  </button>
                  {notes > 0 && (
                    <span aria-label={`${notes} ${notes === 1 ? 'note' : 'notes'}`} style={{ ...text('caption'), color: colour.inkFaint, display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
                      {notes}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {quickAdd}
    </div>
  )
}
