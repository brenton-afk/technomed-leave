import { describe, it, expect } from 'vitest'
import {
  DEFAULT_COLUMNS, GENERAL, columnKey, normaliseProject, newProject,
  projectIdOf, columnOf, statusFor, movedTo, tasksOf, progressOf,
  renamedColumn, addedColumn, removedColumn, withComment, commentCount,
  archived, restored, blockedFromArchiving, orderedProjects, dueBy
} from './model.js'

// ─── A project page rather than a list ───────────────────────────────────────
// "Can you build the task/project section out to be more comprehensive. We want
// it similar to monday.com as a true project page."
//
// What was there was one flat list — fine for one meeting's actions, useless
// the moment four unrelated pieces of work are running at once, which is
// always. These are the rules that make a project a thing rather than a label.

const task = (over = {}) => ({
  id: 't1', task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt',
  status: 'open', priority: 'normal', due_date: '', ...over
})

const project = (over = {}) => normaliseProject({
  id: 'prj-1', name: 'Globus onboarding', columns: DEFAULT_COLUMNS, ...over
})

describe('what a project is', () => {
  it('starts with three columns, the last of which means finished', () => {
    const p = newProject({ name: 'Globus onboarding' })
    expect(p.columns.map(c => c.label)).toEqual(['Open', 'In progress', 'Done'])
    expect(p.columns.filter(c => c.done).map(c => c.key)).toEqual(['done'])
  })

  it('survives a row written by an older version of this file', () => {
    // Rows outlive the code that wrote them, and a board somebody is reading
    // in a corridor is the wrong place to find that out.
    const p = normaliseProject({ id: 'prj-1' })
    expect(p.name).toBe('Untitled project')
    expect(p.columns).toHaveLength(3)
    expect(p.owner).toBe('Unassigned')
  })

  it('gives a project with no finishing column one anyway', () => {
    // Otherwise its progress bar sits at nought for ever, which reads as
    // "nobody has done anything" rather than "this board cannot be finished".
    const p = normaliseProject({
      id: 'prj-1',
      columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]
    })
    expect(p.columns.filter(c => c.done).map(c => c.key)).toEqual(['b'])
  })

  it('refuses a colour it does not have', () => {
    expect(normaliseProject({ id: 'p', colour: 'hotpink' }).colour).toBe('teal')
  })
})

describe('the General list', () => {
  it('owns everything that names no project', () => {
    // Every task written before projects existed, and the thing agreed in the
    // car on the way back from Calvary.
    expect(projectIdOf(task())).toBe('general')
    expect(projectIdOf(task({ projectId: '' }))).toBe('general')
    expect(projectIdOf(task({ projectId: 'prj-1' }))).toBe('prj-1')
  })

  it('cannot be archived', () => {
    expect(blockedFromArchiving(GENERAL, [])).toMatch(/cannot be archived/)
  })
})

describe('where a task sits', () => {
  it('reads the column it was put in', () => {
    expect(columnOf(task({ column: 'in_progress' }), project())).toBe('in_progress')
  })

  it('places a task written before columns existed', () => {
    // The migration lives in the reader, not in a one-off script: a task
    // nobody has touched since August has to land in the right place forever,
    // not just on the day a script ran.
    expect(columnOf(task({ status: 'in_progress' }), project())).toBe('in_progress')
    expect(columnOf(task({ status: 'done' }), project())).toBe('done')
    expect(columnOf(task({ status: 'open' }), project())).toBe('open')
  })

  it('finds a finished task a home on a renamed board', () => {
    const p = project({
      columns: [
        { key: 'todo', label: 'To do' },
        { key: 'invoiced', label: 'Invoiced', done: true }
      ]
    })
    expect(columnOf(task({ status: 'done' }), p)).toBe('invoiced')
  })

  it('does not lose a task off the end of a board', () => {
    // Its column was removed while it was in it.
    expect(columnOf(task({ column: 'gone_away' }), project())).toBe('open')
  })
})

describe('keeping the old status in step', () => {
  // The repeat matcher, the summary email and the "Mine" count all read
  // status. A project renaming its middle column must not take its tasks out
  // of any of those.
  it('calls the first column open and the finishing one done', () => {
    expect(statusFor('open', project())).toBe('open')
    expect(statusFor('done', project())).toBe('done')
  })

  it('calls everything in between in progress, whatever it is named', () => {
    const p = addedColumn(project(), 'Waiting on supplier')
    expect(statusFor('waiting_on_supplier', p)).toBe('in_progress')
    expect(statusFor('in_progress', p)).toBe('in_progress')
  })

  it('brings the status along when a task moves', () => {
    const moved = movedTo(task(), 'done', project(), '2026-10-13T00:00:00.000Z')
    expect(moved.column).toBe('done')
    expect(moved.status).toBe('done')
    expect(moved.updatedAt).toBe('2026-10-13T00:00:00.000Z')
  })

  it('will not move a task to a column the project does not have', () => {
    expect(() => movedTo(task(), 'invented', project())).toThrow(/not on this project/)
  })
})

