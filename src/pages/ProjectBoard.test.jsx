import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import React from 'react'
import Projects from './Projects.jsx'
import { DEFAULT_COLUMNS } from '../projects/model.js'

// ─── A true project page ─────────────────────────────────────────────────────
// "Can you build the task/project section out to be more comprehensive. We want
// it similar to monday.com as a true project page."
//
// The flat list worked for what it was built for — a meeting produces actions,
// the actions go on a board — and stopped working the moment more than one
// thing was going on at once, which is always.

const USER = { name: 'Erin Smallbon', email: 'erin@technomed.com.au', token: 'tok' }

const PROJECT = {
  id: 'prj-1',
  name: 'Globus onboarding',
  owner: 'Toni Hoppitt',
  due: '2026-11-30',
  colour: 'teal',
  columns: DEFAULT_COLUMNS,
  archived: false
}

const ITEMS = [
  {
    id: 'a', task: 'Get Mat credentialled', assignee: 'Toni Hoppitt',
    status: 'done', column: 'done', priority: 'normal', due_date: '', projectId: 'prj-1'
  },
  {
    id: 'b', task: 'Book the first case', assignee: 'Erin Smallbon',
    status: 'open', column: 'open', priority: 'urgent', due_date: '2026-10-09',
    projectId: 'prj-1'
  },
  {
    id: 'c', task: 'Get the Athlet tray back from RHH', assignee: 'Erin Smallbon',
    status: 'open', priority: 'normal', due_date: ''
  }
]

let sent

const reply = (url, init) => {
  const at = String(url)
  sent.push({ url: at, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null })
  if (at.includes('action=board')) {
    return { ok: true, json: async () => ({ items: ITEMS, projects: [PROJECT] }) }
  }
  if (at.includes('action=task')) {
    const body = init?.body ? JSON.parse(init.body) : {}
    const row = ITEMS.find(i => i.id === body.id)
    return { ok: true, json: async () => ({ item: { ...row, ...body } }) }
  }
  if (at.includes('action=project') || at.includes('action=column')) {
    return { ok: true, json: async () => ({ project: PROJECT }) }
  }
  return { ok: true, json: async () => ({ ok: true }) }
}

/**
 * A phone, explicitly.
 *
 * jsdom reports an innerWidth of 1024, which is over this app's desktop
 * threshold — so every one of these ran against the desktop layout by default
 * and said nothing about the screen most of them are read on.
 */
const widthOf = px => {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true })
  window.matchMedia = q => ({
    matches: px >= 1024, media: q,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}
  })
}

