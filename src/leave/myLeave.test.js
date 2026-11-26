import { describe, it, expect } from 'vitest'
import { myUpcomingLeave, calendarLabel, eventDays, namesPerson, weekdaysIn, leaveAmount } from './myLeave.js'

// Mon, Wed and Thu at 5.5h — her contract (staffConfig.js).
const TONI_PATTERN = { kind: 'fixed', days: [5.5, 0, 5.5, 5.5, 0, 0, 0] }
const toni = { email: 'toni@technomed.com.au', firstName: 'Toni', name: 'Toni Hoppitt', workPattern: TONI_PATTERN }
const today = '2026-11-26'
const allDay = (id, summary, from, toExclusive) => ({ id, summary, start: { date: from }, end: { date: toExclusive } })

describe('myUpcomingLeave', () => {
  it('lists pending and approved portal requests from today on, not declined or past ones', () => {
    const applications = [
      { id: 'a', email: 'toni@technomed.com.au', status: 'approved', leaveType: 'ANNUAL_LEAVE', startDate: '2026-12-22', endDate: '2027-01-02', returnDate: '2027-01-05' },
      { id: 'b', email: 'TONI@technomed.com.au', status: 'pending', leaveType: 'SICK', startDate: '2026-12-02', endDate: '2026-12-02', hours: [{ date: '2026-12-02', hours: 5.5 }], totalHours: 5.5 },
      { id: 'c', email: 'toni@technomed.com.au', status: 'declined', leaveType: 'TOIL', startDate: '2026-12-03', endDate: '2026-12-03' },
      { id: 'd', email: 'toni@technomed.com.au', status: 'approved', leaveType: 'TOIL', startDate: '2026-11-02', endDate: '2026-11-03' },
      { id: 'e', email: 'erin@technomed.com.au', status: 'approved', leaveType: 'ANNUAL_LEAVE', startDate: '2026-12-10', endDate: '2026-12-12' }
    ]
    const out = myUpcomingLeave({ person: toni, today, applications })
    expect(out.map(l => [l.id, l.status, l.label])).toEqual([
      ['portal-b', 'pending', 'Personal leave'],
      ['portal-a', 'approved', 'Annual leave']
    ])
    expect(out[0]).toMatchObject({ days: 1, hours: 5.5 })
    expect(out[1].back).toBe('2027-01-05')
  })

  it('adds Staff Leave calendar entries naming the person as approved', () => {
    const events = [
      allDay('x', 'Toni - ANNUAL LEAVE', '2027-02-15', '2027-02-20'),
      allDay('y', 'Erin — Annual Leave', '2027-02-08', '2027-02-09'),
      allDay('z', 'Toni - personal leave', '2026-11-20', '2026-11-21')
    ]
    const out = myUpcomingLeave({ person: toni, today, events })
    // Mon 15 – Fri 19 Feb: three of Toni's days.
    expect(out).toEqual([{ id: 'cal-x', from: '2027-02-15', to: '2027-02-19', label: 'Annual leave', status: 'approved', source: 'calendar', days: 3, hours: 16.5 }])
  })

  it('shows leave on both once, as the portal record', () => {
    const applications = [{ id: 'a', email: 'toni@technomed.com.au', status: 'approved', leaveType: 'ANNUAL_LEAVE', startDate: '2026-12-22', endDate: '2026-12-24', calendar: { eventId: 'own' } }]
    const events = [
      allDay('own', 'Toni Hoppitt — Annual Leave', '2026-12-22', '2026-12-25'),
      allDay('typed', 'Toni - A/L', '2026-12-23', '2026-12-24')
    ]
    const out = myUpcomingLeave({ person: toni, today, applications, events })
    expect(out.map(l => l.id)).toEqual(['portal-a'])
  })

  it('a repeat of the same calendar entry is shown once', () => {
    const events = [allDay('1', 'Toni - TOIL', '2027-01-08', '2027-01-09'), allDay('2', 'Toni TOIL', '2027-01-08', '2027-01-09')]
    expect(myUpcomingLeave({ person: toni, today, events })).toHaveLength(1)
  })

  it('leave on now is kept', () => {
    const events = [allDay('n', 'Toni - leave', '2026-11-24', '2026-11-28')]
    expect(myUpcomingLeave({ person: toni, today, events })[0]).toMatchObject({ from: '2026-11-24', to: '2026-11-27' })
  })
})

describe('only the days the person works count (Toni, 26 Nov 2026)', () => {
  it('two weeks in January is five of Toni\'s days, not eight weekdays — Australia Day left out', () => {
    // Mon 19 – Wed 28 Jan 2027: eight weekdays, one of them Australia Day (Tue 26).
    expect(leaveAmount('2027-01-19', '2027-01-28', TONI_PATTERN)).toEqual({ days: 5, hours: 27.5 })
  })
  it('a full-time week is five days at 7.6h, less a public holiday', () => {
    expect(leaveAmount('2027-01-25', '2027-01-29', null)).toEqual({ days: 4, hours: 30.4 })
  })
  it('days that vary week to week give days, not invented hours', () => {
    expect(leaveAmount('2026-12-07', '2026-12-11', { kind: 'flexible', weeklyHours: 24 })).toEqual({ days: 5, hours: null })
  })
  it('a request with its own hours is taken as written', () => {
    expect(leaveAmount('2026-12-07', '2026-12-09', TONI_PATTERN, [{ date: '2026-12-07', hours: 5.5 }, { date: '2026-12-09', hours: 2 }, { date: '2026-12-08', hours: 0 }])).toEqual({ days: 2, hours: 7.5 })
  })
})

describe('pieces', () => {
  it('reads the portal’s own away titles and typed ones', () => {
    expect(calendarLabel('Mat — Away · Conference')).toBe('Away · Conference')
    expect(calendarLabel('Mat — RDO')).toBe('RDO')
    expect(calendarLabel('Toni - PERSONAL LEAVE')).toBe('Personal leave')
    expect(calendarLabel('Aimee — Training · Melbourne')).toBe('Training · Melbourne')
    expect(calendarLabel('Toni')).toBe('Leave')
  })
  it('timed events keep their day', () => {
    expect(eventDays({ start: { dateTime: '2026-12-01T09:00:00+11:00' }, end: { dateTime: '2026-12-01T12:00:00+11:00' } })).toEqual({ from: '2026-12-01', to: '2026-12-01' })
  })
  it('matches by first name or surname as a word', () => {
    expect(namesPerson('Hoppitt annual leave', toni)).toBe(true)
    expect(namesPerson('Antonio leave', toni)).toBe(false)
  })
  it('counts weekdays', () => {
    expect(weekdaysIn('2026-12-21', '2027-01-01')).toBe(10)
  })
})
