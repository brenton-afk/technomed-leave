import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── The nightly sync ────────────────────────────────────────────────────────
// Two things worth proving, and neither is about the dates — those are tested
// in lib/publicHolidays.test.js.
//
//   · running it twice creates nothing the second time. It runs every night
//     for the rest of the year, so "idempotent" is not a nicety: a sync that
//     adds a duplicate adds 365 of them
//   · a preview deployment writes nothing. Previews share production's
//     environment variables and the admin portal is reachable on one, so
//     without the guard a branch would quietly fill the real bookings
//     calendar with entries somebody has to delete out of Google by hand

const calendar = { events: new Map(), creates: 0, patches: 0, listed: [] }

vi.mock('../api/_googleCalendar.js', () => ({
  listCalendarEvents: vi.fn(async () => calendar.listed),
  createCalendarEventWithId: vi.fn(async (id, body) => {
    if (calendar.events.has(id)) return { existed: true }
    calendar.events.set(id, body)
    calendar.creates += 1
    return { existed: false, event: { id, ...body } }
  }),
  updateCalendarEvent: vi.fn(async (id, body) => {
    calendar.events.set(id, body)
    calendar.patches += 1
    return { id, ...body }
  })
}))

vi.mock('../api/_auth.js', () => ({ requireSession: vi.fn(async () => null) }))

const { syncPublicHolidays } = await import('./cron/sync-public-holidays.js')

beforeEach(() => {
  calendar.events.clear()
  calendar.creates = 0
  calendar.patches = 0
  calendar.listed = []
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-10-12T00:00:00.000Z'))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('running it', () => {
  it('puts this year and next on the calendar', async () => {
    const result = await syncPublicHolidays()
    expect(result.years).toEqual([2026, 2027])
    expect(result.created.length).toBeGreaterThan(20)
    expect(result.failed).toEqual([])
  })

  it('says which source answered for each year', async () => {
    // The national dataset is inactive and ends at 2025, so this is expected
    // to read "checked-in file" — and the day it stops doing that is the day
    // the dates stop being ones we worked out ourselves.
    const result = await syncPublicHolidays()
    expect(result.sources.map(s => s.year)).toEqual([2026, 2027])
    for (const s of result.sources) expect(s.source).toBeTruthy()
  })

  it('writes all-day events that make nobody busy', async () => {
    await syncPublicHolidays()
    const regatta = calendar.events.get('tmph20260209')
    expect(regatta.summary).toBe('Public Holiday – Royal Hobart Regatta')
    expect(regatta.start).toEqual({ date: '2026-02-09' })
    expect(regatta.end).toEqual({ date: '2026-02-10' })
    expect(regatta.transparency).toBe('transparent')
  })

  it('writes no description, as asked', async () => {
    await syncPublicHolidays()
    for (const body of calendar.events.values()) {
      expect(body.description).toBeUndefined()
    }
  })
})

describe('running it again', () => {
  it('creates nothing the second time', async () => {
    const first = await syncPublicHolidays()
    const createdFirst = calendar.creates
    expect(createdFirst).toBeGreaterThan(0)

    const second = await syncPublicHolidays()
    expect(second.created).toEqual([])
    expect(calendar.creates).toBe(createdFirst)
    expect(second.updated.length).toBe(first.created.length)
  })

  it('leaves the calendar with exactly one entry per holiday', async () => {
    await syncPublicHolidays()
    const after = calendar.events.size
    await syncPublicHolidays()
    await syncPublicHolidays()
    expect(calendar.events.size).toBe(after)
  })

  it('corrects an entry whose name has changed', async () => {
    await syncPublicHolidays()
    calendar.events.set('tmph20260209', { summary: 'Public Holiday – Regatta Day' })
    await syncPublicHolidays()
    expect(calendar.events.get('tmph20260209').summary)
      .toBe('Public Holiday – Royal Hobart Regatta')
  })
})

describe('the colour', () => {
  it('matches what the calendar already uses, where that is a convention', async () => {
    calendar.listed = [
      { summary: 'Public Holiday - Christmas Day', colorId: '5' },
      { summary: 'Public Holiday - Boxing Day', colorId: '5' },
      { summary: 'Public Holiday - Easter Monday', colorId: '5' },
      { summary: 'Public Holiday - ANZAC Day', colorId: '9' }
    ]
    const result = await syncPublicHolidays()
    expect(result.colour).toEqual({ colorId: '5', matchedExisting: true })
  })

  it('does not call a near-even split a house style', async () => {
    // The real calendar is like this: some Graphite, some Tangerine, several
    // with no colour at all. "The commonest" would pick between two near-equal
    // piles and present the winner as the convention. It is not one.
    calendar.listed = [
      { summary: 'Public Holiday', colorId: '8' },
      { summary: 'Public Holiday', colorId: '8' },
      { summary: 'Public Holiday', colorId: '6' },
      { summary: 'Public Holiday', colorId: '6' }
    ]
    const result = await syncPublicHolidays()
    expect(result.colour).toEqual({ colorId: '11', matchedExisting: false })
  })

  it('ignores entries that are only inheriting the calendar default', async () => {
    // An event with no colorId says nothing about what a holiday should be.
    calendar.listed = [{ summary: 'Public Holiday - Christmas Day' }]
    const result = await syncPublicHolidays()
    expect(result.colour).toEqual({ colorId: '11', matchedExisting: false })
  })

  it('uses Tomato when there is nothing to match', async () => {
    const result = await syncPublicHolidays()
    expect(result.colour.colorId).toBe('11')
    expect(result.colour.matchedExisting).toBe(false)
  })
})

