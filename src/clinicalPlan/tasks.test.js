import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  TASK_KINDS, TASK_PREFIX, taskSummary, taskDescription, readTask, isTask,
  doneLine, taskThings, kindFor
} from './tasks.js'
import { readBooking } from './parse.js'
import { buildWeekPlan } from './buildWeekPlan.js'

// ─── Jobs that are not operations ────────────────────────────────────────────
// "We need to add an extra button to the portal for 'add task' — this could be
// transfer of a kit, or a reminder to restock, or a reminder to get a tray back
// from RHH. These reminders are important and need to be really easy to add to
// the day so everyone can see them. It needs to be easier than adding a task in
// Google Calendar, which is a bit clunky and relies on a lot of text entry."

describe('the three jobs Brent named', () => {
  it('writes a kit transfer the way somebody would say it', () => {
    expect(taskSummary({ kind: 'move', thing: 'Mariner', from: 'RHH', to: 'Calvary' }))
      .toBe('TASK: Move Mariner from RHH to Calvary')
  })

  it('writes a tray coming back', () => {
    expect(taskSummary({ kind: 'return', thing: 'Athlet', from: 'RHH' }))
      .toBe('TASK: Get Athlet back from RHH')
  })

  it('writes a restock', () => {
    expect(taskSummary({ kind: 'restock', thing: 'Screws', from: 'TM Office' }))
      .toBe('TASK: Restock Screws at TM Office')
  })

  it('lets somebody write their own', () => {
    expect(taskSummary({ kind: 'other', thing: 'Ring Device Tech about Friday' }))
      .toBe('TASK: Ring Device Tech about Friday')
  })

  it('reads on a phone with no app, which is half the point of the calendar', () => {
    // Somebody looking at Google rather than the portal still has to know what
    // is being asked without opening anything.
    const summary = taskSummary({ kind: 'move', thing: 'Mariner', from: 'RHH', to: 'Calvary' })
    expect(summary.replace(TASK_PREFIX, '').trim())
      .toBe('Move Mariner from RHH to Calvary')
  })
})

describe('taps, not typing', () => {
  it('offers our own kits, taken from the inventory rather than typed again', () => {
    const things = taskThings()
    expect(things).toContain('Mariner')
    expect(things).toContain('Dakota')
    // The things that get restocked and are not implant systems.
    expect(things).toContain('Screws')
  })

  it('says how many places each kind needs, which is what decides the taps', () => {
    expect(kindFor('move').places).toBe(2)
    expect(kindFor('return').places).toBe(1)
    expect(kindFor('restock').places).toBe(1)
    expect(kindFor('other').places).toBe(0)
  })

  it('keeps the list short enough to be a row of buttons', () => {
    // Four kinds. A fifth is a dropdown, and a dropdown is the clunkiness
    // this exists to avoid.
    expect(TASK_KINDS).toHaveLength(4)
  })
})

describe('reading one back', () => {
  const MOVE = {
    kind: 'move', thing: 'Mariner', from: 'RHH', to: 'Calvary',
    who: 'Ben', addedBy: 'Brent'
  }

  it('round-trips everything that was chosen', () => {
    const back = readTask(taskSummary(MOVE), taskDescription(MOVE))
    expect(back).toMatchObject({
      kind: 'move', thing: 'Mariner', from: 'RHH', to: 'Calvary',
      who: 'Ben', addedBy: 'Brent', done: false
    })
  })

  it('reads "anyone" as nobody in particular, not as a person', () => {
    const back = readTask(taskSummary(MOVE), taskDescription({ ...MOVE, who: '' }))
    expect(back.who).toBeNull()
  })

  it('survives somebody rewriting the notes in Google', () => {
    // They are editable by hand there on purpose. A task whose description has
    // been rewritten is still a task.
    const back = readTask('TASK: Get the Athlet back', 'Toni rang RHH, it is in theatre 3')
    expect(back).not.toBeNull()
    expect(back.what).toBe('Get the Athlet back')
    expect(back.kind).toBe('other')
  })

  it('is not a booking, and a booking is not one', () => {
    expect(isTask('Davie ATHLET - Gupta')).toBe(false)
    expect(readTask('Davie ATHLET - Gupta', 'Surgeon: Gupta')).toBeNull()
    // And the other way: nothing about a task should read as a case, which it
    // cannot, having no surgeon and no patient.
    expect(readBooking(taskSummary(MOVE), taskDescription(MOVE))).toBeNull()
  })
})

