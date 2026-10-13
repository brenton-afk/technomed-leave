import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── The project page, over the wire ─────────────────────────────────────────
// The rules are tested without a database in projects.test.js. This is the
// other half: that the handler reads the right rows, refuses the right
// requests, and — the one that actually bites — writes the tasks back when a
// column is removed from under them.

const store = { projects: new Map(), items: new Map() }

vi.mock('./_redis.js', () => ({
  saveProject: vi.fn(async p => { store.projects.set(p.id, JSON.parse(JSON.stringify(p))) }),
  getProject: vi.fn(async id => store.projects.get(id) || null),
  getProjects: vi.fn(async () => [...store.projects.values()]),
  deleteProject: vi.fn(async id => { store.projects.delete(id) }),
  saveWorklistItem: vi.fn(async i => { store.items.set(i.id, JSON.parse(JSON.stringify(i))) }),
  getWorklist: vi.fn(async () => [...store.items.values()]),
  getWorklistItem: vi.fn(async id => store.items.get(id) || null),
  updateWorklistItem: vi.fn(async (id, up) => {
    const next = { ...store.items.get(id), ...up }
    store.items.set(id, next)
    return next
  }),
  deleteWorklistItem: vi.fn(async id => { store.items.delete(id) }),
  saveMeeting: vi.fn(), getMeeting: vi.fn(), updateMeetingStatus: vi.fn()
}))

vi.mock('./_auth.js', () => ({
  requireSession: vi.fn(async () => ({ name: 'Erin Smallbon', email: 'erin@technomed.com.au' })),
  getSession: vi.fn(async () => ({ name: 'Erin Smallbon', email: 'erin@technomed.com.au' }))
}))

vi.mock('./_email.js', () => ({ sendMeetingSummaryEmail: vi.fn() }))
vi.mock('@vercel/blob/client', () => ({ handleUpload: vi.fn() }))

const { default: handler } = await import('./meetings/agent.js')

const call = async (action, method, { body, query } = {}) => {
  const res = {
    statusCode: 0, payload: null,
    status(code) { this.statusCode = code; return this },
    json(data) { this.payload = data; return this },
    end() { return this }
  }
  await handler({ method, query: { action, ...query }, body, headers: {} }, res)
  return res
}

const makeProject = (name = 'Globus onboarding') =>
  call('project', 'POST', { body: { name } })

const makeTask = (over = {}) => {
  const item = {
    id: over.id || 't1',
    task: 'Chase the Globus paperwork',
    assignee: 'Toni Hoppitt',
    status: 'open',
    priority: 'normal',
    due_date: '',
    ...over
  }
  store.items.set(item.id, item)
  return item
}

beforeEach(() => {
  store.projects.clear()
  store.items.clear()
})
afterEach(() => vi.clearAllMocks())

describe('making a project', () => {
  it('creates one with the default columns', async () => {
    const res = await makeProject()
    expect(res.statusCode).toBe(200)
    expect(res.payload.project.name).toBe('Globus onboarding')
    expect(res.payload.project.columns.map(c => c.label))
      .toEqual(['Open', 'In progress', 'Done'])
  })

  it('refuses one with no name', async () => {
    const res = await call('project', 'POST', { body: { name: '   ' } })
    expect(res.statusCode).toBe(400)
    expect(res.payload.error).toMatch(/give the project a name/i)
  })

  it('will not take an owner who does not work here', async () => {
    // The dropdown only offers real staff; this is for anything that does not
    // come from the dropdown.
    const res = await call('project', 'POST', {
      body: { name: 'A project', owner: 'Somebody Else' }
    })
    expect(res.payload.project.owner).toBe('Unassigned')
  })
})

describe('the board, in one request', () => {
  it('returns the projects and the tasks together', async () => {
    // Progress, counts and which-column all need both, and two round trips
    // from a phone on hospital wifi is the difference between instant and
    // visibly slow.
    await makeProject()
    makeTask()
    const res = await call('board', 'GET')
    expect(res.payload.projects).toHaveLength(1)
    expect(res.payload.items).toHaveLength(1)
    expect(res.payload.general.id).toBe('general')
  })

  it('copes with a board nobody has used yet', async () => {
    const res = await call('board', 'GET')
    expect(res.payload.projects).toEqual([])
    expect(res.payload.items).toEqual([])
  })
})

