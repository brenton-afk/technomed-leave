import { describe, it, expect } from 'vitest'
import {
  stripWake, hasWakeWord, commandPrompt, readCommand, describePlan, matchCase
} from './command.js'

// ─── "Hey TM Portal…" ────────────────────────────────────────────────────────
// "I want a voice option to be able to add/amend list orders or add a reminder
// to the portal. Like a speak function that says 'Hey TM Portal, I want to add
// a booking', or 'Hey TM portal, I want to add a reminder', 'Hey TM portal I
// want to update the list order for tomorrow'."
//
// The three commands Brent named, plus a task-list one, plus the answer that
// matters most: "I did not follow that".

describe('the wake words', () => {
  it('takes the ceremony off the front', () => {
    expect(stripWake('Hey TM Portal, I want to add a reminder'))
      .toBe('add a reminder')
  })

  it('copes with what a transcript does to them', () => {
    // "Hey TM portal" comes back as all of these depending on how it was said
    // and how much noise was in the corridor.
    for (const said of [
      'Hey TM Portal, add a booking',
      'Hey tm portal add a booking',
      'Hey, T.M. Portal, add a booking',
      'Hey team portal, add a booking',
      'OK TM Portal add a booking'
    ]) {
      expect(stripWake(said), said).toBe('add a booking')
    }
  })

  it('leaves a command that did not use them alone', () => {
    // An app that insisted on the magic words would be worse than one that
    // did not need them.
    expect(stripWake('Move the Mariner to Calvary on Thursday'))
      .toBe('Move the Mariner to Calvary on Thursday')
  })

  it('knows whether they were said', () => {
    expect(hasWakeWord('Hey TM Portal, add a booking')).toBe(true)
    expect(hasWakeWord('add a booking')).toBe(false)
  })

  it('copes with nothing at all', () => {
    expect(stripWake('')).toBe('')
    expect(stripWake(null)).toBe('')
  })
})

describe('what the model is told', () => {
  const prompt = commandPrompt('Hey TM Portal, add a reminder', {
    today: '2026-10-13', weekday: 'Tuesday'
  })

  it('tells it today, so "tomorrow" means something', () => {
    expect(prompt).toContain('2026-10-13')
    expect(prompt).toContain('Tuesday')
  })

  it('offers "I could not tell" as a real answer', () => {
    // A router with no way to say that puts every mumble into whichever
    // branch is nearest, which is how a cough becomes a booking.
    expect(prompt).toMatch(/"unclear"/)
    expect(prompt).toMatch(/Use this\s*\n?freely/)
  })

  it('names the task kinds this calendar can actually draw', () => {
    expect(prompt).toContain('move —')
    expect(prompt).toContain('restock —')
  })

  it('names the staff, so an assignee is a real person', () => {
    expect(prompt).toContain('Toni Hoppitt')
  })

  it('tells it not to invent what it did not hear', () => {
    expect(prompt).toMatch(/do not invent a date, a kit or a name/)
  })
})

describe('reading a reminder', () => {
  const said = {
    intent: 'reminder', confidence: 'high',
    why: 'Getting the Athlet tray back from RHH on Thursday.',
    reminder: {
      kind: 'return', thing: 'Athlet', from: 'RHH', to: '', note: '',
      date: '2026-10-15'
    }
  }

  it('keeps what it heard', () => {
    const out = readCommand(said)
    expect(out.intent).toBe('reminder')
    expect(out.reminder).toMatchObject({ kind: 'return', thing: 'Athlet', from: 'RHH' })
  })

  it('refuses a kind this calendar has never heard of', () => {
    // A model that invents "collect" produces a task the calendar cannot
    // draw, and the place to find that out is here, not on somebody's Tuesday.
    const out = readCommand({ ...said, reminder: { ...said.reminder, kind: 'collect' } })
    expect(out.intent).toBe('unclear')
  })

  it('refuses one with no day', () => {
    // The whole point of a reminder here is that it lands on a day everybody
    // can see.
    const out = readCommand({ ...said, reminder: { ...said.reminder, date: '' } })
    expect(out.intent).toBe('unclear')
    expect(out.why).toMatch(/which day/)
  })

  it('refuses a date that is not one', () => {
    const out = readCommand({ ...said, reminder: { ...said.reminder, date: 'Thursday' } })
    expect(out.intent).toBe('unclear')
  })

  it('refuses one with nothing in it', () => {
    const out = readCommand({
      ...said, reminder: { ...said.reminder, thing: '', from: '', to: '' }
    })
    expect(out.intent).toBe('unclear')
  })
})

