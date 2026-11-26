import { describe, it, expect } from 'vitest'
import { cleanBox, redactionFrom, stampLines, pagesToCheck, stampBoxIndex, mergeLabel, dobWords, REDACTION_PROMPT } from './redactRules.js'

describe('cleanBox', () => {
  it('pads the box the reader gave and keeps it on the page', () => {
    expect(cleanBox({ x: 0.5, y: 0.05, w: 0.3, h: 0.1 })).toEqual({ x: 0.48, y: 0.035, w: 0.34, h: 0.13 })
    const edge = cleanBox({ x: 0.8, y: 0, w: 0.25, h: 0.1 })
    expect(edge.x + edge.w).toBeLessThanOrEqual(1)
    expect(edge.y).toBe(0)
  })
  it('reads percentages as percentages', () => {
    expect(cleanBox({ x: 50, y: 5, w: 30, h: 10 })).toEqual(cleanBox({ x: 0.5, y: 0.05, w: 0.3, h: 0.1 }))
  })
  it('grows a sliver to a size a label could be', () => {
    const b = cleanBox({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }, { pad: false })
    expect(b.w).toBeGreaterThanOrEqual(0.06)
    expect(b.h).toBeGreaterThanOrEqual(0.03)
  })
  it('drops nonsense', () => {
    expect(cleanBox(null)).toBeNull()
    expect(cleanBox({ x: 'a', y: 0, w: 1, h: 1 })).toBeNull()
    expect(cleanBox({ x: 0, y: 0, w: 0, h: 0.2 })).toBeNull()
  })
})

describe('redactionFrom', () => {
  it('page by page: each reading is its own page, whatever page number it gives', () => {
    const r = redactionFrom([
      { labels: [{ page: 3, x: 0.5, y: 0.05, w: 0.4, h: 0.1 }], patientLabel: { firstName: 'Jane', surname: 'Citizen', ur: '123456' } },
      { labels: [], dtbvPages: [2], patientLabel: { dob: '1956-04-03', sex: 'F' } }
    ], 2)
    expect(r.pages[0].boxes).toHaveLength(1)
    expect(r.pages[1]).toEqual({ boxes: [], dtbv: true })
    expect(r.label).toEqual({ firstName: 'Jane', surname: 'Citizen', ur: '123456', dob: '1956-04-03', sex: 'F' })
  })
  it('all pages at once: by the page numbers given', () => {
    const r = redactionFrom([{ labels: [{ page: 2, x: 0.1, y: 0.1, w: 0.3, h: 0.1 }], dtbvPages: [1] }], 2, { perPage: false })
    expect(r.pages[0]).toEqual({ boxes: [], dtbv: true })
    expect(r.pages[1].boxes).toHaveLength(1)
  })
  it('nothing read is nothing covered, and those pages are asked about', () => {
    const r = redactionFrom([], 2)
    expect(pagesToCheck(r)).toEqual([0, 1])
  })
})

describe('what is printed in place of the label', () => {
  const label = { firstName: 'Jane', surname: 'Citizen', ur: '123456', dob: '1956-04-03', sex: 'F' }
  it('every form: first name, surname, UR and the surgeon — never the date of birth or sex', () => {
    const lines = stampLines(label, 'Thani')
    expect(lines).toEqual(['Patient: Jane CITIZEN', 'UR: 123456', 'Surgeon: Thani'])
    expect(lines.join(' ')).not.toMatch(/1956|DOB|Sex/)
  })
  it('a DTBV allograft form: the date of birth and sex as well', () => {
    expect(stampLines(label, 'Thani', { dtbv: true })).toEqual(['Patient: Jane CITIZEN', 'UR: 123456', 'DOB: 03/04/1956  ·  Sex: F', 'Surgeon: Thani'])
  })
  it('no UR, no UR line', () => {
    expect(stampLines({ firstName: 'Jane', surname: 'Citizen' }, 'Thani')).toEqual(['Patient: Jane CITIZEN', 'Surgeon: Thani'])
  })
  it('printed in the biggest box', () => {
    expect(stampBoxIndex([{ w: 0.1, h: 0.1 }, { w: 0.3, h: 0.1 }, { w: 0.2, h: 0.1 }])).toBe(1)
  })
  it('details are short and clean', () => {
    expect(mergeLabel([{ firstName: '  Jane  ' }, { firstName: 'Other', ur: ' 42 ' }])).toMatchObject({ firstName: 'Jane', ur: '42' })
    expect(dobWords('3/4/56')).toBe('3/4/56')
  })
  it('the reader is told the first name, UR, birth date and sex go nowhere but the label', () => {
    expect(REDACTION_PROMPT).toMatch(/only place the first name, UR, date of birth or sex may be returned/)
  })
})
