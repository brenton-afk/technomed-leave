// ─── Projects, and the tasks that belong to them ─────────────────────────────
// "Can you build the task/project section out to be more comprehensive. We want
// it similar to monday.com as a true project page."
//
// What was there was one flat list. It worked for what it was built for — a
// meeting produces actions, the actions go on a board, people tick them off —
// and stopped working the moment there was more than one thing going on at
// once, which is always. Forty items belonging to nine people across four
// unrelated pieces of work is not a project page; it is a reason to keep using
// a notebook.
//
// So: a project owns its tasks, defines its own columns, and knows how far
// through it is.
//
// ── What is deliberately not here ──
//
// No dependencies, no Gantt, no automations. monday.com has them and nine
// people in Hobart will not use them; every one of them is a field somebody
// has to fill in correctly for the board to mean anything, and a board that
// lies is worse than a notebook. This is the part of monday.com that earns
// its keep at this size: where does this task belong, who has it, what state
// is it in, and what has happened to it since.
//
// ── Why none of this touches Redis ──
//
// All of it is a pure function of the stored shapes, so it can be tested
// without a database and used on both sides of the wire. The server stores
// and the client draws, but they agree on what a column is because they are
// reading the same file.

/**
 * The columns a new project starts with.
 *
 * `done` is the one that is not cosmetic. A project can rename its columns to
 * anything — "Waiting on supplier", "With Toni", "Ready to invoice" — and the
 * progress bar still has to know which of those means finished. Without the
 * flag the bar would have to guess from the label, and a project whose last
 * column is called "Invoiced" would read as 0% complete forever.
 */
export const DEFAULT_COLUMNS = [
  { key: 'open', label: 'Open', done: false },
  { key: 'in_progress', label: 'In progress', done: false },
  { key: 'done', label: 'Done', done: true }
]

/**
 * Where a task goes when it belongs to no project.
 *
 * Every task written before projects existed is one of these, and so is the
 * thing somebody agrees in the car on the way back from Calvary. A board that
 * forces you to choose a project before you can write down "get the Athlet
 * tray back" is a board people stop using.
 *
 * Not stored. It is the same for everyone and cannot be renamed or archived,
 * so keeping a row for it in Redis would only be a row that could go missing.
 */
export const GENERAL = {
  id: 'general',
  name: 'General',
  owner: 'Unassigned',
  due: '',
  columns: DEFAULT_COLUMNS,
  archived: false,
  fixed: true
}

/** The colours a project can be given, as names the design tokens resolve. */
export const PROJECT_COLOURS = [
  'teal', 'navy', 'plum', 'clay', 'moss', 'slate'
]

const slug = () => Math.random().toString(36).slice(2, 9)

