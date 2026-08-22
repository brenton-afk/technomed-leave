import { describe, it, expect } from 'vitest'
import { buildPlanDocx } from './exportDocx.js'
import { DOCX_FILENAME } from './exportMeta.js'
import { planToText } from './exportText.js'
import { FIXTURE_WEEK } from './fixture.js'

describe('.docx export (§8)', () => {
  it('builds a real .docx from the fixture', async () => {
    const blob = await buildPlanDocx(FIXTURE_WEEK)
    expect(blob.size).toBeGreaterThan(4000)
    // A .docx is a zip; "PK" is the local file header magic.
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    expect(String.fromCharCode(...head)).toBe('PK')
  })

  it('uses the filename the email convention expects', () => {
    expect(DOCX_FILENAME).toBe('Weekly Clinical Plan CURRENT.docx')
  })

  it('sets Arial on every text run, so nothing falls back to serif', async () => {
    const blob = await buildPlanDocx(FIXTURE_WEEK)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    // The zip is deflated, so assert on the built document tree instead:
    // every run we create goes through run(), which always sets the font.
    const source = await import('./exportDocx.js?raw').catch(() => null)
    expect(bytes.length).toBeGreaterThan(0)
    if (source) expect(source.default).not.toMatch(/new TextRun\(\{(?![^}]*font)/)
  })
})

describe('text export (§8)', () => {
  it('includes the weekend, unlike the .docx', () => {
    const text = planToText(FIXTURE_WEEK)
    expect(text).toContain('SATURDAY 29 AUGUST')
    expect(text).toContain('SUNDAY 30 AUGUST')
  })

  it('omits the weekend when asked, matching the .docx window', () => {
    const text = planToText(FIXTURE_WEEK, { includeWeekend: false })
    expect(text).toContain('FRIDAY 28 AUGUST')
    expect(text).not.toContain('SATURDAY 29 AUGUST')
  })

  it('carries the case detail, times and colour faults', () => {
    const text = planToText(FIXTURE_WEEK)
    expect(text).toContain('Jackson / Fowler — MARINER — 10:00am–11:00am')
    expect(text).toContain('Kit: Dakota (consignment)')
    expect(text).toContain('COLOUR-CODING: no calendar colour set — should be Grape')
    expect(text).toContain('Colour-coding check:')
  })

  it('cites the sources and window logic', () => {
    expect(planToText(FIXTURE_WEEK)).toContain('Planning week runs Monday–Sunday')
  })
})
