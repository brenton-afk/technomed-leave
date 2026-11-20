import { describe, it, expect } from 'vitest'
import { placesFromLoc, applyMove, trayPlace, movingFrom } from './trayPlaces.js'

// Brent, 20 Nov 2026: trays move on their own and are seen where they are,
// never absorbed into the other hospital's set. Invented kit.
const def = { id: 'd', home: 'RHH', trays: ['A', 'B', 'C'] }
const meta = { since: '2026-11-20T01:00:00Z', byName: 'Aimee' }

describe('where each tray is', () => {
  it('moves one tray on its own, the set stays put', () => {
    const loc = applyMove(def, null, { to: 'CLV', trays: ['A'], meta })
    expect(loc.at).toBe('RHH')
    const p = placesFromLoc(def, loc)
    expect(p.away).toBeNull()
    expect(p.trayAt).toEqual({ A: { at: 'CLV', ...meta } })
  })

  it('sends two trays to two places without one overwriting the other', () => {
    let loc = applyMove(def, null, { to: 'CLV', trays: ['A'], meta })
    loc = applyMove(def, loc, { to: 'office', trays: ['B'], meta })
    const kit = { ...def, ...placesFromLoc(def, loc) }
    expect([trayPlace(kit, 'A'), trayPlace(kit, 'B'), trayPlace(kit, 'C')]).toEqual(['CLV', 'office', 'RHH'])
    expect(movingFrom(kit, ['B'])).toBe('office')
  })

  it('a tray moved back to its set rejoins it', () => {
    let loc = applyMove(def, null, { to: 'CLV', trays: ['A'], meta })
    loc = applyMove(def, loc, { to: 'RHH', trays: ['A'], meta })
    expect(placesFromLoc(def, loc).trayAt).toEqual({})
  })

  it('the entire kit moves the set and brings every tray into it', () => {
    let loc = applyMove(def, null, { to: 'CLV', trays: ['A'], meta })
    loc = applyMove(def, loc, { to: 'CLV', trays: ['A', 'B', 'C'], meta })
    const p = placesFromLoc(def, loc)
    expect(p.at).toBe('CLV')
    expect(p.away).toBeTruthy()
    expect(p.trayAt).toEqual({})
    expect(placesFromLoc(def, applyMove(def, loc, { to: 'RHH', trays: ['A', 'B', 'C'] }))).toEqual({ at: 'RHH', away: null, trayAt: {} })
  })

  it('reads the old shape — the set away with some trays — as those trays away', () => {
    const old = { at: 'CLV', trays: ['B'], since: '2026-11-19T00:00:00Z', byName: 'Ben' }
    expect(placesFromLoc(def, old)).toEqual({ at: 'RHH', away: null, trayAt: { B: { at: 'CLV', since: '2026-11-19T00:00:00Z', byName: 'Ben' } } })
  })

  it('keeps the stock-take tick through a move', () => {
    const loc = applyMove(def, { checkedAt: 'x', checkedBy: 'Ben' }, { to: 'CLV', trays: ['A'], meta })
    expect(loc).toMatchObject({ checkedAt: 'x', checkedBy: 'Ben' })
  })
})
