import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import TeamLeader from './TeamLeader.jsx'
import { GUIDE, RUNSHEET_ITEMS, RUNSHEET_TAB } from '../teamLeader/guide.js'

// The Clinical Team Leader field guide, brought in from the co-written "TM Team
// Leader" artifact. Two separate things to hold: that the content is all here
// and unmangled, and that the day's run-sheet behaves like shared state.

const USER = {
  name: 'Ben Cassidy', email: 'ben@technomed.com.au', token: 'tok',
  staff: { firstName: 'Ben' }
}

let ticks

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-21T02:00:00.000Z')) // midday in Hobart
  ticks = {}
  global.fetch = vi.fn(async (url, init) => {
    if (init?.method === 'POST') {
      const { itemId, done } = JSON.parse(init.body)
      if (done === false) delete ticks[itemId]
      else ticks[itemId] = { by: 'Ben', at: '2026-09-21T02:00:00.000Z' }
    }
    return { json: async () => ({ date: '2026-09-21', ticks: { ...ticks } }) }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const show = () => render(<TeamLeader user={USER} />)

describe('the guide itself', () => {
  it('carries all eight sections of the artifact', () => {
    expect(GUIDE.map(t => t.id)).toEqual(
      ['today', 'purpose', 'booking', 'lists', 'restock', 'groups', 'cover', 'rules'])
  })

  it('carries no HTML, only structured runs', () => {
    // The artifact is shared with the organisation and co-written. Rendering its
    // markup would turn an edit to a shared document into script running inside
    // the staff portal; runs cannot carry markup at all.
    const everything = JSON.stringify(GUIDE)
    expect(everything).not.toMatch(/<[a-z]+[\s>]/i)
    expect(everything).not.toMatch(/&lt;|&amp;|&quot;/)
  })

  it('renders no raw HTML either', () => {
    const source = TeamLeader.toString()
    expect(source).not.toMatch(/dangerouslySetInnerHTML/)
  })

  it('has a stable id for every run-sheet item', () => {
    // The ids are Redis field names. Duplicates would make two duties share one
    // tick, which on a checklist is a silent and dangerous failure.
    expect(new Set(RUNSHEET_ITEMS).size).toBe(RUNSHEET_ITEMS.length)
    expect(RUNSHEET_ITEMS).toHaveLength(16)
    for (const id of RUNSHEET_ITEMS) expect(id).toMatch(/^[a-z0-9-]+$/)
  })
})

describe('reading the guide', () => {
  it('opens on the run-sheet, which is what the role is for', async () => {
    show()
    expect(await screen.findByText('Today')).toBeInTheDocument()
    expect(screen.getByText(/Work down this list through the day/)).toBeInTheDocument()
  })

  it('shows the evening sweep at 7pm, as the team amended it', async () => {
    // The co-writers moved it from 10pm. Worth an assertion of its own: it is
    // the single thing that changed between the version on disk and the live
    // artifact, and porting the stale time would have published a wrong duty.
    show()
    await screen.findByText('Evening sweep')
    expect(screen.getByText('7:00pm')).toBeInTheDocument()
    expect(screen.queryByText('10:00pm')).not.toBeInTheDocument()
  })

  it('moves between sections', async () => {
    show()
    fireEvent.click(await screen.findByRole('tab', { name: /Coverage/ }))
    expect(await screen.findByText('Who covers what')).toBeInTheDocument()
    // The competency matrix, which is the part people actually look up.
    expect(screen.getByText('AIRO / Nav')).toBeInTheDocument()
  })

  it('keeps the coverage matrix readable without scrolling the page sideways', async () => {
    const { container } = show()
    fireEvent.click(await screen.findByRole('tab', { name: /Coverage/ }))
    await screen.findByText('Who covers what')
    const table = container.querySelector('table')
    expect(table.parentElement.style.overflowX).toBe('auto')
  })

  it('shows the WhatsApp groups and which are case inflow', async () => {
    show()
    fireEvent.click(await screen.findByRole('tab', { name: /WhatsApp/ }))
    expect(await screen.findByText('Technomed Neuro')).toBeInTheDocument()
    expect(screen.getAllByText('Case inflow').length).toBeGreaterThan(1)
  })

  it('keeps emphasis inside a callout', async () => {
    show()
    fireEvent.click(await screen.findByRole('tab', { name: /New Booking/ }))
    expect(await screen.findByText("When Toni's not in the office:")).toBeInTheDocument()
  })
})

describe('the shared run-sheet', () => {
  it('counts the day down, and says the count is everyone\'s', async () => {
    show()
    expect(await screen.findByText(/0 of 16 done today/)).toBeInTheDocument()
    expect(screen.getByText(/Everyone sees this/)).toBeInTheDocument()
  })

  it('ticks an item and records who did it', async () => {
    show()
    const item = await screen.findByText('Reconcile everything against the calendar')
    fireEvent.click(item)
    await waitFor(() => expect(screen.getByText(/1 of 16 done today/)).toBeInTheDocument())
    // The name is the point of sharing it.
    await waitFor(() => expect(screen.getByText(/^Ben ·/)).toBeInTheDocument())
  })

  it('unticks', async () => {
    show()
    const item = await screen.findByText('Reconcile everything against the calendar')
    fireEvent.click(item)
    await waitFor(() => expect(screen.getByText(/1 of 16 done today/)).toBeInTheDocument())
    fireEvent.click(item)
    await waitFor(() => expect(screen.getByText(/0 of 16 done today/)).toBeInTheDocument())
  })

  it('picks up a tick someone else made, without a reload', async () => {
    // The whole reason this is shared rather than local. The duty leader ticks
    // the evening sweep on their phone; anyone else watching sees it.
    show()
    await screen.findByText(/0 of 16 done today/)
    ticks[RUNSHEET_ITEMS[0]] = { by: 'Mat', at: '2026-09-21T02:00:00.000Z' }
    await vi.advanceTimersByTimeAsync(61000)
    await waitFor(() => expect(screen.getByText(/1 of 16 done today/)).toBeInTheDocument())
    expect(screen.getByText(/^Mat ·/)).toBeInTheDocument()
  })

  it('puts a tick back if it did not save', async () => {
    // A tick that looks saved and is not is worse than one that visibly failed:
    // the next person reads it as the job being done.
    show()
    const item = await screen.findByText('Reconcile everything against the calendar')
    global.fetch = vi.fn(async () => ({ json: async () => ({ error: 'Redis unreachable' }) }))
    fireEvent.click(item)
    await waitFor(() => expect(screen.getByText(/did not save/)).toBeInTheDocument())
    expect(screen.getByText(/0 of 16 done today/)).toBeInTheDocument()
  })

  it('keeps the day when a poll fails', async () => {
    show()
    const item = await screen.findByText('Reconcile everything against the calendar')
    fireEvent.click(item)
    await waitFor(() => expect(screen.getByText(/1 of 16 done today/)).toBeInTheDocument())

    // The wifi drops mid-corridor. Blanking the ticks would read as the work
    // being undone.
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    await vi.advanceTimersByTimeAsync(61000)
    expect(screen.getByText(/1 of 16 done today/)).toBeInTheDocument()
  })
})

describe('the new-booking checklist', () => {
  it('does not write to the shared day', async () => {
    // It is a definition of done for *one booking*, and several run through it
    // before lunch. Sharing it, or keeping it overnight, would both be wrong.
    show()
    fireEvent.click(await screen.findByRole('tab', { name: /New Booking/ }))
    const step = await screen.findByText('1 · Calendar entry — first, always')
    const before = global.fetch.mock.calls.length
    fireEvent.click(step)
    await waitFor(() => expect(step.closest('[role="checkbox"]').getAttribute('aria-checked')).toBe('true'))
    // Ticked on screen, and nothing sent.
    expect(global.fetch.mock.calls.length).toBe(before)
  })

  it('is not counted in the day\'s run-sheet', async () => {
    show()
    fireEvent.click(await screen.findByRole('tab', { name: /New Booking/ }))
    fireEvent.click(await screen.findByText('1 · Calendar entry — first, always'))
    fireEvent.click(screen.getByRole('tab', { name: /Today/ }))
    expect(await screen.findByText(/0 of 16 done today/)).toBeInTheDocument()
  })
})

describe('the run-sheet tab', () => {
  it('is the one the shared ticks belong to', () => {
    expect(RUNSHEET_TAB).toBe('today')
    const tab = GUIDE.find(t => t.id === RUNSHEET_TAB)
    expect(tab.blocks.filter(b => b.type === 'check')).toHaveLength(16)
  })
})
