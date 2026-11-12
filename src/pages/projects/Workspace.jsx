import { byDistributor, distributorsIn, DISTRIBUTORS, NO_DISTRIBUTOR } from '../../projects/distributors.js'
import React, { useMemo, useState } from 'react'
import { colour, text, space, radius, face } from '../../design/tokens.js'
import { STAFF, isSameStaff } from '../../staffConfig.js'
import {
  GENERAL, DIVISIONS, divisionOf, projectIdOf, columnOf, progressOf, tasksOf, orderedProjects
} from '../../projects/model.js'
import { tintOf, dueState, DUE_TONES, formatShort, PROJECT_TINTS } from './shared.js'
import { NewProject } from './ProjectList.jsx'
import MyToDo from './MyToDo.jsx'
import VoiceTask from './VoiceTask.jsx'
import { commentCount } from '../../projects/model.js'

// ─── Projects, as one workspace (Brent, 4 Nov 2026) ──────────────────────────
// "Make the projects page better, more interactive, more appealing to look
// at, a better layout that you can see more on, easier to differentiate your
// tasks vs other people's tasks, maybe have different divisions of the
// business listed." Built from the mock-up Brent approved ("go with your
// suggestions"): projects belong to a division, and it opens on List.
//
// One screen instead of Projects / Mine tabs:
//   - four numbers that are also filters (mine, overdue, this week, unassigned)
//   - division chips, and "only my tasks"
//   - a project rail with progress (left on a laptop, a strip on a phone)
//   - three readings of the same tasks: List (by project), Board (by state),
//     People (each person's load)
// Your own rows carry a teal edge and "You"; everybody else's carry their
// initials in their division's colour.
//
// Every tap still lands where it did: a task opens the task sheet, a project
// opens its own board with its own columns.

/** A division's colour, from the project palette — never a new hue. */
export const DIVISION_TINT = {
  Operations: PROJECT_TINTS.navy,
  Spine: PROJECT_TINTS.teal,
  Orthopaedics: PROJECT_TINTS.plum,
  CMF: PROJECT_TINTS.clay
}
const tintOfDivision = d => DIVISION_TINT[d] || PROJECT_TINTS.slate

const PREFS_KEY = 'tm_projects_view'
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {} } catch { return {} }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* private mode */ }
}

const staffFor = name => STAFF.find(s => s.name === name)
const firstOf = name => staffFor(name)?.firstName || String(name || '').split(' ')[0]

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

/** Initials in the person's division colour; "You" filled in teal. */
export function Avatar({ name, mine, size = 26 }) {
  const unassigned = !name || name === 'Unassigned'
  const tint = tintOfDivision(staffFor(name)?.division)
  const label = mine ? 'You' : unassigned ? '?' : firstOf(name).slice(0, 2)
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, flexShrink: 0, borderRadius: radius.pill,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      ...text('micro'), letterSpacing: 0, textTransform: 'none',
      border: `2px solid ${mine ? colour.accent : unassigned ? colour.line : tint.solid}`,
      background: mine ? colour.accent : colour.surface,
      color: mine ? 'white' : unassigned ? colour.inkFainter : tint.ink
    }}>{label}</span>
  )
}

/** A progress ring for the rail. */
function Ring({ fraction, tint, size = 30 }) {
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour.lineSoft} strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tint} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${c * fraction} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

const STATE_STYLE = {
  open: { background: colour.lineSoft, color: colour.inkMuted },
  in_progress: { background: PROJECT_TINTS.navy.wash, color: PROJECT_TINTS.navy.ink },
  done: { background: colour.accentSoft, color: colour.accentDeep }
}

// The desktop table's status cell — the whole cell in the state's colour, as a
// status column reads on monday.com (Brent approved Desktop A, 6 Nov 2026).
const STATE_CELL = {
  open: { background: colour.lineSoft, color: colour.inkMuted },
  in_progress: { background: colour.warning, color: 'white' },
  done: { background: colour.accent, color: 'white' }
}
const TABLE_COLUMNS = '28px minmax(0, 1fr) 150px 150px 120px 90px 64px'