describe('columns a project names itself', () => {
  it('renames one without moving a task', async () => {
    const { payload: { project } } = await makeProject()
    makeTask({ projectId: project.id, column: 'in_progress' })

    const res = await call('column', 'PATCH', {
      body: { id: project.id, key: 'in_progress', label: 'With Toni' }
    })
    expect(res.payload.project.columns[1]).toMatchObject({
      key: 'in_progress', label: 'With Toni'
    })
    expect(store.items.get('t1').column).toBe('in_progress')
  })

  it('adds one before the finishing column', async () => {
    const { payload: { project } } = await makeProject()
    const res = await call('column', 'POST', {
      body: { id: project.id, label: 'Waiting on supplier' }
    })
    expect(res.payload.project.columns.map(c => c.label))
      .toEqual(['Open', 'In progress', 'Waiting on supplier', 'Done'])
  })

  it('writes the tasks back before it removes the column', async () => {
    // The one board edit that can lose work. A project saved without the
    // column while its tasks still point at it is a board that looks right
    // and is not.
    const { payload: { project } } = await makeProject()
    makeTask({ id: 'a', projectId: project.id, column: 'in_progress' })
    makeTask({ id: 'b', projectId: project.id, column: 'open' })

    const res = await call('column', 'DELETE', {
      body: { id: project.id, key: 'in_progress' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.payload.moved).toBe(1)
    expect(store.items.get('a').column).toBe('open')
    expect(store.items.get('a').status).toBe('open')
    expect(store.items.get('b').column).toBe('open')
  })

  it('refuses to remove the column that means finished', async () => {
    const { payload: { project } } = await makeProject()
    const res = await call('column', 'DELETE', { body: { id: project.id, key: 'done' } })
    expect(res.statusCode).toBe(400)
    expect(res.payload.error).toMatch(/means finished/)
  })

  it('leaves the General list’s columns alone', async () => {
    const res = await call('column', 'POST', { body: { id: 'general', label: 'Anything' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('a task on a board', () => {
  it('moves between columns and keeps its status in step', async () => {
    const { payload: { project } } = await makeProject()
    makeTask({ projectId: project.id })

    const res = await call('task', 'PATCH', { body: { id: 't1', column: 'done' } })
    expect(res.payload.item.column).toBe('done')
    expect(res.payload.item.status).toBe('done')
  })

  it('starts at the beginning when moved to another project', async () => {
    // Its old column may not exist on the new board, and a task silently in a
    // column nobody can see it in is worse than one visibly back at the start.
    const { payload: { project } } = await makeProject()
    const { payload: { project: other } } = await makeProject('Calvary refurb')
    makeTask({ projectId: project.id, column: 'in_progress' })

    const res = await call('task', 'PATCH', { body: { id: 't1', projectId: other.id } })
    expect(res.payload.item.projectId).toBe(other.id)
    expect(res.payload.item.column).toBe('')
  })

  it('goes back to General when the project is cleared', async () => {
    makeTask({ projectId: 'prj-x' })
    const res = await call('task', 'PATCH', { body: { id: 't1', projectId: 'general' } })
    expect(res.payload.item.projectId).toBe('')
  })

  it('refuses a column that is not on its board', async () => {
    const { payload: { project } } = await makeProject()
    makeTask({ projectId: project.id })
    const res = await call('task', 'PATCH', { body: { id: 't1', column: 'invented' } })
    expect(res.statusCode).toBe(400)
  })

  it('says so when the task is not there', async () => {
    const res = await call('task', 'PATCH', { body: { id: 'nope', column: 'done' } })
    expect(res.statusCode).toBe(404)
  })
})

describe('the thread on a task', () => {
  it('appends an update with who and when', async () => {
    makeTask()
    const res = await call('task', 'POST', {
      body: { id: 't1', text: 'Rang them, waiting on a date' }
    })
    expect(res.payload.item.comments).toHaveLength(1)
    expect(res.payload.item.comments[0]).toMatchObject({
      text: 'Rang them, waiting on a date',
      by: 'Erin Smallbon'
    })
  })

  it('keeps the earlier ones', async () => {
    makeTask()
    await call('task', 'POST', { body: { id: 't1', text: 'Rang them' } })
    const res = await call('task', 'POST', { body: { id: 't1', text: 'They rang back' } })
    expect(res.payload.item.comments.map(c => c.text))
      .toEqual(['Rang them', 'They rang back'])
  })

  it('refuses an empty one', async () => {
    makeTask()
    const res = await call('task', 'POST', { body: { id: 't1', text: '  ' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('archive, not delete', () => {
  it('puts a task away and keeps it', async () => {
    makeTask()
    const res = await call('task', 'PATCH', { body: { id: 't1', archive: true } })
    expect(res.payload.item.archived).toBe(true)
    expect(res.payload.item.archivedBy).toBe('Erin Smallbon')
    expect(store.items.get('t1').task).toBe('Chase the Globus paperwork')
  })

  it('brings it back without the archive marks still on it', async () => {
    // updateWorklistItem spreads the stored row under the changes, which
    // would quietly put archivedBy back on a task just taken out.
    makeTask()
    await call('task', 'PATCH', { body: { id: 't1', archive: true } })
    const res = await call('task', 'PATCH', { body: { id: 't1', archive: false } })
    expect(res.payload.item.archived).toBe(false)
    expect(res.payload.item.archivedBy).toBeUndefined()
    expect(store.items.get('t1').archivedBy).toBeUndefined()
  })

  it('will not archive a project with live work in it', async () => {
    const { payload: { project } } = await makeProject()
    makeTask({ projectId: project.id, status: 'open' })
    const res = await call('project', 'PATCH', { body: { id: project.id, archive: true } })
    expect(res.statusCode).toBe(400)
    expect(res.payload.error).toMatch(/1 task on this project/)
  })

  it('lets a finished project go', async () => {
    const { payload: { project } } = await makeProject()
    makeTask({ projectId: project.id, status: 'done' })
    const res = await call('project', 'PATCH', { body: { id: project.id, archive: true } })
    expect(res.statusCode).toBe(200)
    expect(res.payload.project.archived).toBe(true)
  })

  it('refuses to change the General list at all', async () => {
    const res = await call('project', 'PATCH', { body: { id: 'general', name: 'Something' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('what it still refuses', () => {
  it('turns away a method nothing handles', async () => {
    expect((await call('board', 'POST')).statusCode).toBe(405)
    expect((await call('project', 'DELETE')).statusCode).toBe(405)
  })

  it('says so when a project is not there', async () => {
    const res = await call('project', 'PATCH', { body: { id: 'prj-nope', name: 'X' } })
    expect(res.statusCode).toBe(404)
  })

  it('keeps the old worklist action working', async () => {
    // Nothing is migrated. Anything still calling the old shape has to keep
    // getting the old answer.
    makeTask()
    const res = await call('worklist', 'GET')
    expect(res.payload.items).toHaveLength(1)
  })
})