describe('ticking one off', () => {
  const TASK = { kind: 'return', thing: 'Athlet', from: 'RHH', addedBy: 'Brent' }

  it('records who did it and when', () => {
    const description = `${taskDescription(TASK)}\n\n${doneLine('Ben', '09/10/2026')}`
    const back = readTask(taskSummary(TASK), description)
    expect(back.done).toBe(true)
    expect(back.doneBy).toBe('Ben')
    expect(back.doneOn).toBe('09/10/2026')
  })

  it('keeps the task, rather than making it disappear', () => {
    // A task that vanishes when it is finished leaves nobody able to answer
    // "did anybody actually fetch that tray" — the question it was written to
    // prevent in the first place.
    const description = `${taskDescription(TASK)}\n\n${doneLine('Ben', '09/10/2026')}`
    const back = readTask(taskSummary(TASK), description)
    expect(back.what).toBe('Get Athlet back from RHH')
    expect(back.thing).toBe('Athlet')
  })
})

describe('on the day', () => {
  const dayWith = events => buildWeekPlan(
    events,
    { startDate: '2026-10-12', endDate: '2026-10-18', days: [
      '2026-10-12', '2026-10-13', '2026-10-14',
      '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'
    ] },
    { generatedAt: '2026-10-09T00:00:00.000Z' }
  ).days.find(d => d.date === '2026-10-12')

  const TASK_EVENT = {
    id: 'task-1',
    summary: taskSummary({ kind: 'move', thing: 'Mariner', from: 'RHH', to: 'Calvary' }),
    description: taskDescription({
      kind: 'move', thing: 'Mariner', from: 'RHH', to: 'Calvary', addedBy: 'Brent'
    }),
    start: { date: '2026-10-12' },
    end: { date: '2026-10-13' }
  }

  it('reaches the day it was put on', () => {
    const day = dayWith([TASK_EVENT])
    expect(day.tasks).toHaveLength(1)
    expect(day.tasks[0].what).toBe('Move Mariner from RHH to Calvary')
    expect(day.tasks[0].id).toBe('task-1')
  })

  it('is not rolled up with the things nobody acts on', () => {
    // Taken before anything else gets to classify it. Otherwise "TASK: Get
    // Athlet back from RHH" lands in the same list as a birthday.
    const day = dayWith([TASK_EVENT])
    const elsewhere = [...(day.nonSurgeonItems || []), ...(day.otherRollup || [])]
    expect(elsewhere.some(i => /TASK:/.test(i.title || i.text || ''))).toBe(false)
  })

  it('does not stop a day being a day of cases', () => {
    const day = dayWith([TASK_EVENT, {
      id: 'case-1',
      summary: 'Davie ATHLET - Gupta',
      description: 'Surgeon: Gupta\nPatient: Davie\nHospital: RHH\nProcedure: C5/6 ACDF',
      start: { dateTime: '2026-10-12T08:00:00+11:00' },
      end: { dateTime: '2026-10-12T09:00:00+11:00' }
    }])
    expect(day.tasks).toHaveLength(1)
    expect((day.casesByHospital || []).flatMap(g => g.cases)).toHaveLength(1)
  })
})

describe('both views show them', () => {
  // "You need a rule built in that the changes you make in one version MUST
  // correspond to both versions."
  const source = readFileSync(join(__dirname, '..', 'pages', 'CaseWeek.jsx'), 'utf8')
  const phone = source.slice(source.indexOf('function DayPanel'))
  const week = source.slice(
    source.indexOf('function WeekColumn'), source.indexOf('function DayPanel'))

  it('on the phone day', () => expect(phone).toMatch(/<TaskRow\b/))
  it('on the desktop column', () => expect(week).toMatch(/<TaskRow\b/))

  it('as one component, so the two cannot drift apart', () => {
    const component = source.slice(source.indexOf('function TaskRow'))
    expect(component).toMatch(/onDone\?\.\(task, !done\)/)
    // Struck through rather than removed.
    expect(component).toMatch(/textDecoration: 'line-through'/)
  })

  it('offers the button beside Add a booking', () => {
    const row = source.slice(source.indexOf('function AddBookingRow'))
    expect(row).toMatch(/onAddTask\(day\)/)
  })

  it('does not call a day with a task on it empty', () => {
    expect(phone).toMatch(/&& !\(day\.tasks \|\| \[\]\)\.length/)
  })
})
