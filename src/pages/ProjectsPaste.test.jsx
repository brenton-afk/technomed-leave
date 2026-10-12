import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import Projects from './Projects.jsx'

// ─── Dumping things into the projects tab ────────────────────────────────────
// "Can you make those tabs interactive so Erin can dump data into them and
// build project lists within the portal? For example, could she dump a
// transcript from a meeting into that section and have the Claude agent within
// the portal build out a task and action list and allocate to staff?"
//
// Most of it already worked: the extraction takes raw text and matches names
// against the real staff list, and the review screen already let somebody edit
// the wording, reassign it, change priority and date, or delete it. What it had
// no way of was getting text in without holding the meeting again into a phone.
//
// So a recording is now one of three ways in — and all three end up on the same
// review screen, which is the only place an item is checked before it lands on
// somebody's day.

const USER = { name: 'Erin Smallbon', email: 'erin@technomed.com.au', token: 'tok' }

let calls

beforeEach(() => {
  calls = []
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
    if (String(url).includes('action=worklist')) {
      return { ok: true, json: async () => ({ items: [] }) }
    }
    if (String(url).includes('action=analyze')) {
      return {
        ok: true,
        json: async () => ({
          meetingId: 'm1',
          summary: 'Agreed to chase the Globus paperwork.',
          actionItems: [{
            task: 'Chase the Globus paperwork',
            assignee: 'Toni Hoppitt',
            priority: 'normal',
            due_date: '',
            notes: 'Raised again on Monday.'
          }]
        })
      }
    }
    if (String(url).includes('action=add-task')) {
      return { ok: true, json: async () => ({ ok: true, item: {} }) }
    }
    return { ok: true, json: async () => ({}) }
  })
})
afterEach(() => vi.restoreAllMocks())

const open = async () => {
  render(<Projects user={USER} onBack={() => {}} />)
  await waitFor(() => expect(screen.getByText('New meeting')).toBeInTheDocument())
}

