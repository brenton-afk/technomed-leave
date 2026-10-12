import { describe, it, expect, vi } from 'vitest'
import {
  hobartRules, hobartHolidays, parseHolidayCsv, regattaDay,
  holidayEventId, holidayTitle, dayAfter, SOURCES, PUBLIC_SERVICE_NOTE
} from './publicHolidays.js'

// ─── Hobart's public holidays ────────────────────────────────────────────────
// "The portal adds Hobart public holidays to the bookings calendar
// automatically, so nobody has to ask for them."
//
// A public holiday is not really a day off for this team: it is a day the
// hospitals do not run elective lists. Getting the list wrong in either
// direction costs something real — a kit ordered for a Monday nobody is
// operating on, or a case nobody knew was going ahead.

/** The shape the national dataset's CSV actually has, verbatim. */
const CSV_HEADER = 'Date,Holiday Name,Information,More Information,Jurisdiction'
const row = (date, name, juris = 'tas') => `${date},${name},,,${juris}`

describe('the Hobart rules', () => {
  it('keeps the Royal Hobart Regatta', () => {
    // Southern Tasmania, the second Monday in February. The national dataset
    // has never carried it in its tas rows, so it is added rather than
    // filtered in — which is why this is tested on a list without it.
    const kept = hobartRules([
      { date: '2026-01-01', name: "New Year's Day" }
    ], 2026)
    expect(kept.map(h => h.name)).toContain('Royal Hobart Regatta')
    expect(kept.find(h => h.name === 'Royal Hobart Regatta').date).toBe('2026-02-09')
  })

  it('does not add a second Regatta when the source already has one', () => {
    const kept = hobartRules([
      { date: '2026-02-09', name: 'Royal Hobart Regatta' }
    ], 2026)
    expect(kept.filter(h => /regatta/i.test(h.name))).toHaveLength(1)
  })

  it('drops Recreation Day, which is northern Tasmania', () => {
    const kept = hobartRules([
      { date: '2026-11-02', name: 'Recreation Day' },
      { date: '2026-01-01', name: "New Year's Day" }
    ], 2026)
    expect(kept.map(h => h.name)).not.toContain('Recreation Day')
    expect(kept.map(h => h.name)).toContain("New Year's Day")
  })

  it('keeps Easter Tuesday and says what it is', () => {
    // It is a holiday for the Tasmanian State Service only. Treating it as a
    // day off would be wrong; leaving it out would lose the reason a list is
    // short that week.
    const kept = hobartRules([
      { date: '2026-04-07', name: 'Easter Tuesday - generally Tasmanian Public Service only' }
    ], 2026)
    const tuesday = kept.find(h => /Easter Tuesday/.test(h.name))
    expect(tuesday.name).toBe(`Easter Tuesday ${PUBLIC_SERVICE_NOTE}`)
    expect(tuesday.publicServiceOnly).toBe(true)
  })

  it('writes ANZAC the way the country does', () => {
    const kept = hobartRules([{ date: '2026-04-25', name: 'Anzac Day' }], 2026)
    expect(kept.map(h => h.name)).toContain('ANZAC Day')
  })

  it('puts them in date order and does not repeat one', () => {
    const kept = hobartRules([
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-01-01', name: "New Year's Day" }
    ], 2026)
    expect(kept.map(h => h.date)).toEqual(['2026-01-01', '2026-02-09', '2026-12-25'])
  })

  it('knows when the Regatta is', () => {
    // Second Monday in February.
    expect(regattaDay(2026)).toBe('2026-02-09')
    expect(regattaDay(2027)).toBe('2027-02-08')
    expect(regattaDay(2025)).toBe('2025-02-10')
  })
})

describe('reading the dataset', () => {
  it('takes the Tasmanian rows and leaves the rest', () => {
    const csv = [CSV_HEADER,
      row('20260101', "New Year's Day", 'tas'),
      row('20260126', 'Australia Day', 'nsw'),
      row('20260309', 'Eight Hours Day', 'TAS')
    ].join('\n')
    const rows = parseHolidayCsv(csv, 2026)
    expect(rows.map(r => r.name)).toEqual(["New Year's Day", 'Eight Hours Day'])
  })

  it('turns the dataset’s date format into a real one', () => {
    const rows = parseHolidayCsv([CSV_HEADER, row('20260101', "New Year's Day")].join('\n'))
    expect(rows[0].date).toBe('2026-01-01')
  })

  it('survives a holiday name with a comma in it', () => {
    // The names carry commas — "Easter Tuesday - generally Tasmanian Public
    // Service only" has not, but others have. Splitting on every comma would
    // shift the jurisdiction out of its column and silently drop every row.
    const csv = [CSV_HEADER,
      '20260407,"Easter Tuesday, public service",,,tas'
    ].join('\n')
    const rows = parseHolidayCsv(csv, 2026)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Easter Tuesday, public service')
  })

  it('refuses a CSV whose columns have moved', () => {
    // Better to fall back to the file than to read the wrong column and
    // confidently produce nothing.
    expect(() => parseHolidayCsv('A,B,C\n1,2,3')).toThrow(/columns/)
  })
})