describe('reading a list order', () => {
  const said = {
    intent: 'listOrder', confidence: 'high', why: 'Second at Calvary tomorrow.',
    listOrder: {
      date: '2026-10-14', surgeon: 'Thani', patient: '',
      position: 2, session: 'afternoon', from: '1.30pm',
      ahead: 'after a craniotomy'
    }
  }

  it('keeps the position, the session and what is ahead', () => {
    const out = readCommand(said)
    expect(out.listOrder).toMatchObject({
      position: 2, session: 'afternoon', from: '1.30pm', ahead: 'after a craniotomy'
    })
  })

  it('throws out a position no theatre list has', () => {
    expect(readCommand({ ...said, listOrder: { ...said.listOrder, position: 99 } })
      .listOrder.position).toBe(null)
    expect(readCommand({ ...said, listOrder: { ...said.listOrder, position: 0 } })
      .listOrder.position).toBe(null)
  })

  it('throws out a session that is not one of ours', () => {
    expect(readCommand({ ...said, listOrder: { ...said.listOrder, session: 'evening' } })
      .listOrder.session).toBe(null)
  })

  it('refuses one that says nothing about the order', () => {
    const out = readCommand({
      ...said,
      listOrder: { date: '2026-10-14', surgeon: 'Thani', position: null, session: null, from: '', ahead: '' }
    })
    expect(out.intent).toBe('unclear')
  })

  it('refuses one with no day', () => {
    const out = readCommand({ ...said, listOrder: { ...said.listOrder, date: '' } })
    expect(out.intent).toBe('unclear')
  })
})

describe('reading a task for somebody’s list', () => {
  const said = {
    intent: 'todo', confidence: 'high', why: 'A task for Toni.',
    todo: {
      task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt',
      due_date: '2026-10-20', priority: 'normal'
    }
  }

  it('keeps it', () => {
    expect(readCommand(said).todo).toMatchObject({
      task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt'
    })
  })

  it('will not assign it to somebody who does not work here', () => {
    expect(readCommand({ ...said, todo: { ...said.todo, assignee: 'Dave' } })
      .todo.assignee).toBe('Unassigned')
  })

  it('refuses one with no task in it', () => {
    expect(readCommand({ ...said, todo: { ...said.todo, task: '  ' } }).intent)
      .toBe('unclear')
  })

  it('does not need a date — most of them have none', () => {
    const out = readCommand({ ...said, todo: { ...said.todo, due_date: '' } })
    expect(out.intent).toBe('todo')
    expect(out.todo.due_date).toBe('')
  })
})

describe('what it refuses outright', () => {
  it('treats an intent it does not have as unclear', () => {
    expect(readCommand({ intent: 'order a pizza' }).intent).toBe('unclear')
  })

  it('treats nothing as unclear', () => {
    expect(readCommand(null).intent).toBe('unclear')
    expect(readCommand({}).intent).toBe('unclear')
  })

  it('reads a JSON string as well as an object', () => {
    expect(readCommand('{"intent":"booking","confidence":"high"}').intent).toBe('booking')
  })

  it('does not let a low confidence pass itself off as high', () => {
    expect(readCommand({ intent: 'booking', confidence: 'quite sure' }).confidence)
      .toBe('low')
  })
})