beforeEach(() => {
  sent = []
  widthOf(390)
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-13T02:00:00.000Z'))
  global.fetch = vi.fn(async (url, init) => reply(url, init))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const show = async () => {
  render(<Projects user={USER} onBack={() => {}} />)
  await waitFor(() => expect(screen.getByText('Globus onboarding')).toBeInTheDocument())
}

const openBoard = async () => {
  await show()
  fireEvent.click(screen.getByText('Globus onboarding'))
  await waitFor(() => expect(screen.getByPlaceholderText('Add a task…')).toBeInTheDocument())
}

describe('what the page opens on', () => {
  it('opens on the projects, not the recorder', async () => {
    // It used to open on a Start recording button, every time anybody looked
    // at their to-do list.
    await show()
    expect(screen.getByText('Globus onboarding')).toBeInTheDocument()
    expect(screen.queryByText('New meeting')).not.toBeInTheDocument()
  })

  it('asks for the whole board in one request', async () => {
    // Progress, counts and which-column all need the projects and the tasks
    // together, and two round trips on hospital wifi is the difference between
    // instant and visibly slow.
    await show()
    expect(sent.filter(c => c.url.includes('action=board'))).toHaveLength(1)
  })

  it('says how far through each project is', async () => {
    await show()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('always shows General, where everything else lives', async () => {
    // Every task written before projects existed is one of these. A board
    // without it would look empty to anybody who had been using the old list.
    await show()
    expect(screen.getByText('General')).toBeInTheDocument()
  })

  it('names the owner and what is left', async () => {
    // Scoped to the one row: General has one to do as well, and an unscoped
    // match would pass whichever row it happened to find.
    await show()
    const row = screen.getByText('Globus onboarding').closest('button')
    expect(within(row).getByText('Toni Hoppitt')).toBeInTheDocument()
    expect(within(row).getByText('1 to do')).toBeInTheDocument()
  })
})

describe('one project’s board', () => {
  it('opens on the first column', async () => {
    await openBoard()
    expect(screen.getByText('Book the first case')).toBeInTheDocument()
  })

  it('shows one column at a time on a phone, with the counts', async () => {
    // Six columns across 390 points is six slivers. The chips carry the counts
    // so nothing is hidden by being off screen.
    await openBoard()
    expect(screen.getByText('Open · 1')).toBeInTheDocument()
    expect(screen.getByText('Done · 1')).toBeInTheDocument()
  })

  it('swaps column when a chip is tapped', async () => {
    await openBoard()
    expect(screen.queryByText('Get Mat credentialled')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Done · 1'))
    expect(screen.getByText('Get Mat credentialled')).toBeInTheDocument()
    expect(screen.queryByText('Book the first case')).not.toBeInTheDocument()
  })

  it('leaves other projects’ tasks off it', async () => {
    await openBoard()
    fireEvent.click(screen.getByText('Done · 1'))
    expect(screen.queryByText('Get the Athlet tray back from RHH')).not.toBeInTheDocument()
  })

  it('moves a task on with the arrow, one-handed', async () => {
    // Dragging on a phone fights with scrolling and loses, and a task that
    // will not drop is a task somebody gives up on.
    await openBoard()
    fireEvent.click(screen.getByLabelText(/Move Book the first case on to In progress/))
    await waitFor(() => expect(
      sent.some(c => c.url.includes('action=task') && c.body?.column === 'in_progress')).toBe(true))
  })

  it('has no arrow back from the first column', async () => {
    await openBoard()
    expect(screen.getByLabelText('No column back')).toBeDisabled()
  })

  it('marks what is overdue in days, not just in red', async () => {
    // "3 days late" is a fact somebody acts on; red text is a decoration
    // people stop seeing after a fortnight.
    await openBoard()
    expect(screen.getByText('4 days late')).toBeInTheDocument()
  })
})

describe('a task, opened', () => {
  const openTask = async () => {
    await openBoard()
    fireEvent.click(screen.getByText('Book the first case'))
    await waitFor(() => expect(screen.getByText('Updates')).toBeInTheDocument())
  }

  it('offers a thread, which is where the history goes', async () => {
    // "So the history lives with the work instead of in WhatsApp."
    await openTask()
    expect(screen.getByPlaceholderText(/Rang them, waiting on a date/)).toBeInTheDocument()
  })

  it('posts an update rather than editing the task', async () => {
    await openTask()
    fireEvent.change(screen.getByPlaceholderText(/Rang them, waiting on a date/),
      { target: { value: 'Rang them, waiting on a date' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => {
      const call = sent.find(c => c.method === 'POST' && c.url.includes('action=task'))
      expect(call?.body?.text).toBe('Rang them, waiting on a date')
    })
  })

  it('will not post an empty update', async () => {
    await openTask()
    expect(screen.getByText('Add')).toBeDisabled()
  })

  it('archives rather than deleting, on the first tap', async () => {
    // The board header has an Archive too — that one puts the whole project
    // away. This is the task's.
    await openTask()
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Archive'))
    await waitFor(() => expect(
      sent.some(c => c.url.includes('action=task') && c.body?.archive === true)).toBe(true))
  })

  it('asks twice before it really deletes', async () => {
    // Archiving keeps it. Deleting cannot be undone, so it is two taps and
    // says so.
    await openTask()
    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText('Delete for good')).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument()
    expect(sent.some(c => c.method === 'DELETE')).toBe(false)
  })

  it('deletes on the second', async () => {
    await openTask()
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Delete for good'))
    await waitFor(() => expect(sent.some(c => c.method === 'DELETE')).toBe(true))
  })

  it('can move the task to another project', async () => {
    await openTask()
    const picker = screen.getByDisplayValue('Globus onboarding')
    fireEvent.change(picker, { target: { value: 'general' } })
    await waitFor(() => expect(
      sent.some(c => c.body?.projectId === 'general')).toBe(true))
  })
})

describe('my own list, across everything', () => {
  const openMine = async () => {
    await show()
    fireEvent.click(screen.getByRole('tab', { name: /Mine/ }))
    await waitFor(() =>
      expect(screen.getByText('Book the first case')).toBeInTheDocument())
  }

  it('gathers my tasks under the work they belong to', async () => {
    // "Four things" is a to-do list; "four things from four different pieces
    // of work" is one you can act on.
    await openMine()
    expect(screen.getByText('Book the first case')).toBeInTheDocument()
    expect(screen.getByText('Get the Athlet tray back from RHH')).toBeInTheDocument()
  })

  it('leaves out what belongs to somebody else', async () => {
    await openMine()
    expect(screen.queryByText('Get Mat credentialled')).not.toBeInTheDocument()
  })

  it('ticks a task off into whatever its board calls finished', async () => {
    await openMine()
    fireEvent.click(screen.getByLabelText('Tick off Book the first case'))
    await waitFor(() => expect(
      sent.some(c => c.url.includes('action=task') && c.body?.column === 'done')).toBe(true))
  })

  it('still offers Erin the whole board', async () => {
    // Keeping track of what is being completed is half the point, and she
    // cannot do it from four things that happen to be hers.
    await openMine()
    fireEvent.click(screen.getByText('Everyone · 3'))
    expect(screen.getByText('Get Mat credentialled')).toBeInTheDocument()
  })
})

describe('what it refuses to lose', () => {
  it('keeps an archived task off the board', async () => {
    global.fetch = vi.fn(async url => {
      if (String(url).includes('action=board')) {
        return {
          ok: true,
          json: async () => ({
            items: [{ ...ITEMS[1], archived: true }],
            projects: [PROJECT]
          })
        }
      }
      return { ok: true, json: async () => ({}) }
    })
    render(<Projects user={USER} onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText('Globus onboarding')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Globus onboarding'))
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Add a task…')).toBeInTheDocument())
    expect(screen.queryByText('Book the first case')).not.toBeInTheDocument()
  })

  it('puts the error on screen when a change does not save', async () => {
    await openBoard()
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ error: 'Upstash is having a moment' })
    }))
    fireEvent.click(screen.getByLabelText(/Move Book the first case on to In progress/))
    await waitFor(() =>
      expect(screen.getByText(/Upstash is having a moment/)).toBeInTheDocument())
  })

  it('goes back to the projects from a board', async () => {
    // "There can't be situations when you get stuck in a part of the app."
    // By its exact label: the ‹ arrows on every card are also "back".
    await openBoard()
    fireEvent.click(screen.getByLabelText('Back'))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Projects/ })).toBeInTheDocument())
  })
})

