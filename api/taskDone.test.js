import { describe, it, expect } from 'vitest'
import { twinTasks, matchingWorklistItems, matchingCalendarTasks, withDone } from './_taskDone.js'
import { settleCopies } from '../src/clinicalPlan/tasks.js'

// "I have completed that task and it shows as completed on the Monday, however
// still lists it as an item to complete for Tuesday." Made-up tasks only.

const ev = (id, what, who, extra = '') => ({
  id, summary: `TASK: ${what}`, start: { date: id === 'mon' ? '2026-11-02' : '2026-11-03' },
  description: `Task: Something else\nItem: ${what}\nFor: ${who}\n\nAdded by Toni${extra}`
})

describe('copies of the same task', () => {
  it('are the same words for the same person', () => {
    const mon = ev('mon', 'Convert the software subscription to annual', 'Brent')
    const events = [mon,
      ev('tue', 'Convert the software subscription to annual', 'Brent'),
      ev('x', 'Convert the software subscription to annual', 'Mat'),
      ev('y', 'Convert the other subscription to annual', 'Brent')]
    const task = { what: 'Convert the software subscription to annual', who: 'Brent' }
    expect(twinTasks(events, 'mon', task).map(e => e.id)).toEqual(['tue'])
  })

  it('show as done on every day once one is ticked', () => {
    const days = settleCopies([
      { date: '2026-11-02', tasks: [{ what: 'Order the brochures', who: 'Toni', done: true, doneBy: 'Toni', doneOn: '2026-11-02', date: '2026-11-02' }] },
      { date: '2026-11-03', tasks: [{ what: 'Order the brochures', who: 'Toni', done: false, date: '2026-11-03' },
        { what: 'Order the brochures', who: 'Ben', done: false, date: '2026-11-03' }] }
    ])
    expect(days[1].tasks[0]).toMatchObject({ done: true, doneBy: 'Toni', doneElsewhere: '2026-11-02' })
    expect(days[1].tasks[1].done).toBe(false)
  })

  it('swaps the done line rather than stacking them', () => {
    const once = withDone('Item: x\n\nDone by Toni on 2026-11-01', true, 'Brent', '2026-11-02')
    expect(once.match(/Done by/g)).toHaveLength(1)
    expect(once).toMatch(/Done by Brent on 2026-11-02$/)
    expect(withDone(once, false)).not.toMatch(/Done by/)
  })
})

describe('the project list', () => {
  const items = [
    { id: '1', task: 'Brenton to convert Dropbox subscription from monthly to annual', assignee: 'Brenton Lovering', status: 'open' },
    { id: '2', task: 'Brenton to convert Dropbox subscription from monthly to annual', assignee: 'Mat Usher', status: 'open' },
    { id: '3', task: 'Convert the Xero subscription', assignee: 'Brenton Lovering', status: 'open' },
    { id: '4', task: 'Brenton to convert Dropbox subscription from monthly to annual', assignee: 'Brenton Lovering', status: 'done' }
  ]

  it('closes the item that is this task, for this person, and nothing else', () => {
    const task = { what: 'Brenton to convert Dropbox subscription from monthly to annual', who: 'Brent' }
    expect(matchingWorklistItems(items, task).map(i => i.id)).toEqual(['1'])
  })

  it('and a project item ticked off finds its calendar copies', () => {
    const events = [ev('mon', 'Brenton to convert Dropbox subscription from monthly to annual', 'Brent'),
      ev('tue', 'Brenton to convert Dropbox subscription from monthly to annual', 'Brent', '\n\nDone by Brent on 2026-11-01')]
    expect(matchingCalendarTasks(events, items[0]).map(e => e.id)).toEqual(['mon'])
  })
})