describe('what the confirm screen says', () => {
  // The whole safety of this rests on somebody reading two lines and deciding
  // they are right. A labelled grid of eight fields is not read.
  const weekdayOf = () => 'Thursday'

  it('says the task in the words the calendar will use', () => {
    const plan = describePlan(readCommand({
      intent: 'reminder',
      reminder: { kind: 'return', thing: 'Athlet', from: 'RHH', date: '2026-10-15' }
    }), { weekdayOf })
    expect(plan.title).toBe('Task · Get a tray back')
    expect(plan.lines[0]).toBe('Get Athlet back from RHH')
    expect(plan.lines[1]).toBe('Thursday 15 October')
  })

  it('says the list order as a position and a time', () => {
    const plan = describePlan(readCommand({
      intent: 'listOrder',
      listOrder: {
        date: '2026-10-15', surgeon: 'Thani', position: 2,
        session: 'afternoon', from: '1.30pm', ahead: 'after a craniotomy'
      }
    }), { weekdayOf })
    expect(plan.lines).toContain('2nd · afternoon · from 1.30pm')
    expect(plan.lines).toContain('after a craniotomy')
  })

  it('says who a task is for, or that it is nobody’s yet', () => {
    const plan = describePlan(readCommand({
      intent: 'todo', todo: { task: 'Chase the paperwork', assignee: null }
    }), { weekdayOf })
    expect(plan.lines).toContain('Nobody yet')
  })

  it('says it could not tell, and why', () => {
    const plan = describePlan({ intent: 'unclear', why: 'That sounded like a cough.' })
    expect(plan.title).toBe('Not sure')
    expect(plan.lines[0]).toBe('That sounded like a cough.')
  })

  it('sends a booking to the form rather than describing it', () => {
    // The booking reader does that job, and doing it twice in two voices is
    // how the two come to disagree.
    expect(describePlan({ intent: 'booking' }).title).toBe('New booking')
  })
})

describe('which case a list order is about', () => {
  const plan = {
    days: [{
      date: '2026-10-14',
      casesByHospital: [
        {
          hospital: 'Calvary',
          cases: [
            { id: 'a', patient: 'Whiteley', surgeon: 'Thani' },
            { id: 'b', patient: 'Bopf', surgeon: 'Thani' }
          ]
        },
        { hospital: 'RHH', cases: [{ id: 'c', patient: 'Mardon', surgeon: 'Fowler' }] }
      ]
    }]
  }

  it('finds it by the surname, which is what identifies a booking', () => {
    expect(matchCase(plan, { date: '2026-10-14', patient: 'Whiteley' }).match.id).toBe('a')
  })

  it('finds it by the surgeon when only one of theirs is on', () => {
    expect(matchCase(plan, { date: '2026-10-14', surgeon: 'Fowler' }).match.id).toBe('c')
  })

  it('refuses to choose between two of the same surgeon’s', () => {
    // A list order applied to the wrong case moves the wrong team to the
    // wrong hospital at half past seven.
    const out = matchCase(plan, { date: '2026-10-14', surgeon: 'Thani' })
    expect(out.match).toBe(null)
    expect(out.why).toMatch(/More than one case/)
  })

  it('takes the only case of the day whatever was said about it', () => {
    const one = { days: [{ date: '2026-10-16', casesByHospital: [{ hospital: 'RHH', cases: [{ id: 'z' }] }] }] }
    expect(matchCase(one, { date: '2026-10-16', surgeon: 'Nobody' }).match.id).toBe('z')
  })

  it('says so when nothing is booked that day', () => {
    const out = matchCase(plan, { date: '2026-10-20', surgeon: 'Thani' })
    expect(out.match).toBe(null)
    expect(out.why).toMatch(/Nothing is booked/)
  })

  it('says so when it cannot tell', () => {
    const out = matchCase(plan, { date: '2026-10-14', patient: 'Somebody' })
    expect(out.match).toBe(null)
    expect(out.why).toMatch(/Could not tell which case/)
  })
})