describe('where the answer came from', () => {
  const packageShow = resources => ({
    ok: true, json: async () => ({ result: { resources } })
  })

  it('uses the API when it has the year', async () => {
    const fetchImpl = vi.fn(async url => {
      if (String(url).includes('package_show')) {
        return packageShow([
          { name: 'Australian Public Holidays 2026', format: 'CSV', url: 'https://x/2026.csv' }
        ])
      }
      return {
        ok: true,
        text: async () => [CSV_HEADER,
          row('20260101', "New Year's Day"),
          row('20261102', 'Recreation Day')
        ].join('\n')
      }
    })

    const answer = await hobartHolidays(2026, { fetchImpl })
    expect(answer.source).toBe(SOURCES.api)
    expect(answer.holidays.map(h => h.name)).toContain("New Year's Day")
    // The rules still apply to what the API gave us.
    expect(answer.holidays.map(h => h.name)).not.toContain('Recreation Day')
    expect(answer.holidays.map(h => h.name)).toContain('Royal Hobart Regatta')
  })

  it('falls back to the file when the year is not in the dataset', async () => {
    // This is the ordinary case, not the edge one. The dataset is titled
    // [INACTIVE] and its newest resource is 2025, so no year this syncs for
    // is in it.
    const fetchImpl = vi.fn(async () => packageShow([
      { name: 'Australian Public Holidays 2025', format: 'CSV', url: 'https://x/2025.csv' }
    ]))

    const answer = await hobartHolidays(2026, { fetchImpl })
    expect(answer.source).toBe(SOURCES.fallback)
    expect(answer.apiError).toMatch(/No 2026 resource/)
    expect(answer.holidays.length).toBeGreaterThan(8)
  })

  it('falls back when the API is down altogether', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network is gone') })
    const answer = await hobartHolidays(2027, { fetchImpl })
    expect(answer.source).toBe(SOURCES.fallback)
    expect(answer.apiError).toMatch(/network is gone/)
  })

  it('falls back when the API answers with nonsense', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    const answer = await hobartHolidays(2026, { fetchImpl })
    expect(answer.source).toBe(SOURCES.fallback)
  })

  it('throws for a year nobody has written down', async () => {
    // Neither source knows. Worth stopping for: it means the checked-in file
    // needs another year adding, and silently syncing nothing would hide that
    // until somebody noticed an empty January.
    const fetchImpl = vi.fn(async () => { throw new Error('nope') })
    await expect(hobartHolidays(2099, { fetchImpl })).rejects.toThrow(/2099/)
  })

  it('carries the Regatta and marks Easter Tuesday on the fallback path too', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('nope') })
    const answer = await hobartHolidays(2026, { fetchImpl })
    const names = answer.holidays.map(h => h.name)
    expect(names).toContain('Royal Hobart Regatta')
    expect(names.some(n => n.includes(PUBLIC_SERVICE_NOTE))).toBe(true)
    expect(names).not.toContain('Recreation Day')
  })
})

describe('what goes on the calendar', () => {
  it('makes an id Google will accept', () => {
    // base32hex: lowercase a-v and digits, at least five characters.
    const id = holidayEventId('2026-02-09')
    expect(id).toBe('tmph20260209')
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/)
  })

  it('makes the same id every time, which is the whole of idempotency', () => {
    expect(holidayEventId('2026-12-25')).toBe(holidayEventId('2026-12-25'))
  })

  it('keys on the date and not the name, so a rename is not a second entry', () => {
    expect(holidayEventId('2026-12-28')).toBe('tmph20261228')
  })

  it('titles them the way the brief asked', () => {
    expect(holidayTitle({ name: 'Royal Hobart Regatta' }))
      .toBe('Public Holiday – Royal Hobart Regatta')
  })

  it('ends an all-day event on the following day, as Google wants', () => {
    expect(dayAfter('2026-02-09')).toBe('2026-02-10')
    // Across a month, and across a year.
    expect(dayAfter('2026-12-31')).toBe('2027-01-01')
    expect(dayAfter('2028-02-28')).toBe('2028-02-29')
  })

  it('refuses a date it cannot make an id from', () => {
    expect(() => holidayEventId('next Tuesday')).toThrow()
  })
})
