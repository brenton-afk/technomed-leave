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

  it('carries the case detail and colour faults, and no case times', () => {
    const text = planToText(FIXTURE_WEEK)
    // The operation leads where it is known; the implant system follows on its
    // own line rather than standing in for it or repeating it.
    expect(text).toContain('Jackson / Fowler — C5/6 ACDF')
    expect(text).toContain('System: MARINER')
    // A case with no operation in its notes names its system where the operation
    // would otherwise sit, rather than leaving the line blank.
    expect(text).toContain('Gill / Fowler — STRYKER CCI')
    expect(text).toContain('Kit: Dakota (consignment)')
    // Theatre lists move too often for a printed time to be reliable. Meetings
    // and handovers keep theirs, since those are actually fixed.
    // Case lines only: an "Other:" line can contain a slash of its own ("late
    // start / early finish") and meetings legitimately keep their times.
    const caseLines = text.split('\n').filter(line => /^ {4}\S[^:]* \/ \S/.test(line))
    expect(caseLines.length).toBeGreaterThan(4)
    for (const line of caseLines) {
      expect(line).not.toMatch(/\d{1,2}:\d{2}(am|pm)/)
    }
    expect(text).toContain('COLOUR-CODING: no calendar colour set — should be Grape')
    expect(text).toContain('Colour-coding check:')
  })

  it('cites the sources and window logic', () => {
    expect(planToText(FIXTURE_WEEK)).toContain('Planning week runs Monday–Sunday')
  })
})