describe('how far through a project is', () => {
  const TASKS = [
    task({ id: 'a', projectId: 'prj-1', status: 'done' }),
    task({ id: 'b', projectId: 'prj-1', status: 'open' }),
    task({ id: 'c', projectId: 'prj-1', status: 'open' }),
    task({ id: 'd', projectId: 'other', status: 'open' })
  ]

  it('counts only its own', () => {
    expect(progressOf(project(), TASKS)).toMatchObject({ done: 1, total: 3 })
  })

  it('measures by the board’s own definition of finished', () => {
    // A project whose last column is "Invoiced" is finished when things are
    // invoiced, not when they match some word this file chose.
    const p = project({
      columns: [{ key: 'todo', label: 'To do' }, { key: 'invoiced', label: 'Invoiced', done: true }]
    })
    const tasks = [
      task({ id: 'a', projectId: 'prj-1', column: 'invoiced' }),
      task({ id: 'b', projectId: 'prj-1', column: 'todo' })
    ]
    expect(progressOf(p, tasks)).toMatchObject({ done: 1, total: 2 })
  })

  it('leaves an archived task out of the count', () => {
    const tasks = [...TASKS, task({ id: 'e', projectId: 'prj-1', archived: true })]
    expect(progressOf(project(), tasks).total).toBe(3)
  })

  it('calls an empty project nought, not NaN', () => {
    // A bar drawn from NaN is a bar drawn at full width.
    const empty = progressOf(project(), [])
    expect(empty.fraction).toBe(0)
    expect(empty.complete).toBe(false)
  })

  it('knows when there is nothing left', () => {
    const tasks = [task({ id: 'a', projectId: 'prj-1', status: 'done' })]
    expect(progressOf(project(), tasks).complete).toBe(true)
  })
})

describe('columns a project names itself', () => {
  it('renames without moving a single task', () => {
    // A rename that changed the key would move every task to the fallback
    // column — the kind of thing you notice a week later when somebody asks
    // where their work went.
    const p = renamedColumn(project(), 'in_progress', 'With Toni')
    expect(p.columns[1]).toMatchObject({ key: 'in_progress', label: 'With Toni' })
    expect(columnOf(task({ column: 'in_progress' }), p)).toBe('in_progress')
  })

  it('refuses a column with no name', () => {
    expect(() => renamedColumn(project(), 'open', '   ')).toThrow(/needs a name/)
  })

  it('adds a new one before the finishing column', () => {
    // A new state is almost always another step on the way, not another way
    // of being over.
    const p = addedColumn(project(), 'Waiting on supplier')
    expect(p.columns.map(c => c.label))
      .toEqual(['Open', 'In progress', 'Waiting on supplier', 'Done'])
  })

  it('does not let two columns share a key', () => {
    const p = addedColumn(addedColumn(project(), 'Blocked'), 'Blocked')
    const keys = p.columns.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('stops at a width a board stays readable', () => {
    let p = project()
    for (let i = 0; i < 5; i++) p = addedColumn(p, `Step ${i}`)
    expect(() => addedColumn(p, 'One more')).toThrow(/eight columns/i)
  })

  it('makes a key out of whatever was typed', () => {
    expect(columnKey('Waiting on supplier')).toBe('waiting_on_supplier')
    expect(columnKey('  ')).toBe('column')
    expect(columnKey('Blocked', ['blocked'])).toBe('blocked_2')
  })
})

describe('removing a column, which is the edit that can lose work', () => {
  const TASKS = [
    task({ id: 'a', projectId: 'prj-1', column: 'in_progress' }),
    task({ id: 'b', projectId: 'prj-1', column: 'open' })
  ]

  it('moves what was in it rather than dropping it', () => {
    const { project: next, moved } = removedColumn(project(), 'in_progress', TASKS)
    expect(next.columns.map(c => c.key)).toEqual(['open', 'done'])
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ id: 'a', column: 'open', status: 'open' })
  })

  it('hands the moved tasks back so they can be written down', () => {
    // A column removed in the project row and tasks still pointing at it is a
    // board that looks right and is not.
    const { moved } = removedColumn(project(), 'in_progress', TASKS)
    expect(moved.every(t => t.column === 'open')).toBe(true)
  })

  it('keeps a board at two columns or more', () => {
    const two = project({
      columns: [{ key: 'todo', label: 'To do' }, { key: 'done', label: 'Done', done: true }]
    })
    expect(() => removedColumn(two, 'todo', [])).toThrow(/at least two/)
  })

  it('keeps a column that means finished', () => {
    expect(() => removedColumn(project(), 'done', [])).toThrow(/means finished/)
  })
})