/** A column key from a label somebody typed, stable and safe in a URL. */
export function columnKey(label, taken = []) {
  const base = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'column'
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

/**
 * A stored project, with everything a reader is entitled to assume present.
 *
 * Written defensively because the rows outlive the code that wrote them: a
 * project saved today is read by next year's version of this file, and the
 * difference between "no columns" and "the default columns" should not be a
 * crash on a board somebody is standing in a corridor trying to read.
 */
export function normaliseProject(raw) {
  if (!raw) return null
  const columns = Array.isArray(raw.columns) && raw.columns.length
    ? raw.columns
      .filter(c => c && c.key)
      .map(c => ({ key: String(c.key), label: String(c.label || c.key), done: Boolean(c.done) }))
    : DEFAULT_COLUMNS

  return {
    id: String(raw.id),
    name: String(raw.name || 'Untitled project'),
    owner: raw.owner || 'Unassigned',
    due: raw.due || '',
    colour: PROJECT_COLOURS.includes(raw.colour) ? raw.colour : PROJECT_COLOURS[0],
    notes: raw.notes || '',
    // A project with no column that means finished can never be finished, so
    // the last one is treated as the finishing post rather than leaving the
    // progress bar permanently at nought.
    columns: columns.some(c => c.done)
      ? columns
      : columns.map((c, i) => ({ ...c, done: i === columns.length - 1 })),
    archived: Boolean(raw.archived),
    createdAt: raw.createdAt || '',
    createdBy: raw.createdBy || '',
    updatedAt: raw.updatedAt || ''
  }
}

/** A new project, from whatever a person typed into the form. */
export function newProject({ name, owner, due, colour, notes, by, at }) {
  return normaliseProject({
    id: `prj-${at ? Date.parse(at) : 0}-${slug()}`,
    name,
    owner: owner || 'Unassigned',
    due: due || '',
    colour: colour || PROJECT_COLOURS[0],
    notes: notes || '',
    columns: DEFAULT_COLUMNS,
    archived: false,
    createdAt: at || '',
    createdBy: by || '',
    updatedAt: at || ''
  })
}

/** The project a task belongs to, which is General unless it says otherwise. */
export function projectIdOf(task) {
  const id = task?.projectId
  return id && String(id).trim() ? String(id) : GENERAL.id
}

/**
 * Which column a task sits in.
 *
 * The migration lives here rather than in a one-off script. Every task written
 * before this feature has a `status` and no `column`, and will still have no
 * `column` until somebody moves it — a task nobody has touched since August
 * must still land in the right place on the board, forever, not just on the
 * day the script ran.
 *
 * A column that no longer exists — because the project renamed or removed it —
 * falls back to the first, which is the only answer that cannot lose a task
 * off the end of a board.
 */
export function columnOf(task, project = GENERAL) {
  const columns = project?.columns?.length ? project.columns : DEFAULT_COLUMNS
  const named = task?.column && columns.find(c => c.key === task.column)
  if (named) return named.key

  const status = task?.status || 'open'
  const byStatus = columns.find(c => c.key === status)
  if (byStatus) return byStatus.key
  if (status === 'done') return (columns.find(c => c.done) || columns[0]).key
  return columns[0].key
}

/**
 * The legacy status for a task in a given column.
 *
 * Kept in step deliberately. The repeat-matcher, the summary email and the
 * "Mine" count all read `status`, and a project renaming its middle column to
 * "With Toni" must not quietly take its tasks out of those. Three states are
 * all those consumers ever needed; the columns are what a person sees.
 */
export function statusFor(columnKeyName, project = GENERAL) {
  const columns = project?.columns?.length ? project.columns : DEFAULT_COLUMNS
  const column = columns.find(c => c.key === columnKeyName) || columns[0]
  if (column.done) return 'done'
  return columns.indexOf(column) === 0 ? 'open' : 'in_progress'
}

/** A task moved to a column, with its status brought along. */
export function movedTo(task, columnKeyName, project = GENERAL, at = '') {
  const columns = project?.columns?.length ? project.columns : DEFAULT_COLUMNS
  const target = columns.find(c => c.key === columnKeyName)
  if (!target) throw new Error('That column is not on this project')
  return {
    ...task,
    column: target.key,
    status: statusFor(target.key, project),
    updatedAt: at || task.updatedAt || ''
  }
}

/** The tasks of one project, archived ones left out. */
export function tasksOf(projectId, tasks = []) {
  return (tasks || [])
    .filter(t => t && !t.archived)
    .filter(t => projectIdOf(t) === (projectId || GENERAL.id))
}

/**
 * How far through a project is.
 *
 * Counted over the columns rather than the status so a project that has
 * renamed its own is still measured by its own definition of finished.
 */
export function progressOf(project, tasks = []) {
  const mine = tasksOf(project?.id, tasks)
  const finished = mine.filter(t => {
    const key = columnOf(t, project)
    return (project?.columns || DEFAULT_COLUMNS).find(c => c.key === key)?.done
  })
  return {
    done: finished.length,
    total: mine.length,
    // Nought rather than NaN. An empty project is 0% done, not undefined, and
    // a bar drawn from NaN is a bar drawn at full width.
    fraction: mine.length ? finished.length / mine.length : 0,
    complete: mine.length > 0 && finished.length === mine.length
  }
}

/**
 * A project with one column renamed.
 *
 * The key never changes, only the label. Renaming "In progress" to "With Toni"
 * must not move a single task, and a rename that changed the key would move
 * every one of them to the fallback column — which is the kind of thing you
 * only notice a week later when somebody asks where their work went.
 */
export function renamedColumn(project, key, label) {
  const text = String(label || '').trim()
  if (!text) throw new Error('A column needs a name')
  return {
    ...project,
    columns: project.columns.map(c => (c.key === key ? { ...c, label: text } : c))
  }
}

/** A project with a column added before the finishing one. */
export function addedColumn(project, label) {
  const text = String(label || '').trim()
  if (!text) throw new Error('A column needs a name')
  if (project.columns.length >= 8) {
    throw new Error('Eight columns is as wide as a board stays readable')
  }
  const column = {
    key: columnKey(text, project.columns.map(c => c.key)),
    label: text,
    done: false
  }
  // Before the finished column, because that is where work actually goes: a
  // new state is almost always another step on the way, not another way of
  // being over.
  const at = project.columns.findIndex(c => c.done)
  const columns = [...project.columns]
  columns.splice(at === -1 ? columns.length : at, 0, column)
  return { ...project, columns }
}

/**
 * A project with a column removed, and where its tasks went.
 *
 * Returns both, because removing a column is the one board edit that can lose
 * work. The tasks move to the first column rather than vanishing, and the
 * caller gets the list so it can write them back.
 */
export function removedColumn(project, key, tasks = []) {
  if (project.columns.length <= 2) {
    throw new Error('A board needs at least two columns')
  }
  const going = project.columns.find(c => c.key === key)
  if (!going) throw new Error('That column is not on this project')
  if (going.done && project.columns.filter(c => c.done).length === 1) {
    throw new Error('A board needs a column that means finished')
  }

  const columns = project.columns.filter(c => c.key !== key)
  const next = { ...project, columns }
  const moved = tasksOf(project.id, tasks)
    .filter(t => columnOf(t, project) === key)
    .map(t => movedTo(t, columns[0].key, next))

  return { project: next, moved }
}

// ─── The thread on a task ────────────────────────────────────────────────────
// "A thread on each task — comments and updates, so the history lives with the
// work instead of in WhatsApp."
//
// Append-only on purpose. The value of "rang them 12 Oct, waiting on a date" is
// that it was written on the 12th and has not been tidied since; an editable
// history is a history nobody can rely on. Delete the task, not the record of
// what happened to it.

/** A task with one more update on it. */
export function withComment(task, { text, by, at }) {
  const said = String(text || '').trim()
  if (!said) throw new Error('An update needs something in it')
  if (said.length > 2000) throw new Error('That update is too long for a task')
  const thread = Array.isArray(task?.comments) ? task.comments : []
  return {
    ...task,
    comments: [...thread, { id: `c-${thread.length + 1}-${slug()}`, text: said, by: by || '', at: at || '' }],
    updatedAt: at || task?.updatedAt || ''
  }
}

/** How many updates are on a task, for the count on a card. */
export function commentCount(task) {
  return Array.isArray(task?.comments) ? task.comments.length : 0
}

// ─── Archive, not delete ─────────────────────────────────────────────────────
// The ✕ really deleted, which is wrong for the thing this is becoming. Erin
// keeping track of what has been completed needs the completed ones to still
// exist, and somebody who archives the wrong task at eleven at night needs it
// back in the morning.

/** A task put away, kept. */
export function archived(item, { by, at } = {}) {
  return { ...item, archived: true, archivedBy: by || '', archivedAt: at || '' }
}

/** And brought back. */
export function restored(item) {
  const out = { ...item, archived: false }
  delete out.archivedBy
  delete out.archivedAt
  return out
}

/**
 * Whether a project can be put away.
 *
 * Not while there is live work in it. Archiving a project takes its tasks off
 * every board at once, including somebody else's "Mine" list, and the
 * difference between "this is finished" and "I did not realise Ben still had
 * three of these" is worth one extra tap.
 */
export function blockedFromArchiving(project, tasks = []) {
  if (project?.fixed) return 'The General list cannot be archived'
  const open = tasksOf(project?.id, tasks).filter(t => t.status !== 'done')
  if (open.length) {
    return `${open.length} task${open.length === 1 ? '' : 's'} on this project `
      + 'still to do — finish or move them first'
  }
  return ''
}

/**
 * Projects in the order a board should list them.
 *
 * Live work first, then what has nothing left in it, then what is put away.
 * Within each, soonest due first and undated last, because a project with a
 * date on it is a project somebody is waiting on.
 */
export function orderedProjects(projects = [], tasks = []) {
  const rank = p => {
    if (p.archived) return 2
    return progressOf(p, tasks).complete ? 1 : 0
  }
  return [...projects].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (a.fixed !== b.fixed) return a.fixed ? 1 : -1
    if (Boolean(a.due) !== Boolean(b.due)) return a.due ? -1 : 1
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

// ─── What is due ─────────────────────────────────────────────────────────────
// "Anything due today appears on the Cases day view alongside the bookings, so
// the portal is one place you look each morning."

/**
 * The tasks due on or before a given day, soonest first.
 *
 * Overdue is included on purpose and is the whole point: a task that was due
 * on Friday does not stop being due because it is Monday, and a list that
 * quietly drops it is a list that helped you forget.
 */
export function dueBy(day, tasks = []) {
  if (!day) return []
  return (tasks || [])
    .filter(t => t && !t.archived && t.status !== 'done' && t.due_date)
    .filter(t => t.due_date <= day)
    .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
}
