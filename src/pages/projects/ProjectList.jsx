import React, { useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { progressOf, tasksOf, orderedProjects, GENERAL } from '../../projects/model.js'
import { STAFF } from '../../staffConfig.js'
import { tintOf, PROJECT_TINTS, formatShort, dueState, DUE_TONES } from './shared.js'

// ─── Everything that is going on, on one screen ──────────────────────────────
// The question this answers, and the flat list could not: what are we actually
// working on, and how far through is each one.
//
// Ordered by state rather than by name — live work, then what has nothing left
// in it, then what is put away — because a board you have to read in full to
// find the live items is a board that gets read once.

function Bar({ fraction, tint }) {
  return (
    <div style={{
      height: 5, borderRadius: radius.pill, background: colour.lineSoft, overflow: 'hidden'
    }}>
      <div style={{
        width: `${Math.round(fraction * 100)}%`, height: '100%',
        background: tint.solid, borderRadius: radius.pill, transition: 'width 200ms'
      }} />
    </div>
  )
}

function Row({ project, items, today, onOpen }) {
  const tint = tintOf(project.colour)
  const progress = progressOf(project, items)
  const open = tasksOf(project.id, items).filter(t => t.status !== 'done').length
  const due = dueState(project.due, today)

  return (
    <button type="button" onClick={() => onOpen(project)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        background: colour.surface, borderRadius: radius.card,
        border: `1px solid ${colour.line}`,
        borderLeft: `4px solid ${tint.solid}`,
        padding: `${space.md}px ${space.lg}px`, marginBottom: space.sm,
        opacity: project.archived ? 0.6 : 1
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm }}>
        <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0 }}>
          {project.name}
        </span>
        {project.archived && (
          <span style={{ ...text('micro'), color: colour.inkFainter }}>Archived</span>
        )}
        {!project.archived && progress.complete && progress.total > 0 && (
          <span style={{ ...text('micro'), color: tint.solid }}>Done</span>
        )}
      </div>

      <div style={{
        ...text('caption'), color: colour.inkFaint,
        marginTop: 2, marginBottom: 7,
        display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap'
      }}>
        <span>{project.owner === 'Unassigned' ? 'No owner' : project.owner}</span>
        <span style={{ color: colour.lineSoft }}>·</span>
        <span>{open ? `${open} to do` : 'Nothing to do'}</span>
        {due && (
          <span style={{
            ...text('micro'), textTransform: 'none', letterSpacing: 0,
            padding: '1px 7px', borderRadius: radius.pill, marginLeft: 'auto',
            color: DUE_TONES[due.tone].colour,
            background: DUE_TONES[due.tone].background
          }}>{due.label}</span>
        )}
      </div>

      <Bar fraction={progress.fraction} tint={tint} />
      <div style={{ ...text('micro'), color: colour.inkFainter, marginTop: 5 }}>
        {progress.done} / {progress.total}
      </div>
    </button>
  )
}

/** The form for a new project, which is four questions and no more. */
function NewProject({ onCreate, onCancel, busy }) {
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('Unassigned')
  const [due, setDue] = useState('')
  const [tone, setTone] = useState('teal')

  const control = {
    width: '100%', boxSizing: 'border-box', padding: `${space.sm}px ${space.md}px`,
    border: `1px solid ${colour.line}`, borderRadius: radius.control
  }

  return (
    <div style={{
      background: colour.surface, borderRadius: radius.card,
      border: `1px solid ${colour.line}`, padding: space.lg, marginBottom: space.md
    }}>
      <div style={{ ...text('heading'), color: colour.ink, marginBottom: space.md }}>
        New project
      </div>

      <input autoFocus value={name} onChange={e => setName(e.target.value)}
        placeholder="e.g. Globus onboarding"
        onKeyDown={e => {
          if (e.key === 'Enter' && name.trim()) onCreate({ name, owner, due, colour: tone })
        }}
        style={{ ...text('field'), ...control, marginBottom: space.sm }} />

      <div style={{ display: 'flex', gap: space.sm, marginBottom: space.md }}>
        <select value={owner} onChange={e => setOwner(e.target.value)}
          aria-label="Who owns it"
          style={{ ...text('field'), ...control, flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
          <option value="Unassigned">No owner</option>
          {STAFF.map(p => <option key={p.email} value={p.name}>{p.name}</option>)}
        </select>
        <input type="date" value={due} onChange={e => setDue(e.target.value)}
          aria-label="Due by"
          style={{ ...text('field'), ...control, flexShrink: 0, width: 'auto' }} />
      </div>

      {/* Six colours, not a picker. "The teal one" has to mean something to
          everybody, and a free picker produces nine shades of blue. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: space.lg }}>
        {Object.keys(PROJECT_TINTS).map(key => (
          <button key={key} type="button" onClick={() => setTone(key)}
            aria-label={`${key} colour`}
            aria-pressed={tone === key}
            style={{
              width: 30, height: 30, borderRadius: radius.pill, cursor: 'pointer',
              background: PROJECT_TINTS[key].solid,
              border: tone === key ? `3px solid ${colour.ink}` : '3px solid transparent'
            }} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: space.sm }}>
        <button type="button" onClick={onCancel}
          style={{
            ...text('bodyStrong'), flexShrink: 0, minHeight: 42, padding: `0 ${space.lg}px`,
            border: `1px solid ${colour.line}`, borderRadius: radius.control,
            background: colour.surface, color: colour.inkMuted, cursor: 'pointer'
          }}>Cancel</button>
        <button type="button" disabled={!name.trim() || busy}
          onClick={() => onCreate({ name, owner, due, colour: tone })}
          style={{
            ...text('bodyStrong'), flex: 1, minHeight: 42, border: 'none',
            borderRadius: radius.control,
            background: name.trim() ? colour.accent : colour.line,
            color: name.trim() ? 'white' : colour.inkFainter,
            cursor: name.trim() ? 'pointer' : 'default'
          }}>{busy ? 'Creating…' : 'Create it'}</button>
      </div>
    </div>
  )
}

export default function ProjectList({
  projects, items, today, onOpen, onCreate, busy, showArchived, onToggleArchived
}) {
  const [making, setMaking] = useState(false)
  // General always appears, and always last among the live ones. It is where
  // everything written before projects existed lives, so a board without it
  // would look empty to anybody who had been using the old list.
  const all = orderedProjects([...projects, GENERAL], items)
  const visible = showArchived ? all : all.filter(p => !p.archived)
  const archivedCount = all.filter(p => p.archived).length

  return (
    <div>
      {making ? (
        <NewProject busy={busy} onCancel={() => setMaking(false)}
          onCreate={fields => { onCreate(fields); setMaking(false) }} />
      ) : (
        <button type="button" onClick={() => setMaking(true)}
          style={{
            ...text('bodyStrong'), width: '100%', minHeight: 44,
            marginBottom: space.md, cursor: 'pointer',
            border: `1px dashed ${colour.line}`, borderRadius: radius.card,
            background: colour.surface, color: colour.inkMuted
          }}>+ New project</button>
      )}

      {visible.map(p => (
        <Row key={p.id} project={p} items={items} today={today} onOpen={onOpen} />
      ))}

      {archivedCount > 0 && (
        <button type="button" onClick={onToggleArchived}
          style={{
            ...text('caption'), width: '100%', padding: space.md, cursor: 'pointer',
            background: 'none', border: 'none', color: colour.inkFaint
          }}>
          {showArchived
            ? 'Hide archived'
            : `Show ${archivedCount} archived project${archivedCount === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}