describe('pasting what was said', () => {
  it('offers somewhere to paste it', async () => {
    await open()
    expect(screen.getByPlaceholderText(/Paste a transcript/i)).toBeInTheDocument()
  })

  it('will not send nothing', async () => {
    await open()
    const button = screen.getByText('Build the action list')
    expect(button).toBeDisabled()
  })

  it('sends the words to the same agent the recording uses', async () => {
    await open()
    fireEvent.change(screen.getByPlaceholderText(/Paste a transcript/i),
      { target: { value: 'Toni to chase the Globus paperwork this week.' } })
    fireEvent.click(screen.getByText('Build the action list'))

    await waitFor(() => expect(
      calls.some(c => c.url.includes('action=analyze'))).toBe(true))
    const analyze = calls.find(c => c.url.includes('action=analyze'))
    expect(analyze.body.transcript).toMatch(/Globus paperwork/)
  })

  it('lands on the review screen, not straight on the board', async () => {
    // The gate. Nothing reaches somebody's day unreviewed — transcription and
    // extraction both mishear names and dates, and a wrong task gets acted on.
    await open()
    fireEvent.change(screen.getByPlaceholderText(/Paste a transcript/i),
      { target: { value: 'Toni to chase the Globus paperwork.' } })
    fireEvent.click(screen.getByText('Build the action list'))

    await waitFor(() =>
      expect(screen.getByText('Review before sending')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Chase the Globus paperwork')).toBeInTheDocument()
  })

  it('allocates to a real person, editable before it goes', async () => {
    await open()
    fireEvent.change(screen.getByPlaceholderText(/Paste a transcript/i),
      { target: { value: 'Toni to chase the Globus paperwork.' } })
    fireEvent.click(screen.getByText('Build the action list'))

    await waitFor(() =>
      expect(screen.getByText('Review before sending')).toBeInTheDocument())
    // A dropdown of the real staff list, set to whoever the agent matched.
    expect(screen.getByDisplayValue('Toni Hoppitt')).toBeInTheDocument()
  })

  it('names it something findable when it came from a paste', async () => {
    await open()
    fireEvent.change(screen.getByPlaceholderText(/Paste a transcript/i),
      { target: { value: 'Something was agreed.' } })
    fireEvent.click(screen.getByText('Build the action list'))

    await waitFor(() => expect(
      calls.some(c => c.url.includes('action=analyze'))).toBe(true))
    const analyze = calls.find(c => c.url.includes('action=analyze'))
    expect(analyze.body.meetingTitle).toBeTruthy()
  })
})

describe('a task nobody held a meeting about', () => {
  it('offers a plain row to type one in', async () => {
    await open()
    expect(screen.getByPlaceholderText('Add a task…')).toBeInTheDocument()
  })

  it('keeps the rest out of the way until there is something to add', async () => {
    await open()
    expect(screen.queryByText('Add')).not.toBeInTheDocument()
  })

  it('sends it straight to the board, with no agent in between', async () => {
    // Whoever typed it is the review. There is nothing for a model to extract
    // from a sentence somebody has already written as a task.
    await open()
    fireEvent.change(screen.getByPlaceholderText('Add a task…'),
      { target: { value: 'Get the Athlet tray back from RHH' } })
    fireEvent.click(await screen.findByText('Add'))

    await waitFor(() => expect(
      calls.some(c => c.url.includes('action=add-task'))).toBe(true))
    const added = calls.find(c => c.url.includes('action=add-task'))
    expect(added.body.task).toBe('Get the Athlet tray back from RHH')
    expect(calls.some(c => c.url.includes('action=analyze'))).toBe(false)
  })
})

describe('the file path', () => {
  const source = readFileSync(join(__dirname, 'Projects.jsx'), 'utf8')

  it('offers a file as well as a paste', async () => {
    await open()
    expect(screen.getByText('Or a file')).toBeInTheDocument()
    expect(screen.getByText('.txt, .docx or .pdf')).toBeInTheDocument()
  })

  it('reads it on the server, then takes the same road as a paste', () => {
    // jsdom has no FileReader worth driving, so this reads the source: the
    // file goes to read-file and its text goes to readFromText, which is the
    // same function the textarea calls.
    const fn = source.slice(source.indexOf('async function readFromFile'))
    const body = fn.slice(0, fn.indexOf('\n  }'))
    expect(body).toMatch(/action=read-file/)
    expect(body).toMatch(/readFromText\(body\.text/)
  })

  it('names the meeting after the file', () => {
    // "Pasted notes" is no use in a month when somebody is looking for what
    // was agreed.
    const fn = source.slice(source.indexOf('async function readFromFile'))
    expect(fn.slice(0, fn.indexOf('\n  }'))).toMatch(/file\.name\.replace/)
  })
})

// ─── A to-do list has to be somebody's ───────────────────────────────────────
// "The portal becomes a single source of truth for projects and actions — this
// will enable Erin to keep track of items being completed and also give staff a
// centralised location for their to do lists."
//
// Those are two screens of one set of data. Erin needs the whole board to see
// what is moving; everybody else needs the four things that are theirs, and a
// board of forty items belonging to nine people is not a to-do list — it is a
// reason to keep using a notebook.
describe('whose list it is', () => {
  const board = [
    { id: '1', task: 'Chase the Globus paperwork', assignee: 'Erin Smallbon', priority: 'normal', status: 'open' },
    { id: '2', task: 'Get the Athlet tray back', assignee: 'Ben Cassidy', priority: 'normal', status: 'open' },
    { id: '3', task: 'Book the in-service', assignee: 'Erin Smallbon', priority: 'normal', status: 'done' }
  ]

  const openBoard = async () => {
    global.fetch = vi.fn(async url => {
      if (String(url).includes('action=worklist')) {
        return { ok: true, json: async () => ({ items: board }) }
      }
      return { ok: true, json: async () => ({}) }
    })
    render(<Projects user={USER} onBack={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText('Chase the Globus paperwork')).toBeInTheDocument())
  }

  it('opens on mine, which is what somebody between cases came for', async () => {
    await openBoard()
    expect(screen.getByText('Chase the Globus paperwork')).toBeInTheDocument()
    expect(screen.queryByText('Get the Athlet tray back')).not.toBeInTheDocument()
  })

  it('counts only what is still to do', async () => {
    // Three items, two mine, one of those already done.
    await openBoard()
    expect(screen.getByText('Mine · 1')).toBeInTheDocument()
    expect(screen.getByText('Everyone · 3')).toBeInTheDocument()
  })

  it('shows the whole board when asked, which is Erin’s view', async () => {
    await openBoard()
    fireEvent.click(screen.getByText('Everyone · 3'))
    expect(screen.getByText('Get the Athlet tray back')).toBeInTheDocument()
    expect(screen.getByText('Chase the Globus paperwork')).toBeInTheDocument()
  })

  it('still shows what is finished, so progress is visible', async () => {
    // Erin keeping track of items being completed is half the point; a done
    // item that disappears answers nothing.
    await openBoard()
    expect(screen.getByText('Book the in-service')).toBeInTheDocument()
  })

  it('is mine by assignment, not by who typed it', async () => {
    // Somebody who pastes a transcript is not thereby responsible for
    // everything in it.
    const source = readFileSync(join(__dirname, 'Projects.jsx'), 'utf8')
    expect(source).toMatch(/it\.assignee === user\?\.name/)
  })
})
