import { describe, it, expect } from 'vitest'
import { caseSummaryText, caseSummaryTitle, summaryDate } from './caseSummary.js'

// Invented case. Toni's request, 4 Nov 2026: the case as the Google
// description shows it, ready to paste.
const sample = {
  patient: 'Sample', date: '2026-11-13', hospital: 'CLV', surgeon: 'Gupta',
  procedure: 'L4/5 PLIF',
  kit: 'Diplomat (Consignment) (open screws) / Global BMD PLIF (Consignment)',
  navigation: ['AIRO + Curve'], planned: ['Aimee', 'Mat'], notes: 'Second on the list'
}

describe('case summary', () => {
  it('reads like the booking description, one fact per line', () => {
    expect(caseSummaryText(sample)).toBe([
      'Patient: Sample',
      'Date: Fri 13 Nov 2026',
      'Hospital: Calvary',
      'Surgeon: Gupta',
      'Procedure: L4/5 PLIF',
      'Kit: Diplomat (Consignment) (open screws) / Global BMD PLIF (Consignment)',
      'Brainlab: AIRO + Curve',
      'Planned reps: Aimee, Mat',
      'Notes: Second on the list'
    ].join('\n'))
  })

  it('leaves out what is empty rather than printing a bare label', () => {
    expect(caseSummaryText({ surgeon: 'Thani', operation: 'C5/6 ACDF' })).toBe('Surgeon: Thani\nProcedure: C5/6 ACDF')
  })

  it('builds the kit from the week card\'s supplies when there is no kit line', () => {
    const text = caseSummaryText({ supplies: [{ system: 'Dakota', supply: 'Consignment' }] })
    expect(text).toBe('Kit: Dakota (Consignment)')
  })

  it('says when a case is cancelled', () => {
    expect(caseSummaryText({ surgeon: 'Fowler', cancelled: true })).toMatch(/Status: Cancelled/)
  })

  it('writes the day out, in Hobart terms', () => {
    expect(summaryDate('2026-11-13')).toBe('Fri 13 Nov 2026')
    expect(summaryDate('')).toBe('')
  })

  it('gives Share a subject line', () => {
    expect(caseSummaryTitle(sample)).toBe('Sample L4/5 PLIF – Gupta – Calvary Fri 13 Nov')
  })
})
