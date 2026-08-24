import { describe, it, expect } from 'vitest'
import { classifyItem, ITEM_KINDS } from './itemKind.js'

// The bookings calendar carries more than theatre lists: approved leave (written
// there by this app), internal meetings, on-call and rostered hours, reminders.
// All of it was drawn the same way — a title and a time — so a week's worth of
// planning information read as one undifferentiated list, and the things that
// change what a day *asks* of the team were indistinguishable from the things
// that do not.

const kindOf = item => classifyItem(item).kind

describe('leave', () => {
  it('is recognised by the colour this app writes it in', () => {
    // The approval path writes "{Name} — Annual Leave" in Grape, so the colour
    // settles it before any wording does — an entry titled only with a name
    // still reads as leave.
    expect(kindOf({ title: 'Aimee Vulinovich', colourName: 'grape' })).toBe('leave')
  })

  it('is recognised by wording, for leave entered by hand', () => {
    expect(kindOf({ title: 'Ben Cassidy — Annual Leave' })).toBe('leave')
    expect(kindOf({ title: 'Mat — personal leave' })).toBe('leave')
    expect(kindOf({ title: 'Toni TOIL' })).toBe('leave')
  })

  it('beats every other reading', () => {
    // A leave note often says "due back Monday", which on its own would read as
    // a reminder. Order in KINDS is the whole design.
    expect(kindOf({ title: 'Erin — Annual Leave', description: 'Due back Monday' })).toBe('leave')
  })
})

describe('hours', () => {
  it('recognises who is available and when', () => {
    // The layer people actually plan a week around, and it had no visual
    // identity at all.
    expect(kindOf({ title: 'Brent on call' })).toBe('hours')
    expect(kindOf({ title: 'Brent in NSA' })).toBe('hours')
    expect(kindOf({ title: 'Toni WFH' })).toBe('hours')
    expect(kindOf({ title: 'April rostered 8–4' })).toBe('hours')
  })

  it('is read as hours rather than a meeting when it is both', () => {
    // "On call handover" is who is available, not an appointment.
    expect(kindOf({ title: 'On call handover' })).toBe('hours')
  })
})

describe('meetings and reminders', () => {
  it('recognises a meeting', () => {
    expect(kindOf({ title: 'Team meeting' })).toBe('meeting')
    expect(kindOf({ title: 'Catch up with Erin' })).toBe('meeting')
    expect(kindOf({ title: 'SeaSpine in-service' })).toBe('meeting')
  })

  it('recognises a reminder', () => {
    expect(kindOf({ title: 'Reorder Mariner screws' })).toBe('reminder')
    expect(kindOf({ title: 'Timesheets due' })).toBe('reminder')
  })
})

describe('anything else', () => {
  it('is shown as itself rather than forced into a category', () => {
    // A booking nobody anticipated should not be labelled wrongly. "Other" is an
    // honest answer; a confident wrong one is not.
    expect(kindOf({ title: 'Hobart' })).toBe('other')
    expect(kindOf({})).toBe('other')
  })

  it('never returns a kind that has no label', () => {
    for (const item of [{ title: 'Team meeting' }, { title: 'x' }, {}]) {
      const { kind, label } = classifyItem(item)
      expect(ITEM_KINDS.some(k => k.kind === kind && k.label === label)).toBe(true)
    }
  })
})
