import { it, expect } from 'vitest'
import { suppliesFor } from './CaseWeek.jsx'

// Calvary's Varioguide 2.0 shows on the card like a system (Brent, 23 Nov
// 2026) — with no supply, since it is consigned there and is navigation.

it('adds a Varioguide 2.0 chip to a Calvary needle biopsy with no kit line', () => {
  const chips = suppliesFor({ hospital: 'CLV', operation: 'Brainlab Stereotactic Needle Biopsy', supplies: [] })
  expect(chips).toEqual([{ system: 'Varioguide 2.0', navigation: true, inferred: false }])
})

it('shows a written Varioguide as the chip, once, beside the real systems', () => {
  const chips = suppliesFor({ hospital: 'Calvary Lenah Valley', operation: 'Stereotactic needle biopsy',
    supplies: [{ system: 'Varioguide 2.0', navigation: true }] })
  expect(chips.map(c => c.system)).toEqual(['Varioguide 2.0'])
})

it('leaves other navigation off and RHH biopsies alone', () => {
  expect(suppliesFor({ hospital: 'RHH', operation: 'Stereotactic needle biopsy', supplies: [{ system: 'BRAINLAB AIRO & CURVE', navigation: true }] })).toBeNull()
  const chips = suppliesFor({ hospital: 'CLV', operation: 'L4/5 PLIF', supplies: [{ system: 'Diplomat', supply: 'Consignment' }, { system: 'BRAINLAB', navigation: true }] })
  expect(chips.map(c => c.system)).toEqual(['Diplomat'])
})