export default function Workspace({
  projects = [], items = [], user, today, wide,
  onOpenProject, onOpenTask, onMove, onCreateProject, busyProject, onAdd, adding, canPrivate,
  // Given by Projects.jsx, whose one row of tabs chooses it on a phone.
  phoneTab: phoneTabGiven
}) {
  const me = STAFF.find(p => p.email === user?.email)
  const isMine = task => (me ? isSameStaff(task.assignee, me) : task.assignee === user?.name)

  const saved = useMemo(loadPrefs, [])
  const [view, setViewRaw] = useState(saved.view || 'list')
  // The table grouped by project, or by distributor from what each task names
  // (Brent, 11 Nov 2026 — src/projects/distributors.js).
  const [groupBy, setGroupByRaw] = useState(saved.groupBy || 'project')
  // On a phone the page opens on your own to-do list (Brent, 6 Nov 2026).
  const [phoneTabOwn, setPhoneTabRaw] = useState(saved.phoneTab || 'todo')
  const phoneTab = phoneTabGiven || phoneTabOwn
  // A phone's filters stay folded until asked for (Brent, 6 Nov 2026: "way too busy").
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [division, setDivisionRaw] = useState(saved.division || 'All')
  const [onlyMine, setOnlyMineRaw] = useState(Boolean(saved.onlyMine))
  // Brent, 12 Nov 2026: "filter the projects page by staff member as well as distributor".
  const [person, setPersonRaw] = useState(saved.person || '')
  const [dist, setDistRaw] = useState(saved.dist || '')
  const [showDone, setShowDone] = useState(false)
  // A task ticked here stays on screen, struck through, until the page is
  // left (Brent, 12 Nov 2026: "the item seems to disappear?!") — so a tap that
  // was a mistake can be seen and undone with another tap.
  const [justTicked, setJustTicked] = useState(() => new Set())
  const [stat, setStat] = useState('')
  const [projectId, setProjectId] = useState('')
  const [making, setMaking] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftWho, setDraftWho] = useState('')
  const [draftDue, setDraftDue] = useState('')
  const [heard, setHeard] = useState('')

  /** A to-do said aloud fills the box, who and when; Add still confirms it. */
  const fromVoice = ({ task, assignee, due, transcript }) => {
    setDraft(task)
    setDraftWho(!assignee || assignee === 'Unassigned' || (me && assignee === me.name) ? '' : assignee)
    setDraftDue(due || '')
    setHeard(transcript)
  }

  const remember = patch => savePrefs({ view, division, onlyMine, phoneTab, groupBy, person, dist, ...patch })
  const setGroupBy = v => { setGroupByRaw(v); remember({ groupBy: v }) }
  const setPhoneTab = v => { setPhoneTabRaw(v); remember({ phoneTab: v }) }
  const setView = v => { setViewRaw(v); remember({ view: v }) }
  const setDivision = d => { setDivisionRaw(d); setProjectId(''); remember({ division: d }) }
  const setOnlyMine = v => { setOnlyMineRaw(v); remember({ onlyMine: v }) }
  const setPerson = v => { setPersonRaw(v); remember({ person: v }) }
  const setDist = v => { setDistRaw(v); remember({ dist: v }) }
  /** Whose task: a staff name, or 'Unassigned'. */
  const forPerson = t => !person || (person === 'Unassigned'
    ? (!t.assignee || t.assignee === 'Unassigned')
    : String(t.assignee || '').toLowerCase() === person.toLowerCase())
  /** Which distributor: any one the task names (a task naming two shows under both). */
  const forDist = t => {
    if (!dist) return true
    const named = distributorsIn(t.task, t.notes)
    return dist === NO_DISTRIBUTOR.key ? named.length === 0 : named.some(d => d.key === dist)
  }

  const all = useMemo(() => [...projects, GENERAL], [projects])
  const projectFor = task => all.find(p => p.id === projectIdOf(task)) || GENERAL
  const live = items.filter(t => t && !t.archived)
  const divisionFor = task => divisionOf(task, projectFor(task), STAFF)

  const isOverdue = t => t.status !== 'done' && t.due_date && t.due_date < today
  const isThisWeek = t => t.status !== 'done' && t.due_date && t.due_date >= today && daysBetween(today, t.due_date) <= 7
  const isUnassigned = t => t.status !== 'done' && (!t.assignee || t.assignee === 'Unassigned')

  const inDivision = t => division === 'All' || divisionFor(t) === division
  const open = live.filter(t => t.status !== 'done' && inDivision(t))
  const stats = [
    ['mine', open.filter(isMine).length, 'My open tasks', colour.accentDeep],
    ['overdue', open.filter(isOverdue).length, 'Overdue', colour.danger],
    ['week', open.filter(isThisWeek).length, 'Due in the next 7 days', colour.warning],
    ['unassigned', open.filter(isUnassigned).length, 'Nobody has it yet', colour.inkMuted]
  ]

  const shown = live.filter(t => {
    if (!inDivision(t)) return false
    if (onlyMine && !isMine(t)) return false
    if (!forPerson(t) || !forDist(t)) return false
    if (projectId && projectIdOf(t) !== projectId) return false
    if (stat === 'mine' && !isMine(t)) return false
    if (stat === 'overdue' && !isOverdue(t)) return false
    if (stat === 'week' && !isThisWeek(t)) return false
    if (stat === 'unassigned' && !isUnassigned(t)) return false
    if (stat && t.status === 'done') return false
    return true
  })
  const shownOpen = showDone ? shown : shown.filter(t => t.status !== 'done' || justTicked.has(t.id))

  // Mine first, then the soonest due, then the rest.
  const order = (a, b) =>
    (isMine(b) - isMine(a))
    || ((a.status === 'done') - (b.status === 'done'))
    || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))

  const railProjects = orderedProjects(all, items)
    .filter(p => showArchived || !p.archived)
    .filter(p => division === 'All' || p.division === division || p.fixed
      || tasksOf(p.id, live).some(t => divisionFor(t) === division))
  const archivedCount = all.filter(p => p.archived).length

  const tick = task => {
    if (task.status !== 'done') setJustTicked(s => new Set(s).add(task.id))
    const project = projectFor(task)
    const finished = task.status === 'done'
    onMove(task, finished ? project.columns[0].key
      : (project.columns.find(c => c.done) || project.columns[0]).key)
  }

  /** Tap the state chip: on to the next column of its own board. */
  const advance = task => {
    const project = projectFor(task)
    const cols = project.columns
    const at = cols.findIndex(c => c.key === columnOf(task, project))
    onMove(task, cols[(at + 1) % cols.length].key)
  }

  const stateOf = task => {
    const project = projectFor(task)
    const key = columnOf(task, project)
    const label = project.columns.find(c => c.key === key)?.label || 'Open'
    return { label, tone: task.status === 'done' ? 'done' : task.status === 'in_progress' ? 'in_progress' : 'open' }
  }

  const add = () => {
    let words = draft.trim()
    if (!words || adding) return
    // "@Erin" in the sentence gives it to Erin; otherwise the picker, else you.
    let who = draftWho
    const at = /(^|\s)@([A-Za-z]+)\b/.exec(words)
    if (at) {
      const hit = STAFF.find(s => s.firstName.toLowerCase() === at[2].toLowerCase()
        || (s.aka || []).some(a => a.toLowerCase() === at[2].toLowerCase()))
      if (hit) { who = hit.name; words = words.replace(at[0], ' ').replace(/\s{2,}/g, ' ').trim() }
    }
    onAdd({
      task: words,
      assignee: who || me?.name || 'Unassigned',
      due_date: draftDue,
      projectId: projectId && projectId !== GENERAL.id ? projectId : ''
    }, () => { setDraft(''); setDraftDue(''); setDraftWho(''); setHeard('') })
  }

  // ── Pieces ──

  const chip = (on, extra = {}) => ({
    ...text('caption'), fontWeight: on ? 700 : 400, minHeight: 34, padding: `0 ${space.md}px`,
    borderRadius: radius.pill, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    ...(on ? face.navy : { ...face.secondary, color: colour.inkMuted }), ...extra
  })

  // The four numbers, small (Brent, 12 Nov 2026: "the massive boxes at the top
  // are unnecessary"). Views down the side on a desktop; chips in the Filter
  // on a phone. Still filters.
  const statTiles = (
    <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginBottom: space.sm }}>
      {stats.map(([key, n, label, tone]) => (
        <button key={key} type="button" aria-pressed={stat === key}
          onClick={() => setStat(stat === key ? '' : key)}
          style={chip(stat === key)}>
          <span style={{ fontWeight: 700, color: stat === key ? 'white' : n ? tone : colour.inkFainter, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  )

  const quickAdd = (
    <div style={{
      display: 'flex', gap: space.xs, flexWrap: 'wrap', alignItems: 'center',
      background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card,
      padding: space.xs, marginBottom: space.md
    }}>
      <VoiceTask user={user} onHeard={fromVoice} />
      <input value={draft} onChange={e => { setDraft(e.target.value); if (!e.target.value) setHeard('') }}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        aria-label="New task"
        placeholder={projectId && projectId !== GENERAL.id
          ? `Add a task to ${all.find(p => p.id === projectId)?.name || 'this project'}…`
          : 'Add a task — “@Erin” gives it to Erin'}
        style={{
          ...text('field'), flex: '1 1 220px', minWidth: 0, border: 'none', outline: 'none',
          padding: `${space.sm}px ${space.sm}px`, background: 'transparent', color: colour.ink
        }} />
      {(wide || draft.trim()) && <>
      <select value={draftWho} onChange={e => setDraftWho(e.target.value)} aria-label="Who has it"
        style={{ ...text('field'), flex: '0 1 150px', minWidth: 0, padding: '6px 8px', border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface }}>
        <option value="">Me</option>
        <option value="Unassigned">Nobody yet</option>
        {STAFF.filter(s => s.email !== me?.email).map(s => <option key={s.email} value={s.name}>{s.firstName}</option>)}
      </select>
      <input type="date" value={draftDue} onChange={e => setDraftDue(e.target.value)} aria-label="Due"
        style={{ ...text('field'), flex: '0 0 auto', padding: '6px 8px', border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface }} />
      <button type="button" onClick={add} disabled={!draft.trim() || adding}
        style={{
          ...text('bodyStrong'), flex: '0 0 auto', minHeight: 40, padding: `0 ${space.lg}px`, border: 'none',
          borderRadius: radius.control, cursor: draft.trim() ? 'pointer' : 'default',
          background: draft.trim() ? colour.accent : colour.line, color: draft.trim() ? 'white' : colour.inkFainter
        }}>{adding ? 'Adding…' : 'Add'}</button>
      </>}
      {heard && draft.trim() && (
        <span data-voice-heard style={{ ...text('caption'), color: colour.inkFaint, flexBasis: '100%', padding: `0 ${space.sm}px ${space.xs}px` }}>
          Heard: “{heard}” — check it, then tap Add.
        </span>
      )}
    </div>
  )

  const select = { ...text('caption'), fontSize: 16, minHeight: 34, padding: '0 8px', border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink }
  const filtering = onlyMine || showDone || stat || person || dist
  const personSelect = (
    <select value={person} onChange={e => setPerson(e.target.value)} aria-label="Staff member" data-filter-person style={select}>
      <option value="">Everyone</option>
      {STAFF.map(p => <option key={p.email} value={p.name}>{p.firstName || p.name}</option>)}
      <option value="Unassigned">Nobody yet</option>
    </select>
  )
  const distSelect = (
    <select value={dist} onChange={e => setDist(e.target.value)} aria-label="Distributor" data-filter-distributor style={select}>
      <option value="">All distributors</option>
      {DISTRIBUTORS.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}
      <option value={NO_DISTRIBUTOR.key}>No distributor</option>
    </select>
  )
  const viewTabs = (
    <div role="tablist" aria-label="View" style={{ display: 'inline-flex', background: colour.lineSoft, borderRadius: radius.control, padding: 3 }}>
      {[['list', 'List'], ...(wide ? [['division', 'By division']] : []), ['board', 'Board'], ['people', 'People']].map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
          style={{
            ...text('caption'), fontWeight: view === key ? 700 : 400, minHeight: 30, padding: `0 ${space.md}px`,
            border: 'none', borderRadius: radius.control - 2, cursor: 'pointer',
            background: view === key ? colour.surface : 'transparent', color: view === key ? colour.ink : colour.inkFaint
          }}>{label}</button>
      ))}
    </div>
  )
  const divisionChips = (
    <div style={{ display: 'flex', gap: space.xs, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 2, marginBottom: space.sm }}>
      {['All', ...DIVISIONS].map(d => (
        <button key={d} type="button" aria-pressed={division === d} onClick={() => setDivision(d)} style={{ ...chip(division === d), flexShrink: 0 }}>
          {d !== 'All' && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: radius.pill, background: tintOfDivision(d).solid }} />}
          {d === 'All' ? 'All divisions' : d}
        </button>
      ))}
    </div>
  )
  const filters = wide ? (
    <div data-toolbar style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', alignItems: 'center', marginBottom: space.md }}>
      <select value={division} onChange={e => setDivision(e.target.value)} aria-label="Division" style={select}>
        <option value="All">All divisions</option>
        {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      {personSelect}
      {distSelect}
      {view === 'list' && (
        <select value={groupBy} onChange={e => setGroupBy(e.target.value)} aria-label="Group by" style={select}>
          <option value="project">Group: Project</option>
          <option value="distributor">Group: Distributor</option>
        </select>
      )}
      {view !== 'board' && (
        <label style={{ ...text('caption'), color: colour.inkMuted, display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ width: 18, height: 18, fontSize: 16 }} />
          Show done
        </label>
      )}
      <span style={{ flex: '1 0 8px' }} />
      {viewTabs}
    </div>
  ) : (
    <div style={{ marginBottom: space.md }}>
      {divisionChips}
      <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(v => !v)} style={chip(filtersOpen || filtering)}>
          Filter{filtering ? ' · on' : ''}
        </button>
        <span style={{ flex: '1 0 8px' }} />
        {viewTabs}
      </div>
      {filtersOpen && (
        <div style={{ marginTop: space.sm }}>
          {statTiles}
          <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginBottom: space.xs }}>{personSelect}{distSelect}</div>
          <label style={{ ...text('caption'), color: colour.inkMuted, display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34, marginRight: space.md }}>
            <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} style={{ width: 18, height: 18, fontSize: 16 }} />
            Only my tasks
          </label>
          {view !== 'board' && (
            <label style={{ ...text('caption'), color: colour.inkMuted, display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34 }}>
              <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ width: 18, height: 18, fontSize: 16 }} />
              Show done
            </label>
          )}
        </div>
      )}
    </div>
  )

  const lateIn = id => tasksOf(id, live).filter(isOverdue).length
  const openIn = id => tasksOf(id, live).filter(t => t.status !== 'done').length

  // ── Desktop: a slim sidebar — views, then projects (Brent, 12 Nov 2026) ──
  const sideBtn = on => ({
    ...text('body'), display: 'flex', alignItems: 'center', gap: space.sm, width: '100%', textAlign: 'left',
    padding: `6px ${space.sm}px`, borderRadius: radius.control, border: 'none', cursor: 'pointer',
    background: on ? colour.lineSoft : 'transparent', color: colour.ink, fontWeight: on ? 700 : 400
  })
  const count = (n, tone) => <span style={{ ...text('caption'), marginLeft: 'auto', color: tone || colour.inkFaint, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
  const sideHead = label => <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFainter, padding: `${space.sm}px ${space.sm}px 2px` }}>{label}</div>

  const rail = (
    <nav aria-label="Projects" style={{ position: 'sticky', top: 72, alignSelf: 'start' }}>
      {sideHead('Views')}
      <button type="button" aria-pressed={!stat && !projectId} onClick={() => { setStat(''); setProjectId('') }} style={sideBtn(!stat && !projectId)}>
        All tasks{count(open.length)}
      </button>
      {stats.map(([key, n, label, tone]) => (
        <button key={key} type="button" aria-pressed={stat === key} onClick={() => setStat(stat === key ? '' : key)} style={sideBtn(stat === key)}>
          {label === 'My open tasks' ? 'Mine' : label === 'Due in the next 7 days' ? 'Due this week' : label === 'Nobody has it yet' ? 'Unassigned' : label}
          {count(n, key === 'overdue' && n ? colour.danger : undefined)}
        </button>
      ))}
      {sideHead('Projects')}
      {railProjects.map(p => {
        const on = projectId === p.id
        const tint = p.division ? tintOfDivision(p.division).solid : tintOf(p.colour).solid
        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center' }}>
            <button type="button" aria-pressed={on} onClick={() => setProjectId(on ? '' : p.id)} title="Show only this project's tasks"
              style={{ ...sideBtn(on), flex: 1, minWidth: 0, opacity: p.archived ? 0.6 : 1 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: radius.pill, background: tint, flexShrink: 0 }} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.private ? '🔒 ' : ''}{p.name}</span>
              {count(openIn(p.id), lateIn(p.id) ? colour.danger : undefined)}
            </button>
            <button type="button" onClick={() => onOpenProject(p)} aria-label={`Open the ${p.name} board`} title="Open its board"
              style={{ ...text('caption'), color: colour.inkFaint, background: 'none', border: 'none', minHeight: 30, padding: `0 6px`, cursor: 'pointer' }}>›</button>
          </div>
        )
      })}
      {making
        ? <div style={{ padding: space.xs }}>
            <NewProject busy={busyProject} division={division === 'All' ? '' : division} canPrivate={canPrivate}
              onCancel={() => setMaking(false)}
              onCreate={fields => { onCreateProject(fields); setMaking(false) }} />
          </div>
        : <button type="button" onClick={() => setMaking(true)} style={{ ...sideBtn(false), color: colour.accentDeep }}>+ New project</button>}
      {archivedCount > 0 && (
        <button type="button" onClick={() => setShowArchived(v => !v)} style={{ ...sideBtn(false), ...text('caption'), color: colour.inkFaint }}>
          {showArchived ? 'Hide archived' : `Show ${archivedCount} archived`}
        </button>
      )}
    </nav>
  )

  // ── Phone: the projects by division, each a row with its ring (mock-up D) ──
  const phoneProjects = (
    <nav aria-label="Projects" style={{ marginBottom: space.md }}>
      {(division === 'All' ? [...DIVISIONS, ''] : [division]).map(d => {
        const here = railProjects.filter(p => (d ? p.division === d : !p.division))
        if (!here.length) return null
        return (
          <section key={d || 'none'} data-division-group={d || 'none'} style={{ marginBottom: space.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.xs, padding: `${space.xs}px ${space.xs}px` }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: radius.pill, background: d ? tintOfDivision(d).solid : colour.inkFainter }} />
              <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1 }}>{d || 'Whole business'}</span>
              <span style={{ ...text('caption'), color: colour.inkFaint }}>{here.reduce((n, p) => n + openIn(p.id), 0)} open</span>
            </div>
            <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, overflow: 'hidden' }}>
              {here.map((p, i) => {
                const progress = progressOf(p, items)
                const tint = p.division ? tintOfDivision(p.division).solid : tintOf(p.colour).solid
                return (
                  <button key={p.id} type="button" onClick={() => onOpenProject(p)} aria-label={`Open the ${p.name} board`}
                    style={{ display: 'flex', alignItems: 'center', gap: space.sm, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none',
                      borderTop: i ? `1px solid ${colour.lineSoft}` : 'none', padding: `${space.sm}px ${space.md}px`, minHeight: 56 }}>
                    <Ring fraction={progress.fraction} tint={tint} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>{p.private ? '🔒 ' : ''}{p.name}</span>
                      <span style={{ ...text('caption'), color: colour.inkFaint }}>
                        {openIn(p.id)} open{lateIn(p.id) ? <span style={{ color: colour.danger }}> · {lateIn(p.id)} late</span> : null}
                        {!p.fixed && p.owner && p.owner !== 'Unassigned' ? ` · ${firstOf(p.owner)}` : ''}
                      </span>
                    </span>
                    <span style={{ ...text('caption'), color: colour.inkFaint, fontVariantNumeric: 'tabular-nums' }}>{progress.done}/{progress.total}</span>
                    <span aria-hidden="true" style={{ color: colour.inkFaint }}>›</span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
      {making
        ? <NewProject busy={busyProject} division={division === 'All' ? '' : division} canPrivate={canPrivate}
            onCancel={() => setMaking(false)} onCreate={fields => { onCreateProject(fields); setMaking(false) }} />
        : <button type="button" onClick={() => setMaking(true)} style={{ ...text('bodyStrong'), background: 'none', border: 'none', color: colour.accentDeep, padding: space.xs, cursor: 'pointer' }}>+ New project</button>}
    </nav>
  )

  const row = task => {
    const mine = isMine(task)
    const finished = task.status === 'done'
    const due = dueState(task.due_date, today)
    const state = stateOf(task)
    return (
      <div key={task.id} data-mine={mine ? 'true' : undefined} style={{
        display: 'grid', alignItems: 'center', columnGap: space.sm, rowGap: 2,
        gridTemplateColumns: wide ? TABLE_COLUMNS : '24px minmax(0, 1fr) auto',
        padding: wide ? `0 ${space.md}px 0 ${space.sm}px` : `${space.sm}px ${space.md}px ${space.sm}px ${space.sm}px`,
        minHeight: wide ? 46 : undefined,
        borderBottom: `1px solid ${colour.lineSoft}`,
        borderLeft: `4px solid ${mine ? colour.accent : 'transparent'}`,
        background: mine ? colour.accentSoft : 'transparent'
      }}>
        <button type="button" aria-label={finished ? `Reopen ${task.task}` : `Tick off ${task.task}`} onClick={() => tick(task)}
          style={{
            width: 22, height: 22, borderRadius: radius.pill, cursor: 'pointer', padding: 0,
            border: `2px solid ${finished ? colour.accent : colour.line}`, background: finished ? colour.accent : colour.surface,
            color: 'white', ...text('micro'), letterSpacing: 0, gridRow: wide ? 'auto' : 'span 2'
          }}>{finished ? '✓' : ''}</button>
        <button type="button" onClick={() => onOpenTask(task)}
          style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', minWidth: 0 }}>
          <span style={{
            ...text('bodyStrong'), color: finished ? colour.inkFainter : colour.ink, display: 'block',
            textDecoration: finished ? 'line-through' : 'none', overflowWrap: 'anywhere'
          }}>{task.task}</span>
          {task.priority === 'urgent' && !finished && <span style={{ ...text('caption'), color: colour.danger, fontWeight: 700 }}>Urgent</span>}
          {groupBy === 'distributor' && view === 'list' && (
            <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block' }}>{projectFor(task).name}</span>
          )}
        </button>
        {wide
          ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Avatar name={task.assignee} mine={mine} />
              <span style={{ ...text('caption'), color: colour.inkMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {mine ? 'You' : task.assignee && task.assignee !== 'Unassigned' ? firstOf(task.assignee) : 'Nobody yet'}
              </span>
            </span>
          : <Avatar name={task.assignee} mine={mine} />}
        <button type="button" onClick={() => advance(task)} title="Move it on to the next column"
          style={{
            ...text('caption'), fontWeight: 600, border: 'none', cursor: 'pointer',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            ...(wide
              ? { ...STATE_CELL[state.tone], alignSelf: 'stretch', margin: '3px 0', borderRadius: radius.control - 2, padding: '0 8px', textAlign: 'center' }
              : { ...STATE_STYLE[state.tone], borderRadius: radius.control, padding: '4px 8px', minHeight: 28, gridColumn: '2', justifySelf: 'start' })
          }}>{state.label}</button>
        <span style={{
          ...text('caption'), textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          color: due && !finished ? DUE_TONES[due.tone].colour : colour.inkFaint,
          fontWeight: due && due.tone !== 'calm' && !finished ? 700 : 400
        }}>{finished && task.due_date ? formatShort(task.due_date) : due ? due.label : ''}</span>
        {wide && (
          <span style={{ ...text('caption'), color: task.priority === 'urgent' ? colour.danger : colour.inkFaint, fontWeight: task.priority === 'urgent' ? 700 : 400, textTransform: 'capitalize' }}>
            {task.priority && task.priority !== 'normal' ? task.priority : '—'}
          </span>
        )}
        {wide && (
          <span aria-label={`${commentCount(task)} notes`} style={{ ...text('caption'), color: colour.inkFaint, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
            {commentCount(task)}
          </span>
        )}
      </div>
    )
  }

  const tableHead = (
    <div aria-hidden="true" style={{
      display: 'grid', gridTemplateColumns: TABLE_COLUMNS, columnGap: space.sm, padding: `6px ${space.md}px 6px ${space.sm + 4}px`,
      ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, background: colour.canvas, borderBottom: `1px solid ${colour.lineSoft}`
    }}>
      <span /><span>Task</span><span>Owner</span><span style={{ textAlign: 'center' }}>Status</span><span style={{ textAlign: 'right' }}>Due</span><span>Priority</span><span>Notes</span>
    </div>
  )

  /** The group's bar: done, under way and not started, in the status colours. */
  const groupBar = rows => {
    const all = rows.length || 1
    const done = rows.filter(t => t.status === 'done').length
    const going = rows.filter(t => t.status === 'in_progress').length
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: space.xs, ...text('caption'), color: colour.inkFaint }}>
        <span aria-hidden="true" style={{ display: 'flex', width: 140, height: 8, borderRadius: radius.pill, background: colour.lineSoft, overflow: 'hidden' }}>
          <span style={{ width: `${(done / all) * 100}%`, background: colour.accent }} />
          <span style={{ width: `${(going / all) * 100}%`, background: colour.warning }} />
        </span>
        {Math.round((done / all) * 100)}% done
      </span>
    )
  }

  const groupPicker = (
    <div role="tablist" aria-label="Group by" style={{ display: 'flex', alignItems: 'center', gap: space.xs, marginBottom: space.sm, flexWrap: 'wrap' }}>
      <span style={{ ...text('caption'), color: colour.inkFaint }}>Group by</span>
      {[['project', 'Project'], ['distributor', 'Distributor']].map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={groupBy === key} data-group-by={key} onClick={() => setGroupBy(key)}
          style={{
            ...text('caption'), fontWeight: groupBy === key ? 700 : 400, minHeight: 30, padding: `0 ${space.md}px`, cursor: 'pointer',
            borderRadius: radius.pill, border: groupBy === key ? 'none' : `1px solid ${colour.line}`,
            background: groupBy === key ? colour.navy : colour.surface, color: groupBy === key ? 'white' : colour.inkMuted
          }}>{label}</button>
      ))}
    </div>
  )

  const distributorView = () => {
    const groups = byDistributor(shownOpen.slice().sort(order))
    if (!groups.length) return empty()
    return groups.map(g => (
      <section key={g.key} data-distributor-group={g.key} style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, overflow: 'hidden', marginBottom: space.md }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px`, borderBottom: `1px solid ${colour.line}`,
          boxShadow: `inset 4px 0 0 ${g.key === 'none' ? colour.line : colour.navy}` }}>
          <span style={{ ...text('heading'), color: colour.ink }}>{g.name}</span>
          <span style={{ ...text('caption'), color: colour.inkFaint, flex: 1, minWidth: 0 }}>
            {g.tasks.filter(t => t.status !== 'done').length} open
          </span>
          {wide && groupBar(g.tasks)}
        </div>
        {wide && tableHead}
        {g.tasks.map(row)}
      </section>
    ))
  }

  const listView = () => {
    const picker = wide ? null : groupPicker
    if (groupBy === 'distributor') return <>{picker}{distributorView()}</>
    return <>{picker}{projectListView()}</>
  }

  const projectListView = () => {
    const groups = orderedProjects(all, items)
      .map(p => [p, shownOpen.filter(t => projectIdOf(t) === p.id).sort(order)])
      .filter(([, rows]) => rows.length)
    if (!groups.length) return empty()
    return groups.map(([p, rows]) => {
      const tint = p.division ? tintOfDivision(p.division) : tintOf(p.colour)
      return (
        <section key={p.id} style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, overflow: 'hidden', marginBottom: space.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px`, borderBottom: `1px solid ${colour.line}`, boxShadow: `inset 4px 0 0 ${tint.solid}` }}>
            <button type="button" onClick={() => onOpenProject(p)}
              style={{ ...text('heading'), color: colour.ink, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', minWidth: 0 }}>{p.name}</button>
            <span style={{ ...text('caption'), color: colour.inkFaint, flex: 1, minWidth: 0 }}>
              {!p.fixed && p.owner && p.owner !== 'Unassigned' ? `Led by ${me && p.owner === me.name ? 'you' : firstOf(p.owner)}` : ''}
              {p.due ? ` · due ${formatShort(p.due)}` : ''}
            </span>
            {p.division && (
              <span style={{ ...text('caption'), fontWeight: 600, padding: '2px 8px', borderRadius: radius.pill, background: tint.wash, color: tint.ink }}>{p.division}</span>
            )}
            {wide && groupBar(tasksOf(p.id, live))}
          </div>
          {wide && tableHead}
          {rows.map(row)}
        </section>
      )
    })
  }

  // ── By division (mock-up B): the whole business at a glance ──
  const divisionView = () => (
    <div data-division-lanes style={{ display: 'grid', gridTemplateColumns: `repeat(${DIVISIONS.length}, minmax(0, 1fr))`, gap: space.md, alignItems: 'start' }}>
      {DIVISIONS.map(d => {
        const tint = tintOfDivision(d)
        const inLane = shownOpen.filter(t => divisionFor(t) === d)
        const late = inLane.filter(isOverdue).length
        const groups = orderedProjects(all, items)
          .map(p => [p, inLane.filter(t => projectIdOf(t) === p.id).sort(order)])
          .filter(([, rows]) => rows.length)
        return (
          <section key={d} data-lane={d} style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: space.xs, paddingBottom: space.xs, marginBottom: space.sm, borderBottom: `3px solid ${tint.solid}` }}>
              <span style={{ ...text('heading'), color: colour.ink }}>{d}</span>
              <span style={{ ...text('caption'), color: colour.inkFaint, marginLeft: 'auto' }}>
                {inLane.filter(t => t.status !== 'done').length} open{late ? <span style={{ color: colour.danger }}> · {late} late</span> : null}
              </span>
            </div>
            {!groups.length && <div style={{ ...text('caption'), color: colour.inkFainter }}>Nothing open</div>}
            {groups.map(([p, rows]) => {
              const progress = progressOf(p, items)
              return (
                <div key={p.id} style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.control, padding: space.sm, marginBottom: space.sm }}>
                  <button type="button" onClick={() => onOpenProject(p)} style={{ display: 'flex', width: '100%', gap: space.xs, alignItems: 'baseline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0 }}>{p.name}</span>
                    <span style={{ ...text('caption'), color: colour.inkFaint }}>{progress.done}/{progress.total}</span>
                  </button>
                  <div aria-hidden="true" style={{ height: 4, borderRadius: radius.pill, background: colour.lineSoft, margin: '6px 0' }}>
                    <div style={{ width: `${progress.fraction * 100}%`, height: 4, borderRadius: radius.pill, background: tint.solid }} />
                  </div>
                  {rows.slice(0, 3).map(t => {
                    const due = dueState(t.due_date, today)
                    return (
                      <button key={t.id} type="button" onClick={() => onOpenTask(t)}
                        style={{ display: 'flex', gap: space.xs, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '3px 0', cursor: 'pointer', alignItems: 'baseline' }}>
                        <span style={{ ...text('caption'), color: colour.ink, flex: 1, minWidth: 0, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                          {t.task}<span style={{ color: colour.inkFaint }}> · {isMine(t) ? 'you' : t.assignee && t.assignee !== 'Unassigned' ? firstOf(t.assignee) : '?'}</span>
                        </span>
                        {due && t.status !== 'done' && <span style={{ ...text('caption'), color: DUE_TONES[due.tone].colour, fontWeight: due.tone !== 'calm' ? 700 : 400, flexShrink: 0 }}>{due.label}</span>}
                      </button>
                    )
                  })}
                  {rows.length > 3 && (
                    <button type="button" onClick={() => setProjectId(p.id) || setView('list')}
                      style={{ ...text('caption'), color: colour.inkFaint, background: 'none', border: 'none', padding: '3px 0', cursor: 'pointer' }}>+ {rows.length - 3} more</button>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )

  const boardView = () => {
    const columns = [['open', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']]
    return (
      <div style={{ display: 'grid', gridTemplateColumns: wide ? 'repeat(3, minmax(0, 1fr))' : 'repeat(3, minmax(240px, 1fr))', gap: space.sm, overflowX: 'auto', paddingBottom: 4 }}>
        {columns.map(([key, label]) => {
          const cards = shown.filter(t => (t.status || 'open') === key).sort(order)
          const showing = key === 'done' ? cards.slice(0, 12) : cards
          return (
            <div key={key} style={{ background: colour.lineSoft, borderRadius: radius.card, padding: space.xs, alignSelf: 'start' }}>
              <div style={{ ...text('bodyStrong'), color: colour.ink, display: 'flex', padding: `${space.xs}px ${space.sm}px` }}>
                <span style={{ flex: 1 }}>{label}</span>
                <span style={{ color: colour.inkFaint }}>{cards.length}</span>
              </div>
              {showing.map(task => {
                const mine = isMine(task)
                const p = projectFor(task)
                const due = dueState(task.due_date, today)
                return (
                  <button key={task.id} type="button" onClick={() => onOpenTask(task)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: space.xs,
                      background: colour.surface, borderRadius: radius.control, padding: space.sm,
                      border: `1px solid ${mine ? colour.accent : colour.line}`,
                      boxShadow: mine ? `inset 3px 0 0 ${colour.accent}` : 'none'
                    }}>
                    <span style={{ ...text('caption'), color: (p.division ? tintOfDivision(p.division) : tintOf(p.colour)).ink, display: 'block' }}>{p.name}</span>
                    <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block', margin: '2px 0 6px', textDecoration: key === 'done' ? 'line-through' : 'none' }}>{task.task}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Avatar name={task.assignee} mine={mine} size={22} />
                      <span style={{ ...text('caption'), color: colour.inkMuted, flex: 1 }}>{mine ? 'You' : task.assignee && task.assignee !== 'Unassigned' ? firstOf(task.assignee) : 'Nobody yet'}</span>
                      {due && key !== 'done' && <span style={{ ...text('caption'), color: DUE_TONES[due.tone].colour, fontWeight: due.tone !== 'calm' ? 700 : 400 }}>{due.label}</span>}
                    </span>
                  </button>
                )
              })}
              {key === 'done' && cards.length > showing.length && (
                <div style={{ ...text('caption'), color: colour.inkFaint, padding: space.sm }}>and {cards.length - showing.length} more done</div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const peopleView = () => {
    const people = STAFF.filter(s => division === 'All' || s.division === division)
      .filter(s => !onlyMine || (me && s.email === me.email))
      .filter(s => !person || s.name === person)
      .sort((a, b) => (me && b.email === me.email) - (me && a.email === me.email))
    const most = Math.max(4, ...people.map(s => shown.filter(t => t.status !== 'done' && isSameStaff(t.assignee, s)).length))
    return (
      <div style={{ display: 'grid', gridTemplateColumns: wide ? 'repeat(auto-fill, minmax(260px, 1fr))' : 'minmax(0, 1fr)', gap: space.sm }}>
        {people.map(s => {
          const you = me && s.email === me.email
          const theirs = shown.filter(t => t.status !== 'done' && isSameStaff(t.assignee, s)).sort(order)
          const late = theirs.filter(isOverdue).length
          const tint = tintOfDivision(s.division)
          return (
            <div key={s.email} style={{
              background: colour.surface, borderRadius: radius.card, padding: space.md,
              border: `1px solid ${you ? colour.accent : colour.line}`, boxShadow: you ? `inset 0 0 0 1px ${colour.accent}` : 'none'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
                <Avatar name={s.name} mine={you} size={32} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>{you ? 'You' : s.firstName}</span>
                  <span style={{ ...text('caption'), color: colour.inkFaint }}>{s.role} · {s.division}</span>
                </span>
                <span style={{ ...text('title'), color: colour.ink, fontVariantNumeric: 'tabular-nums' }}>{theirs.length}</span>
              </div>
              <div aria-hidden="true" style={{ display: 'flex', height: 6, borderRadius: radius.pill, background: colour.lineSoft, overflow: 'hidden', marginBottom: space.sm }}>
                <span style={{ width: `${((theirs.length - late) / most) * 100}%`, background: tint.solid }} />
                <span style={{ width: `${(late / most) * 100}%`, background: colour.danger }} />
              </div>
              {theirs.length === 0 && <div style={{ ...text('caption'), color: colour.inkFainter }}>Nothing open</div>}
              {theirs.slice(0, 4).map(t => {
                const due = dueState(t.due_date, today)
                return (
                  <button key={t.id} type="button" onClick={() => onOpenTask(t)}
                    style={{ display: 'flex', gap: space.sm, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: `1px solid ${colour.lineSoft}`, padding: '6px 0', cursor: 'pointer' }}>
                    <span style={{ ...text('caption'), color: colour.ink, flex: 1, minWidth: 0 }}>{t.task}</span>
                    {due && <span style={{ ...text('caption'), color: DUE_TONES[due.tone].colour, fontWeight: due.tone !== 'calm' ? 700 : 400, flexShrink: 0 }}>{due.label}</span>}
                  </button>
                )
              })}
              {theirs.length > 4 && <div style={{ ...text('caption'), color: colour.inkFaint, paddingTop: 4 }}>and {theirs.length - 4} more</div>}
            </div>
          )
        })}
      </div>
    )
  }

  function empty() {
    return (
      <div style={{ ...text('body'), color: colour.inkFaint, textAlign: 'center', padding: space.xxl, background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card }}>
        {stat || onlyMine || projectId || person || dist || division !== 'All'
          ? 'Nothing matches. Try another division, or turn the filters off.'
          : 'Nothing on the list yet. Add the first task above.'}
      </div>
    )
  }

  const phoneTabs = !wide && (
    <div role="tablist" aria-label="Projects" style={{ display: 'flex', gap: 4, background: colour.lineSoft, borderRadius: radius.control, padding: 4, marginBottom: space.md }}>
      {[['todo', 'My To Do'], ['projects', 'Projects']].map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={phoneTab === key} onClick={() => setPhoneTab(key)}
          style={{
            ...text('bodyStrong'), flex: 1, minHeight: 44, border: 'none', borderRadius: radius.control - 2, cursor: 'pointer',
            background: phoneTab === key ? colour.surface : 'transparent', color: phoneTab === key ? colour.ink : colour.inkFaint,
            boxShadow: phoneTab === key ? `0 1px 2px ${colour.lineSoft}` : 'none'
          }}>{label}</button>
      ))}
    </div>
  )

  if (!wide && phoneTab === 'todo') {
    return (
      <div>
        {!phoneTabGiven && phoneTabs}
        <MyToDo name={me?.firstName} tasks={live.filter(isMine)} today={today}
          projectFor={projectFor}
          tintFor={p => (p.division ? tintOfDivision(p.division) : tintOf(p.colour))}
          onTick={tick} onOpenTask={onOpenTask} quickAdd={quickAdd} />
      </div>
    )
  }

  const content = (
    <>
      {view === 'list' && listView()}
      {view === 'division' && wide && divisionView()}
      {view === 'board' && boardView()}
      {view === 'people' && peopleView()}
    </>
  )

  if (!wide) {
    return (
      <div>
        {!phoneTabGiven && phoneTabs}
        {filters}
        {phoneProjects}
        <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFainter, padding: `0 ${space.xs}px ${space.xs}px` }}>Tasks</div>
        {quickAdd}
        {content}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: space.lg, alignItems: 'start' }}>
      {rail}
      <div style={{ minWidth: 0 }}>
        {quickAdd}
        {filters}
        {content}
      </div>
    </div>
  )
}
