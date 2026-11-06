import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MyToDo, { toDoSections, todayTally } from './MyToDo.jsx'

// Brent, 6 Nov 2026: the phone's projects page opens on "Ben's To Do", with
// check-boxes ready to tick off.
const TODAY = '2026-11-06'
const t = (id, task, due_date, extra = {}) => ({ id, task, due_date, status: 'open', ...extra })
const TASKS = [
  t('a', 'Reply to the supplier', '2026-11-04'),
  t('b', 'Count the tray', TODAY, { comments: [{ text: 'x' }, { text: 'y' }] }),
  t('c', 'Book the recount', '2026-11-10'),
  t('d', 'Plan next quarter', '2026-12-01'),
  t('e', 'Whenever', ''),
  t('f', 'Set up Face ID', TODAY, { status: 'done', doneAt: `${TODAY}T01:00:00Z` }),
  t('g', 'Finished last week', '2026-10-30', { status: 'done', doneAt: '2026-10-30T01:00:00Z' })
]

describe('the sections', () => {
  it('sorts by when it is due, and keeps only what was ticked today', () => {
    const s = toDoSections(TASKS, TODAY)
    expect(s.map(x => [x.label, x.tasks.map(y => y.id)])).toEqual([
      ['Overdue', ['a']], ['Today', ['b']], ['This week', ['c']], ['Later', ['d']], ['No date', ['e']], ['Done today', ['f']]
    ])
  })
  it('counts today as overdue plus due today plus done today', () => {
    expect(todayTally(toDoSections(TASKS, TODAY))).toEqual({ done: 1, total: 3 })
  })
})

describe('the list', () => {
  const show = (props = {}) => render(
    <MyToDo name="Ben" tasks={TASKS} today={TODAY}
      projectFor={() => ({ name: 'General' })} tintFor={() => ({ solid: 'grey' })}
      onTick={() => {}} onOpenTask={() => {}} quickAdd={null} {...props} />)

  it('is the person’s own list, with what is left today', () => {
    show()
    expect(screen.getByRole('heading', { name: "Ben's To Do" })).toBeInTheDocument()
    expect(screen.getByText(/2 left today/)).toBeInTheDocument()
  })
  it('ticks with one tap', () => {
    const onTick = vi.fn()
    show({ onTick })
    fireEvent.click(screen.getByRole('button', { name: 'Done: Count the tray' }))
    expect(onTick).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })
  it('opens the task, where its notes are', () => {
    const onOpenTask = vi.fn()
    show({ onOpenTask })
    expect(screen.getByLabelText('2 notes')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Count the tray'))
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })
})
