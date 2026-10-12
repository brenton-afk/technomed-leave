import { describe, it, expect } from 'vitest'
import { similarity, keyWords, likelyRepeat, flagRepeats } from './_worklistMatch.js'

// ─── "Haven't we said this already?" ─────────────────────────────────────────
// A standing item — chase the Globus paperwork, book the Calvary in-service —
// gets said again every Monday until it is done, and each meeting produces
// another copy. Three weeks of that and the list stops being believed, which is
// worse than it being short.
//
// Flagged, never merged. Two tasks that read alike are sometimes two different
// jobs, and a person reading both in two seconds can tell where this cannot.

const open = (id, task, assignee = 'Unassigned', extra = {}) =>
  ({ id, task, assignee, status: 'open', ...extra })

describe('what counts as the same task', () => {
  it('catches the same action said again', () => {
    const found = likelyRepeat(
      { task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt' },
      [open('a', 'Follow up the Globus paperwork', 'Toni Hoppitt')])
    expect(found).toBeTruthy()
    expect(found.task).toBe('Follow up the Globus paperwork')
  })

  it('ignores the verb everything starts with', () => {
    // "Follow up", "chase", "ring", "check" begin almost every action. Leaving
    // them in made everything match everything.
    expect(keyWords('Follow up with Device about the tray')).not.toContain('follow')
    expect(similarity('Chase Device about the Mariner', 'Chase E4 about the cages'))
      .toBeLessThan(0.45)
  })

  it('does not call two different jobs the same', () => {
    expect(likelyRepeat(
      { task: 'Book the Calvary in-service', assignee: 'Aimee Vulinovich' },
      [open('a', 'Book the RHH in-service', 'Aimee Vulinovich')])).toBeNull()
  })

  it('will not match on one shared word', () => {
    // "Mariner" alone is a coincidence, not a repeat.
    expect(likelyRepeat(
      { task: 'Order a Mariner tray', assignee: 'Ben Cassidy' },
      [open('a', 'Return the Mariner outrigger to RHH', 'Ben Cassidy')])).toBeNull()
  })

  it('leaves a finished task alone', () => {
    // A job done in September that comes up again in October is a new job.
    // Flagging it would tell somebody to dismiss the thing they should do.
    expect(likelyRepeat(
      { task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt' },
      [open('a', 'Chase the Globus paperwork', 'Toni Hoppitt', { status: 'done' })]))
      .toBeNull()
  })

  it('leaves an archived one alone too', () => {
    expect(likelyRepeat(
      { task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt' },
      [open('a', 'Chase the Globus paperwork', 'Toni Hoppitt', { status: 'archived' })]))
      .toBeNull()
  })
})

describe('whose task it is', () => {
  it('does not match two people given similar jobs', () => {
    // Toni's and Ben's are two tasks even when they read alike.
    expect(likelyRepeat(
      { task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt' },
      [open('a', 'Chase the Globus paperwork', 'Ben Cassidy')])).toBeNull()
  })

  it('does match when one of them has nobody on it yet', () => {
    expect(likelyRepeat(
      { task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt' },
      [open('a', 'Chase the Globus paperwork', 'Unassigned')])).toBeTruthy()
    expect(likelyRepeat(
      { task: 'Chase the Globus paperwork', assignee: 'Unassigned' },
      [open('a', 'Chase the Globus paperwork', 'Ben Cassidy')])).toBeTruthy()
  })
})

describe('what the flag carries', () => {
  it('says which item, and when it was agreed', () => {
    const found = likelyRepeat(
      { task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt' },
      [open('a', 'Chase the Globus paperwork', 'Toni Hoppitt', {
        sourceMeetingTitle: 'Spine team weekly',
        sourceMeetingDate: '2026-09-28'
      })])
    expect(found).toMatchObject({
      id: 'a',
      sourceMeetingTitle: 'Spine team weekly',
      sourceMeetingDate: '2026-09-28'
    })
    expect(found.score).toBeGreaterThan(0.45)
  })

  it('picks the closest where several are near', () => {
    const found = likelyRepeat(
      { task: 'Chase the Globus onboarding paperwork', assignee: 'Unassigned' },
      [
        open('far', 'Chase the Globus paperwork sometime'),
        open('near', 'Chase the Globus onboarding paperwork')
      ])
    expect(found.id).toBe('near')
  })
})

describe('flagging a whole draft', () => {
  const drafts = [
    { task: 'Chase the Globus paperwork', assignee: 'Toni Hoppitt' },
    { task: 'Order two Reform screws for Thursday', assignee: 'Ben Cassidy' }
  ]
  const board = [open('a', 'Chase the Globus paperwork', 'Toni Hoppitt')]

  it('marks only the one that repeats', () => {
    const out = flagRepeats(drafts, board)
    expect(out[0].possibleRepeatOf).toBeTruthy()
    expect(out[1].possibleRepeatOf).toBeUndefined()
  })

  it('changes nothing else about the item', () => {
    // It is a flag on the side, not a rewrite. The task somebody reviews is
    // the task the model wrote.
    const out = flagRepeats(drafts, board)
    expect(out[0].task).toBe('Chase the Globus paperwork')
    expect(out[0].assignee).toBe('Toni Hoppitt')
  })

  it('copes with an empty board, which is every first meeting', () => {
    expect(flagRepeats(drafts, [])).toHaveLength(2)
    expect(flagRepeats(drafts, []).every(i => !i.possibleRepeatOf)).toBe(true)
  })

  it('copes with nothing at all', () => {
    expect(flagRepeats()).toEqual([])
    expect(flagRepeats(null, null)).toEqual([])
  })
})
