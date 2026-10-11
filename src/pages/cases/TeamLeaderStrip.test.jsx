import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import TeamLeaderStrip from './TeamLeaderStrip.jsx'
import { buildWeekPlan } from '../../clinicalPlan/buildWeekPlan.js'

// ─── Who is team leader, said once and seen ──────────────────────────────────
// "The team leader notation is doubled up at the top of the page... just have
// the one option/tab that allows you to adjust, and also informs you."
// "It shouldn't say 'Team leader, that week'. That doesn't make sense."
// "Team leader is listed at the top and gets missed, make it with a green
// outline or similar to make it clear."

const BEN = { email: 'ben@technomed.com.au', firstName: 'Ben' }

const show = (props = {}) => render(
  <TeamLeaderStrip
    leader={BEN}
    away={[]}
    onChange={vi.fn()}
    week="2026-10-12"
    today="2026-10-12"
    hour={10}
    {...props} />
)

const strip = () => screen.getByRole('button', { name: /Team leader/i })

describe('what it says', () => {
  it('names the leader, and says it can be changed', () => {
    show()
    expect(screen.getByLabelText(/Team leader: Ben\. Change\./)).toBeInTheDocument()
    expect(screen.getByText('Ben')).toBeInTheDocument()
  })

  it('names the week when it is not the week you are in', () => {
    // It used to read "Team leader, that week", which was trying to say "the
    // leader of the week you are looking at" and did not say anything.
    show({ week: '2026-10-19' })
    expect(screen.getByText('Team leader · w/c 19 Oct')).toBeInTheDocument()
    expect(screen.queryByText(/that week/)).not.toBeInTheDocument()
  })

  it('says just "Team leader" for the week you are in', () => {
    show()
    expect(screen.getByText('Team leader')).toBeInTheDocument()
  })
})

describe('being noticed', () => {
  it('is outlined in the accent, not the hairline everything else uses', () => {
    // "Team leader is listed at the top and gets missed."
    show()
    const border = strip().style.border
    expect(border).toMatch(/2px/)
    expect(border).not.toMatch(/rgba\(0, ?0, ?0/)
  })

  it('turns to the warning where the leader is on leave that week', () => {
    // Mat was Spine Team Leader through a week he spent on TOIL. The warning
    // still wins over the accent — a leader on leave is the state worth
    // noticing above all the others.
    const { container } = show({ away: [BEN] })
    expect(screen.getByText(/On leave/i)).toBeInTheDocument()
    expect(container.querySelector('button').style.border).toMatch(/2px/)
  })

  it('stays quiet where nobody is set', () => {
    show({ leader: null })
    expect(screen.getByText('Nobody set')).toBeInTheDocument()
  })
})

describe('the calendar entry that said it again', () => {
  // "There is another calendar entry down the bottom for team leader, but
  // that's a double up as well. That doesn't need to be there."
  const WEEK = {
    startDate: '2026-10-12',
    endDate: '2026-10-18',
    days: ['2026-10-12', '2026-10-13', '2026-10-14',
      '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
  }
  const planFor = events =>
    buildWeekPlan(events, WEEK, { generatedAt: '2026-10-11T00:00:00.000Z' })

  it('is kept off the day, since the strip already carries it', () => {
    const day = planFor([
      { id: 'tl', summary: 'Ben - Spine Team Leader',
        start: { date: '2026-10-12' }, end: { date: '2026-10-17' } }
    ]).days[0]
    const everything = [
      ...(day.flags || []).map(f => f.text),
      ...(day.otherRollup || []).map(i => i.title),
      ...(day.nonSurgeonItems || []).map(i => i.title)
    ]
    expect(everything.some(t => /team leader/i.test(t || ''))).toBe(false)
  })

  it('keeps a handover, which is an event rather than a standing fact', () => {
    const day = planFor([
      { id: 'ho', summary: 'Team leader handover Friday 12pm',
        start: { date: '2026-10-12' }, end: { date: '2026-10-13' } }
    ]).days[0]
    expect((day.flags || []).some(f => /handover/i.test(f.text))).toBe(true)
  })

  it('leaves the calendar entry itself alone', () => {
    // Dropped from the page, not from Google. The entry is how the roster is
    // kept and it stays exactly where it is; it is simply not news on a page
    // that already carries the answer.
    const plan = planFor([
      { id: 'tl', summary: 'Ben - Spine Team Leader',
        start: { date: '2026-10-12' }, end: { date: '2026-10-17' } }
    ])
    expect((plan.readings || []).some(r => /Team Leader/i.test(r.title))).toBe(true)
  })
})