describe('making one', () => {
  it('offers a form with a name, an owner, a date and a colour', async () => {
    await show()
    fireEvent.click(screen.getByText('+ New project'))
    expect(screen.getByPlaceholderText('e.g. Globus onboarding')).toBeInTheDocument()
    expect(screen.getByLabelText('Who owns it')).toBeInTheDocument()
    expect(screen.getByLabelText('Due by')).toBeInTheDocument()
    expect(screen.getByLabelText('teal colour')).toBeInTheDocument()
  })

  it('will not make one with no name', async () => {
    await show()
    fireEvent.click(screen.getByText('+ New project'))
    expect(screen.getByText('Create it')).toBeDisabled()
  })

  it('sends what was filled in', async () => {
    await show()
    fireEvent.click(screen.getByText('+ New project'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Globus onboarding'),
      { target: { value: 'Calvary refurb' } })
    fireEvent.click(screen.getByText('Create it'))
    await waitFor(() => {
      const call = sent.find(c => c.method === 'POST' && c.url.includes('action=project'))
      expect(call?.body?.name).toBe('Calvary refurb')
    })
  })
})

// ─── The same board on a desktop ─────────────────────────────────────────────
// "We've gotta keep it consistent across both versions." Same data, same order,
// same rules — the difference is how much glass there is, which is the split
// the case views already make.
describe('the board on a desktop', () => {
  it('puts the columns side by side, which is what the width is for', async () => {
    widthOf(1680)
    await openBoard()
    // Everything at once: no chips to tap, and both columns' tasks on screen.
    expect(screen.getByText('Book the first case')).toBeInTheDocument()
    expect(screen.getByText('Get Mat credentialled')).toBeInTheDocument()
    expect(screen.queryByText('Open · 1')).not.toBeInTheDocument()
  })

  it('names each column with its count', async () => {
    widthOf(1680)
    await openBoard()
    expect(screen.getByText('In progress')).toBeInTheDocument()
  })

  it('offers somewhere to add a column', async () => {
    // Renaming and adding are a desktop job — it is where a board gets set up.
    widthOf(1680)
    await openBoard()
    expect(screen.getByPlaceholderText('+ Add a column')).toBeInTheDocument()
  })

  it('sends the new column', async () => {
    widthOf(1680)
    await openBoard()
    const box = screen.getByPlaceholderText('+ Add a column')
    fireEvent.change(box, { target: { value: 'Waiting on supplier' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => {
      const call = sent.find(c => c.url.includes('action=column') && c.method === 'POST')
      expect(call?.body?.label).toBe('Waiting on supplier')
    })
  })

  it('still moves a task with the arrows, same as the phone', async () => {
    widthOf(1680)
    await openBoard()
    fireEvent.click(screen.getByLabelText(/Move Book the first case on to In progress/))
    await waitFor(() => expect(
      sent.some(c => c.url.includes('action=task') && c.body?.column === 'in_progress')).toBe(true))
  })
})
