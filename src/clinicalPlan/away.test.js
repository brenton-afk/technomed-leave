import { describe, it, expect } from 'vitest'
import { cleanAway, awayEvent, readAwayTitle, awayTitle, mayAddAway, awayWhen } from './away.js'
import { classifyItem } from './itemKind.js'
import { buildWeekPlan } from './buildWeekPlan.js'
import { weekWindowFor } from './week.js'
import { STAFF } from '../staffConfig.js'

// Brent, 24 Nov 2026: "Mat is at a training day. He's not on leave as he'll be
// paid for his time there, but he is also not available for cases." Leave's
// colour, so the team reads it the same way; "That can also cover RDOs".
const MAT = STAFF.find(s => s.firstName === 'Mat')

describe('away entries', () => {
  it('anyone on the staff list adds them (Brent, 25 Nov 2026); a list narrows it', () => {
    expect(mayAddAway('brenton@technomed.com.au')).toBe(true)
    expect(mayAddAway('mat@technomed.com.au')).toBe(true)
    expect(mayAddAway('someone@example.com')).toBe(false)
    expect(mayAddAway('mat@technomed.com.au', ['erin@technomed.com.au'])).toBe(false)
  })

  it('titles and reads back training and leave too', () => {
    expect(awayTitle(MAT, 'Melbourne', 'training')).toBe('Mat — Training · Melbourne')
    expect(awayTitle(MAT, '', 'leave')).toBe('Mat — Leave')
    expect(readAwayTitle('Mat — Training · Melbourne')).toEqual({ word: 'Training', reason: 'Melbourne' })
    expect(readAwayTitle('Mat — Leave')).toEqual({ word: 'Leave', reason: 'Leave' })
    expect(cleanAway({ email: MAT.email, kind: 'office', from: '2026-11-26' }).error).toBeUndefined()
  })

  it('titles and reads back a training day and an RDO', () => {
    expect(awayTitle(MAT, 'Training day')).toBe('Mat — Away · Training day')
    expect(awayTitle(MAT, 'rdo')).toBe('Mat — RDO')
    expect(readAwayTitle('Mat — Away · Training day')).toEqual({ word: 'Away', reason: 'Training day' })
    expect(readAwayTitle('Mat — RDO')).toEqual({ word: 'RDO', reason: 'RDO' })
    expect(readAwayTitle('Mat — Annual Leave')).toBe(null)
  })

  it('checks what was sent', () => {
    expect(cleanAway({ email: 'nobody@x', from: '2026-11-26', reason: 'x' }).error).toMatch(/who/)
    expect(cleanAway({ email: MAT.email, from: '2026-11-26', reason: '' }).error).toMatch(/why/i)
    expect(cleanAway({ email: MAT.email, from: '2026-11-27', to: '2026-11-26', reason: 'RDO' }).error).toMatch(/before/)
    expect(cleanAway({ email: MAT.email, from: '2026-11-26', to: '2026-11-27', allDay: false, start: '08:00', end: '12:00', reason: 'RDO' }).error).toMatch(/one day/)
    expect(cleanAway({ email: MAT.email, from: '2026-11-26', allDay: false, start: '12:00', end: '08:00', reason: 'RDO' }).error).toMatch(/finish/)
    const ok = cleanAway({ email: MAT.email, from: '2026-11-26', reason: 'Training day' })
    expect(ok.error).toBeUndefined()
    expect(ok.to).toBe('2026-11-26')
  })

  it('is a Grape, all-day, never-busy entry — not leave, nothing to Xero', () => {
    const e = awayEvent(cleanAway({ email: MAT.email, from: '2026-11-26', to: '2026-11-27', reason: 'Training day' }), 'Erin Smallbon')
    expect(e.summary).toBe('Mat — Away · Training day')
    expect(e.colorId).toBe('3')
    expect(e.start).toEqual({ date: '2026-11-26' })
    expect(e.end).toEqual({ date: '2026-11-28' })
    expect(e.description).toMatch(/Not leave/)
    expect(e.description).toMatch(/by Erin Smallbon/)
    const timed = awayEvent(cleanAway({ email: MAT.email, from: '2026-11-26', allDay: false, start: '08:00', end: '12:30', reason: 'RDO' }))
    expect(timed.start).toEqual({ dateTime: '2026-11-26T08:00:00', timeZone: 'Australia/Hobart' })
    expect(awayWhen({ from: '2026-11-26', to: '2026-11-26', allDay: false, start: '08:00', end: '12:30' })).toBe('Thu 26 Nov · 08:00–12:30')
  })

  it('reads one of our titles as "not here" whatever its colour (25 Nov 2026)', () => {
    expect(classifyItem({ title: 'Mat — Away · Conference', colourName: 'tangerine' })).toMatchObject({ kind: 'leave', label: 'Away' })
    expect(classifyItem({ title: 'Aimee — Training · Melbourne' })).toMatchObject({ kind: 'leave', label: 'Training' })
    expect(classifyItem({ title: 'Team meeting' }).kind).toBe('meeting')
  })

  it('reads as "not here" like leave, labelled Away', () => {
    expect(classifyItem({ title: 'Mat — Away · Training day', colourName: 'grape' })).toMatchObject({ kind: 'leave', label: 'Away' })
    expect(classifyItem({ title: 'Mat — RDO', colourName: 'grape' })).toMatchObject({ kind: 'leave', label: 'RDO' })
    expect(classifyItem({ title: 'Mat — Annual Leave', colourName: 'grape' })).toMatchObject({ kind: 'leave', label: 'Leave' })
  })

  it('puts the person away on those days, saying why', () => {
    const plan = buildWeekPlan([
      { id: 'a', summary: 'Mat — Away · Training day', start: { date: '2026-11-26' }, end: { date: '2026-11-27' }, colorId: '3' },
      { id: 'b', summary: 'Ben — Annual Leave', start: { date: '2026-11-26' }, end: { date: '2026-11-27' }, colorId: '3' }
    ], weekWindowFor('2026-11-23'), { generatedAt: '2026-11-23T08:00:00+11:00' })
    const mat = plan.away.find(p => p.firstName === 'Mat')
    expect(mat.days).toEqual(['2026-11-26'])
    expect(mat.why['2026-11-26']).toBe('Away')
    expect(plan.away.find(p => p.firstName === 'Ben').why['2026-11-26']).toBe('Leave')
  })
})
