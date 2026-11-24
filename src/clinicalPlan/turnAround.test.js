import { describe, it, expect } from 'vitest'
import { afterCase, kitAfterEmail, returnTo, swapCandidates, swapKitSupply, retitleSupply } from './turnAround.js'

// Brent, 21 Nov 2026: hold a loan kit for the next case, priority tags when
// it is wanted the next day, else where it goes back to. Invented names.
const caseAt = (over = {}) => ({ id: 'c1', patient: 'Testcase', surgeon: 'JPW', date: '2026-12-01', hour: 8, hospital: 'Calvary', supplies: [{ system: 'Reform Cervical', supply: 'Distributor Loan' }], ...over })
const booking = (over = {}) => ({ id: 'b2', patient: 'Laterone', surgeon: 'Ankush', date: '2026-12-04', hour: 8, hospital: 'Calvary', cancelled: false, supplies: [{ system: 'Reform', supply: 'Distributor Loan' }], ...over })

describe('what happens to a kit after the case', () => {
  it('finds the next case at the same hospital wanting the loan kit', () => {
    const [k] = afterCase(caseAt(), [booking(), booking({ id: 'x', hospital: 'RHH', date: '2026-12-02' })])
    expect(k).toMatchObject({ system: 'Reform Cervical', kind: 'distributor', distributorName: 'E4 Surgical', site: 'CLV', priority: false })
    expect(k.next).toMatchObject({ id: 'b2', patient: 'Laterone', surgeon: 'Ankush' })
  })
  it('wanted the next day is a priority', () => {
    expect(afterCase(caseAt(), [booking({ date: '2026-12-02' })])[0].priority).toBe(true)
  })
  it('no later case: asks where it goes — the distributor, or the office for a TM loan set', () => {
    const [k] = afterCase(caseAt(), [booking({ cancelled: true })])
    expect(k.next).toBeNull()
    expect(returnTo(k)).toBe('E4 Surgical')
    const [tm] = afterCase(caseAt({ supplies: [{ system: 'Dakota', supply: 'TM Loan' }] }), [])
    expect(returnTo(tm)).toBe('the TechnoMed office')
  })
  it('a consignment kit is asked about only when it is wanted again the next day', () => {
    const c = caseAt({ supplies: [{ system: 'Diplomat', supply: 'Consignment' }] })
    expect(afterCase(c, [booking({ supplies: [{ system: 'Diplomat', supply: 'Consignment' }], date: '2026-12-09' })])).toEqual([])
    const [k] = afterCase(c, [booking({ supplies: [{ system: 'Diplomat', supply: 'Consignment' }], date: '2026-12-02' })])
    expect(k).toMatchObject({ kind: 'consignment', priority: true })
  })
  it('the hospital email asks to hold it and turn it around, priority when next day', () => {
    const theCase = caseAt()
    const [k] = afterCase(theCase, [booking({ date: '2026-12-02' })])
    const m = kitAfterEmail({ greeting: 'Sharon and Loans team', theCase, entry: k, outcome: 'hold' })
    expect(m.subject).toMatch(/Hold the Reform Cervical kit/)
    expect(m.text).toMatch(/Hi Sharon and Loans team/)
    expect(m.text).toMatch(/turning it around for pt Laterone with Ankush/)
    expect(m.text).toMatch(/don't send it back to E4 Surgical/)
    expect(m.text).toMatch(/priority/)
    const back = kitAfterEmail({ theCase, entry: { ...k, next: null }, outcome: 'return' })
    expect(back.text).toMatch(/send it back to E4 Surgical/)
  })
})

describe('which patient was the set actually used for (Ben, 24 Nov 2026)', () => {
  const hart = { id: 'h', date: '2026-11-24', hour: 11, hospital: 'CLV', patient: 'Pt A', supplies: [{ system: 'Dakota', supply: 'TM Loan' }] }
  const next = { id: 'c', date: '2026-11-24', hour: 13, hospital: 'CLV', patient: 'Pt B', surgeon: 'Ibbett', supplies: [{ system: 'Dakota', supply: 'Consignment' }] }
  const other = { id: 'x', date: '2026-11-24', hour: 9, hospital: 'RHH', patient: 'Pt C', supplies: [{ system: 'Dakota', supply: 'Consignment' }] }
  const later = { ...next, id: 'l', date: '2026-11-25' }

  it('offers only the same day, same hospital, same system on a different set', () => {
    const got = swapCandidates(hart, [hart, next, other, later], 'Dakota')
    expect(got.map(c => c.id)).toEqual(['c'])
    expect(got[0]).toMatchObject({ patient: 'Pt B', supply: 'Consignment' })
  })

  it('swaps that system only and keeps everything else on both kit lines', () => {
    const out = swapKitSupply('Dakota (TM Loan) / BRAINLAB AIRO & CURVE', 'Dakota (Consignment) / Lonestar (Consignment) (open screws)', 'Dakota')
    expect(out.a).toBe('Dakota (Consignment) / BRAINLAB AIRO & CURVE')
    expect(out.b).toBe('Dakota (TM Loan) / Lonestar (Consignment) (open screws)')
    expect(out.was).toEqual({ a: 'TM Loan', b: 'Consignment' })
  })

  it('refuses when a line lacks the system or both are on the same set', () => {
    expect(swapKitSupply('Lonestar (Consignment)', 'Dakota (TM Loan)', 'Dakota')).toBeNull()
    expect(swapKitSupply('Dakota (TM Loan)', 'Dakota (TM Loan)', 'Dakota')).toBeNull()
  })

  it('retitles only a title that names the old set', () => {
    expect(retitleSupply('Pt A Dakota (TM Loan) - Ibbett (Ben)', 'TM Loan', 'Consignment')).toBe('Pt A Dakota (Consignment) - Ibbett (Ben)')
    expect(retitleSupply('Pt B DAKOTA - Ibbett', 'Consignment', 'TM Loan')).toBe('Pt B DAKOTA - Ibbett')
  })
})