describe('a day somebody has already written in by hand', () => {
  // "Skip."
  //
  // The bookings calendar already carries some of these — "PUBLIC HOLIDAY -
  // AUSTRALIA DAY" on 26 January 2026, a plain "PUBLIC HOLIDAY" on the Regatta
  // and on Eight Hours Day. They are not ours and carry no id of ours, so
  // nothing about the upsert would recognise them: it would add its own beside
  // each and leave two entries on the day.
  const byHand = (date, summary = 'PUBLIC HOLIDAY') =>
    ({ id: 'handmade-1', summary, start: { date } })

  it('leaves theirs alone and writes nothing of its own', async () => {
    calendar.listed = [byHand('2026-02-09')]
    const result = await syncPublicHolidays()
    expect(result.skipped.map(s => s.date)).toContain('2026-02-09')
    expect(calendar.events.has('tmph20260209')).toBe(false)
  })

  it('says which day, and what was already on it', async () => {
    // "It added nothing" and "there was nothing to add" are different answers,
    // and only one of them means it is working.
    calendar.listed = [byHand('2026-01-26', 'PUBLIC HOLIDAY - AUSTRALIA DAY')]
    const result = await syncPublicHolidays()
    const skipped = result.skipped.find(s => s.date === '2026-01-26')
    expect(skipped.because).toBe('PUBLIC HOLIDAY - AUSTRALIA DAY')
  })

  it('still writes every other day', async () => {
    calendar.listed = [byHand('2026-02-09')]
    const result = await syncPublicHolidays()
    expect(result.created.length).toBeGreaterThan(20)
    expect(result.created).not.toContain('2026-02-09')
  })

  it('does not mistake school holidays for a public holiday', async () => {
    // The calendar has several of these. The pattern wants the two words
    // together, so "Public School Holidays" is not one.
    calendar.listed = [byHand('2026-02-09', 'Public School Holidays')]
    const result = await syncPublicHolidays()
    expect(result.skipped).toEqual([])
    expect(calendar.events.has('tmph20260209')).toBe(true)
  })

  it('does not treat its own earlier run as somebody else’s note', async () => {
    // Otherwise a holiday could never be corrected after the first night.
    await syncPublicHolidays()
    calendar.listed = [{ id: 'tmph20260209', summary: 'Public Holiday – Royal Hobart Regatta', start: { date: '2026-02-09' } }]
    const second = await syncPublicHolidays()
    expect(second.skipped).toEqual([])
    expect(second.updated).toContain('2026-02-09')
  })

  it('writes nothing at all if it cannot see what is there', async () => {
    // An empty answer from a failed read would duplicate every holiday
    // somebody had already put in, which is the one outcome worth stopping for.
    const { listCalendarEvents } = await import('../api/_googleCalendar.js')
    listCalendarEvents.mockRejectedValueOnce(new Error('calendar is down'))
    listCalendarEvents.mockRejectedValueOnce(new Error('calendar is down'))
    await expect(syncPublicHolidays()).rejects.toThrow(/already on it/)
    expect(calendar.creates).toBe(0)
  })
})

describe('on a deployment that may not write', () => {
  it('writes nothing at all', async () => {
    const result = await syncPublicHolidays({ dryRun: true })
    expect(result.ran).toBe(false)
    expect(result.dryRun).toBe(true)
    expect(calendar.creates).toBe(0)
    expect(calendar.patches).toBe(0)
    expect(calendar.events.size).toBe(0)
  })

  it('still says what it would have written', async () => {
    // The point of a preview: the dates can be checked before merging without
    // anything landing on the shared calendar.
    const result = await syncPublicHolidays({ dryRun: true })
    expect(result.holidays.map(h => h.name)).toContain('Royal Hobart Regatta')
    expect(result.sources).toHaveLength(2)
  })

  it('says why', async () => {
    const result = await syncPublicHolidays({ dryRun: true })
    expect(result.reason).toMatch(/deployment/)
  })
})
