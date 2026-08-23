import { describe, it, expect, beforeEach } from 'vitest'
import { readCachedPlan, planSignature, cacheKey } from './provider.js'
import { FIXTURE_WEEK } from './fixture.js'

// The cache holds a *derived* plan — the notes, the flags, the case lines — not
// the events it was built from. So it is only valid for the code that derived it.
//
// This is not hypothetical. Taking the colour note and the on-call line out of
// the week's notes changed nothing anyone could see, because every browser kept
// serving the plan the previous build had already written. A deploy that cannot
// be observed is indistinguishable from one that did not happen.

const WEEK = '2026-08-24'

beforeEach(() => localStorage.clear())

describe('the plan cache is only valid for the build that wrote it', () => {
  it('ignores a plan left by a different build', () => {
    localStorage.setItem(
      'tm_clinical_plan:0000000:2026-08-24',
      JSON.stringify({ plan: FIXTURE_WEEK, cachedAt: Date.now() }))
    expect(readCachedPlan(WEEK)).toBeNull()
    // And the key this build uses is not that one.
    expect(cacheKey(WEEK)).not.toBe('tm_clinical_plan:0000000:2026-08-24')
  })

  it('ignores a plan left by a build that stamped no version at all', () => {
    // The shape used before the key carried a build.
    localStorage.setItem(
      'tm_clinical_plan:2026-08-24',
      JSON.stringify({ plan: FIXTURE_WEEK, cachedAt: Date.now() }))
    expect(readCachedPlan(WEEK)).toBeNull()
  })

  it('survives a corrupt entry rather than failing the page', () => {
    localStorage.setItem(cacheKey(WEEK), 'not json')
    expect(readCachedPlan(WEEK)).toBeNull()
  })

  it('reads back a plan this build wrote', () => {
    localStorage.setItem(cacheKey(WEEK),
      JSON.stringify({ plan: FIXTURE_WEEK, cachedAt: Date.now() }))
    const cached = readCachedPlan(WEEK)
    expect(cached).not.toBeNull()
    expect(planSignature(cached.plan)).toBe(planSignature(FIXTURE_WEEK))
  })

  it('reports an old entry as stale so it gets refetched', () => {
    localStorage.setItem(cacheKey(WEEK),
      JSON.stringify({ plan: FIXTURE_WEEK, cachedAt: Date.now() - 10 * 60 * 1000 }))
    expect(readCachedPlan(WEEK).stale).toBe(true)
  })
})

describe('what the week now says', () => {
  // The notes are the week's one paragraph, so what is left out of them matters
  // as much as what is in.
  it('carries someone travelling, which changes who can cover a list', () => {
    expect(FIXTURE_WEEK.notes).toMatch(/travelling/)
  })

  it('carries nothing about colour', () => {
    expect(FIXTURE_WEEK.notes).not.toMatch(/colour/i)
  })

  it('carries nothing about the on-call rota or the team leader handover', () => {
    expect(FIXTURE_WEEK.notes).not.toMatch(/on call|on-call/i)
    expect(FIXTURE_WEEK.notes).not.toMatch(/team leader|handover/i)
  })

  it('leaves no colour-coding note on any case', () => {
    const notes = FIXTURE_WEEK.days
      .flatMap(d => d.casesByHospital.flatMap(g => g.cases.flatMap(c => c.notes || [])))
    expect(notes.some(n => n.kind === 'colourCoding')).toBe(false)
    expect(notes.some(n => /COLOUR-CODING/.test(n.text))).toBe(false)
  })
})
