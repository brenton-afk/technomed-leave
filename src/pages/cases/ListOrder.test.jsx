import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import ListOrder from './ListOrder.jsx'
import { buildWeekPlan } from '../../clinicalPlan/buildWeekPlan.js'

// ─── The theatre lists ───────────────────────────────────────────────────────
// "A list order tab that just brings up a list of cases at both hospitals in a
// simple 1,2,3 list. Just so it's easy to glance at what is on the list for
// each surgeon. It gives an idea of timing."
//
// Built as theatre lists rather than one flat 1,2,3, for the reason Brent gave
// when the numbers came off the cards: "the number becomes obsolete when
// competitor cases are on the list." Within one surgeon's list in one theatre a
// number means something. Across two hospitals it does not — those run at the
// same time, in two buildings.

const WEEK = {
  startDate: '2026-10-12',
  endDate: '2026-10-18',
  days: ['2026-10-12', '2026-10-13', '2026-10-14',
    '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
}

const ev = (id, summary, description, hour, location) => ({
  id,
  summary,
  description,
  location,
  start: { dateTime: `2026-10-12T${String(hour).padStart(2, '0')}:00:00+11:00` },
  end: { dateTime: `2026-10-12T${String(hour + 1).padStart(2, '0')}:00:00+11:00` }
})

const planFor = events =>
  buildWeekPlan(events, WEEK, { generatedAt: '2026-10-09T00:00:00.000Z' })

const show = events =>
  render(<ListOrder plan={planFor(events)} today="2026-10-12" />)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-12T02:00:00.000Z'))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('one surgeon’s list', () => {
  const THANI = [
    ev('a', 'Whiteley CYLOX - Thani',
      'Surgeon: Thani\nPatient: Whiteley\nHospital: CLV\n'
      + 'Procedure: C5/6 ACDF\nKit: CYLOX (Distributor Loan)\n'
      + 'List: 1st · afternoon · from 1.30pm', 13, 'Calvary'),
    ev('b', 'Bopf CYLOX - Thani',
      'Surgeon: Thani\nPatient: Bopf\nHospital: CLV\n'
      + 'Procedure: C5/6 ACDF\nKit: CYLOX (Distributor Loan)\n'
      + 'List: 2nd · afternoon', 14, 'Calvary')
  ]

  it('names the surgeon the list belongs to', () => {
    show(THANI)
    expect(screen.getAllByText('Thani').length).toBeGreaterThan(0)
  })

  it('numbers them as the hospital numbered them', () => {
    show(THANI)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('says when the list runs, which is the timing question', () => {
    show(THANI)
    expect(screen.getByText(/PM/)).toBeInTheDocument()
    expect(screen.getByText(/from 1\.30pm/)).toBeInTheDocument()
  })

  it('says what is going in, so the booking need not be opened', () => {
    show(THANI)
    expect(screen.getAllByText(/CYLOX \(Distributor Loan\)/).length).toBe(2)
  })
})

describe('the places that are not ours', () => {
  it('leaves the gap rather than renumbering our cases', () => {
    // The whole reason the numbers came off the cards. We are 1st and 3rd;
    // somebody else has the 2nd. Closing that up to 1, 2 would be the app
    // asserting a running order the hospital never gave.
    show([
      ev('a', 'Whiteley MARINER - Gupta',
        'Surgeon: Gupta\nPatient: Whiteley\nHospital: RHH\n'
        + 'Procedure: L4/5 PLIF\nList: 1st · morning', 8, 'RHH'),
      ev('b', 'Bopf MARINER - Gupta',
        'Surgeon: Gupta\nPatient: Bopf\nHospital: RHH\n'
        + 'Procedure: L4/5 PLIF\nList: 3rd · morning', 10, 'RHH')
    ])
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
    expect(screen.getByText(/one case not ours/)).toBeInTheDocument()
  })

  it('counts more than one of them', () => {
    show([
      ev('a', 'Whiteley MARINER - Gupta',
        'Surgeon: Gupta\nPatient: Whiteley\nHospital: RHH\n'
        + 'Procedure: L4/5 PLIF\nList: 1st · morning', 8, 'RHH'),
      ev('b', 'Bopf MARINER - Gupta',
        'Surgeon: Gupta\nPatient: Bopf\nHospital: RHH\n'
        + 'Procedure: L4/5 PLIF\nList: 4th · morning', 11, 'RHH')
    ])
    expect(screen.getByText(/2 cases not ours/)).toBeInTheDocument()
  })

  it('invents no number for a case nobody has rung about', () => {
    // An invented position is the one thing this view exists not to do.
    show([
      ev('a', 'Whiteley MARINER - Gupta',
        'Surgeon: Gupta\nPatient: Whiteley\nHospital: RHH\nProcedure: L4/5 PLIF', 8, 'RHH')
    ])
    expect(screen.getByText('Whiteley')).toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(screen.getByText('–')).toBeInTheDocument()
  })
})

describe('naming what is in front of us', () => {
  // "It should be able to deduce from the information in the bookings what the
  // cases are in front of it. For example within patient Whiteley the
  // information says 'After two cranis and a discectomy' — that means you can
  // put 1. Craniotomy, 2. Craniotomy, 3. Discectomy and then our cases, rather
  // than '3 cases that aren't ours'."
  it('reads the team’s own words into places on the list', () => {
    show([
      ev('a', 'Whiteley CYLOX - Thani',
        'Surgeon: Thani\nPatient: Whiteley\nHospital: CLV\n'
        + 'Procedure: C5/6 ACDF\n'
        + 'List: 4th · morning · After two cranis and a discectomy', 11, 'Calvary')
    ])
    expect(screen.getAllByText('Craniotomy')).toHaveLength(2)
    expect(screen.getByText('Discectomy')).toBeInTheDocument()
    expect(screen.queryByText(/not ours/)).not.toBeInTheDocument()
  })

  it('numbers them, because they hold real places', () => {
    show([
      ev('a', 'Whiteley CYLOX - Thani',
        'Surgeon: Thani\nPatient: Whiteley\nHospital: CLV\n'
        + 'Procedure: C5/6 ACDF\n'
        + 'List: 4th · morning · After two cranis and a discectomy', 11, 'Calvary')
    ])
    for (const n of ['1', '2', '3', '4']) {
      expect(screen.getByText(n), n).toBeInTheDocument()
    }
  })

  it('works out our place from what is ahead, where nobody gave us a number', () => {
    // Three cases in front makes us fourth. Not a guess — it is what the
    // hospital said, read properly.
    show([
      ev('a', 'Whiteley CYLOX - Thani',
        'Surgeon: Thani\nPatient: Whiteley\nHospital: CLV\n'
        + 'Procedure: C5/6 ACDF\n'
        + 'List: morning · After two cranis and a discectomy', 11, 'Calvary')
    ])
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('falls back to counting where the words are not recognised', () => {
    // A list with a name invented onto it is worse than one that admits what
    // it does not know.
    show([
      ev('a', 'Whiteley CYLOX - Thani',
        'Surgeon: Thani\nPatient: Whiteley\nHospital: CLV\n'
        + 'Procedure: C5/6 ACDF\n'
        + 'List: 3rd · morning · waiting on the surgeon', 10, 'Calvary')
    ])
    expect(screen.getByText(/2 cases not ours/)).toBeInTheDocument()
  })

  it('falls back where the words disagree with the number given', () => {
    // Told we are 2nd, and told two cases are ahead. One of those is wrong and
    // this does not get to choose which.
    show([
      ev('a', 'Whiteley CYLOX - Thani',
        'Surgeon: Thani\nPatient: Whiteley\nHospital: CLV\n'
        + 'Procedure: C5/6 ACDF\n'
        + 'List: 2nd · morning · After two cranis', 9, 'Calvary')
    ])
    expect(screen.getByText(/one case not ours/)).toBeInTheDocument()
    expect(screen.queryByText('Craniotomy')).not.toBeInTheDocument()
  })
})

describe('two hospitals are not one queue', () => {
  const BOTH = [
    ev('a', 'Whiteley CYLOX - Thani',
      'Surgeon: Thani\nPatient: Whiteley\nHospital: CLV\n'
      + 'Procedure: C5/6 ACDF\nList: 1st · afternoon', 13, 'Calvary'),
    ev('b', 'Smith DAKOTA - Fowler',
      'Surgeon: Fowler\nPatient: Smith\nHospital: RHH\n'
      + 'Procedure: C4/5 ACDF\nList: 1st · morning', 8, 'RHH')
  ]

  it('shows both, each under its own hospital', () => {
    show(BOTH)
    expect(screen.getByText('RHH')).toBeInTheDocument()
    // Shortened the way the week grid shortens it. "CALVARY LENAH VALLEY" is
    // the name on the booking and nobody says it out loud.
    expect(screen.getByText('CALVARY')).toBeInTheDocument()
  })

  it('lets each list start at one, because they run at the same time', () => {
    // Two theatres in two buildings. A single sequence across them would be
    // a number that means nothing — the thing this view was redesigned to
    // avoid.
    show(BOTH)
    expect(screen.getAllByText('1')).toHaveLength(2)
  })
})

describe('what it does with the rest of a week', () => {
  it('leaves out the days nothing is booked on', () => {
    // A week of empty headings is not a glance.
    show([
      ev('a', 'Whiteley CYLOX - Thani',
        'Surgeon: Thani\nPatient: Whiteley\nHospital: CLV\nProcedure: C5/6 ACDF', 13, 'Calvary')
    ])
    expect(screen.getByText('Monday')).toBeInTheDocument()
    expect(screen.queryByText('Tuesday')).not.toBeInTheDocument()
  })

  it('says so plainly when there is nothing at all', () => {
    show([])
    expect(screen.getByText('Nothing booked this week.')).toBeInTheDocument()
  })

  it('shows a booking that has no name yet, since the kit still has to be there', () => {
    show([
      ev('a', 'MARINER - Gupta',
        'Surgeon: Gupta\nHospital: RHH\nProcedure: L4/5 PLIF\nKit: Mariner', 8, 'RHH')
    ])
    expect(screen.getByText('Name to come')).toBeInTheDocument()
  })
})

// ─── The day you tapped ──────────────────────────────────────────────────────
// "The list view isn't refreshing automatically when you select the day... the
// list order view needs to correspond immediately and refresh immediately to
// whatever day you click on. It's really laggy at the moment."
//
// It drew the whole week and was never told which day was selected, so tapping
// Wednesday on the strip above it changed nothing anybody could see. Seven days
// of theatre lists on every render is also most of where the lag was.
describe('following the day strip', () => {
  const evOn = (id, name, surgeon, isoDay, hour) => ({
    id,
    summary: `${name} CYLOX - ${surgeon}`,
    description: `Surgeon: ${surgeon}\nPatient: ${name}\nHospital: CLV\n`
      + 'Procedure: C5/6 ACDF\nKit: CYLOX (Distributor Loan)',
    location: 'Calvary',
    start: { dateTime: `${isoDay}T${String(hour).padStart(2, '0')}:00:00+11:00` },
    end: { dateTime: `${isoDay}T${String(hour + 1).padStart(2, '0')}:00:00+11:00` }
  })

  const WEEK_OF_CASES = [
    evOn('m', 'Whiteley', 'Thani', '2026-10-12', 9),
    evOn('w', 'Vellacott', 'Atallah', '2026-10-14', 9),
    evOn('f', 'Ashbury', 'Garg', '2026-10-16', 9)
  ]

  const onDay = day => render(
    <ListOrder plan={planFor(WEEK_OF_CASES)} today="2026-10-12" day={day} />)

  it('shows the day it was given, and only that day', () => {
    onDay('2026-10-14')
    expect(screen.getByText('Vellacott')).toBeInTheDocument()
    expect(screen.queryByText('Whiteley')).not.toBeInTheDocument()
    expect(screen.queryByText('Ashbury')).not.toBeInTheDocument()
  })

  it('moves when the day moves', () => {
    const { rerender } = onDay('2026-10-12')
    expect(screen.getByText('Whiteley')).toBeInTheDocument()
    rerender(<ListOrder plan={planFor(WEEK_OF_CASES)} today="2026-10-12" day="2026-10-16" />)
    expect(screen.getByText('Ashbury')).toBeInTheDocument()
    expect(screen.queryByText('Whiteley')).not.toBeInTheDocument()
  })

  it('says so when the day you picked has nothing on it', () => {
    // Rather than an empty panel, which reads as a screen that failed to load.
    onDay('2026-10-13')
    expect(screen.getByText('Nothing booked on this day.')).toBeInTheDocument()
  })

  it('still draws the week when no day is named, which is the desktop', () => {
    // A desktop has no day view at all — all seven are on the glass — so
    // there is nothing there for one day to correspond to.
    render(<ListOrder plan={planFor(WEEK_OF_CASES)} today="2026-10-12" />)
    expect(screen.getByText('Whiteley')).toBeInTheDocument()
    expect(screen.getByText('Vellacott')).toBeInTheDocument()
    expect(screen.getByText('Ashbury')).toBeInTheDocument()
  })
})