describe('the thread on a task', () => {
  it('keeps what was said, and when, and by whom', () => {
    const t = withComment(task(), {
      text: 'Rang them, waiting on a date',
      by: 'Toni Hoppitt',
      at: '2026-10-13T03:00:00.000Z'
    })
    expect(t.comments).toHaveLength(1)
    expect(t.comments[0]).toMatchObject({
      text: 'Rang them, waiting on a date',
      by: 'Toni Hoppitt',
      at: '2026-10-13T03:00:00.000Z'
    })
  })

  it('appends rather than replaces', () => {
    // The value of "rang them 12 Oct" is that it was written on the 12th and
    // has not been tidied since.
    let t = withComment(task(), { text: 'Rang them' })
    t = withComment(t, { text: 'They rang back' })
    expect(t.comments.map(c => c.text)).toEqual(['Rang them', 'They rang back'])
  })

  it('gives each update its own id', () => {
    let t = withComment(task(), { text: 'One' })
    t = withComment(t, { text: 'Two' })
    expect(t.comments[0].id).not.toBe(t.comments[1].id)
  })

  it('refuses an empty update', () => {
    expect(() => withComment(task(), { text: '   ' })).toThrow(/something in it/)
  })

  it('counts them for the card, including none at all', () => {
    expect(commentCount(task())).toBe(0)
    expect(commentCount(withComment(task(), { text: 'Rang them' }))).toBe(1)
  })
})

describe('archive, not delete', () => {
  it('keeps the item and says who put it away', () => {
    const t = archived(task(), { by: 'Erin Smallbon', at: '2026-10-13T03:00:00.000Z' })
    expect(t.archived).toBe(true)
    expect(t.archivedBy).toBe('Erin Smallbon')
    expect(t.task).toBe('Chase the Globus paperwork')
  })

  it('brings it back clean', () => {
    const back = restored(archived(task(), { by: 'Erin Smallbon' }))
    expect(back.archived).toBe(false)
    expect(back.archivedBy).toBeUndefined()
  })

  it('leaves an archived task off its project', () => {
    const tasks = [task({ id: 'a', projectId: 'prj-1', archived: true })]
    expect(tasksOf('prj-1', tasks)).toHaveLength(0)
  })

  it('will not archive a project with live work in it', () => {
    // Archiving takes its tasks off everybody's board at once, including
    // somebody else's "Mine" list.
    const tasks = [task({ id: 'a', projectId: 'prj-1', status: 'open' })]
    expect(blockedFromArchiving(project(), tasks)).toMatch(/1 task on this project/)
  })

  it('says how many, so the warning is worth reading', () => {
    const tasks = [
      task({ id: 'a', projectId: 'prj-1', status: 'open' }),
      task({ id: 'b', projectId: 'prj-1', status: 'in_progress' })
    ]
    expect(blockedFromArchiving(project(), tasks)).toMatch(/2 tasks/)
  })

  it('lets a finished project go', () => {
    const tasks = [task({ id: 'a', projectId: 'prj-1', status: 'done' })]
    expect(blockedFromArchiving(project(), tasks)).toBe('')
  })
})

describe('the order projects are listed in', () => {
  const live = normaliseProject({ id: 'a', name: 'Live', due: '2026-12-01' })
  const sooner = normaliseProject({ id: 'b', name: 'Sooner', due: '2026-10-20' })
  const undated = normaliseProject({ id: 'c', name: 'Undated' })
  const away = normaliseProject({ id: 'd', name: 'Away', archived: true })
  const tasks = [
    task({ id: '1', projectId: 'a', status: 'open' }),
    task({ id: '2', projectId: 'b', status: 'open' }),
    task({ id: '3', projectId: 'c', status: 'open' })
  ]

  it('puts live work first and what is put away last', () => {
    const order = orderedProjects([away, live, sooner, undated], tasks)
    expect(order.map(p => p.id)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('drops a finished project below the live ones', () => {
    const finished = normaliseProject({ id: 'e', name: 'Finished' })
    const withDone = [...tasks, task({ id: '4', projectId: 'e', status: 'done' })]
    const order = orderedProjects([finished, live], withDone)
    expect(order.map(p => p.id)).toEqual(['a', 'e'])
  })

  it('keeps General below the real projects', () => {
    const order = orderedProjects([GENERAL, live], tasks)
    expect(order.map(p => p.id)).toEqual(['a', 'general'])
  })
})

describe('what is due', () => {
  const TASKS = [
    task({ id: 'a', due_date: '2026-10-13' }),
    task({ id: 'b', due_date: '2026-10-09' }),
    task({ id: 'c', due_date: '2026-10-20' }),
    task({ id: 'd', due_date: '' }),
    task({ id: 'e', due_date: '2026-10-13', status: 'done' }),
    task({ id: 'f', due_date: '2026-10-13', archived: true })
  ]

  it('includes what is overdue, which is the whole point', () => {
    // A task due on Friday does not stop being due because it is Monday, and
    // a list that quietly drops it is a list that helped you forget.
    expect(dueBy('2026-10-13', TASKS).map(t => t.id)).toEqual(['b', 'a'])
  })

  it('leaves out what is finished, undated or put away', () => {
    const ids = dueBy('2026-10-13', TASKS).map(t => t.id)
    expect(ids).not.toContain('c')
    expect(ids).not.toContain('d')
    expect(ids).not.toContain('e')
    expect(ids).not.toContain('f')
  })

  it('puts the longest overdue at the top', () => {
    expect(dueBy('2026-10-13', TASKS)[0].id).toBe('b')
  })

  it('copes with no day and no tasks', () => {
    expect(dueBy('', TASKS)).toEqual([])
    expect(dueBy('2026-10-13')).toEqual([])
  })
})
