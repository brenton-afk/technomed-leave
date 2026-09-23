import { describe, it, expect } from 'vitest'
import { inventoryFor, loanNeed, kitArrivalBy, isRush, INVENTORY } from './inventory.js'

// The inventory is dictated knowledge — it lives in people's heads and nowhere
// else — so these tests are really a written record of what was said, in a form
// that fails if the code stops agreeing with it.
//
// It also goes stale as sets are consigned and floating kits move. That is a
// reason to check it against reality, not a reason to distrust the tests: they
// pin what the app believes, which is exactly what needs to be visible when it
// turns out to be out of date.

describe('where the sets are', () => {
  it.each([
    ['Diplomat', 'CLV', 'none'],     // three consigned
    ['Diplomat', 'RHH', 'none'],     // one consigned
    ['Mariner', 'RHH', 'none'],      // one consigned
    ['Mariner', 'CLV', 'order'],     // none at Calvary — this one needs a loan
    ['Reform Cervical', 'RHH', 'none'],
    ['Reform Cervical', 'CLV', 'order'],   // RHH only, so Calvary must request
    ['Global BMD ALIF', 'CLV', 'none'],
    ['Global BMD ALIF', 'RHH', 'order'],   // Calvary only
    ['MOBIS', 'CLV', 'none'],
    ['MOBIS', 'RHH', 'order'],
    ['Ascot', 'CLV', 'none'],
    ['Ascot', 'RHH', 'none'],
    ['Dakota', 'CLV', 'none'],
    ['Dakota', 'RHH', 'none']
  ])('%s at %s → %s', (system, hospital, expected) => {
    expect(loanNeed(system, hospital).need).toBe(expected)
  })

  it('knows CYLOX is not consigned yet', () => {
    // Two loan sets, close to being consigned to Calvary but not yet — so a
    // CYLOX case still needs a set organised either way.
    expect(loanNeed('CYLOX', 'CLV').need).toBe('order')
    expect(loanNeed('CYLOX', 'RHH').need).toBe('order')
  })

  it('says "check where it is" for a kit that travels', () => {
    // Athlet's instrument kit lives at RHH and moves; the floating Shoreline and
    // Dakota kits are the same shape. Neither is a distributor request, but both
    // need somebody to confirm the kit is free.
    expect(loanNeed('Athlet', 'CLV').need).toBe('move')
    expect(loanNeed('Global BMD PLIF', 'RHH').need).toBe('move')
    expect(loanNeed('Mariner Outrigger', 'CLV').need).toBe('move')
  })
})

describe('sets that are not ours', () => {
  it('leaves KT Medical to cover their own Calvary cases', () => {
    // We use the RHH Lonestar for cases we cover there; KT cover Calvary unless
    // they ask us to assist.
    expect(loanNeed('Lonestar', 'RHH').need).toBe('none')
    expect(loanNeed('Lonestar', 'CLV').need).toBe('none')
    expect(loanNeed('Lonestar', 'CLV').reason).toMatch(/KT Medical/)
  })

  it('says the same for Orthofix Firebird and Forza XP', () => {
    // Peters-Willke cases: we help at RHH, mostly not at Calvary.
    for (const system of ['Orthofix Firebird', 'Forza XP']) {
      expect(loanNeed(system, 'CLV').reason, system).toMatch(/not us/)
    }
  })

  it('knows Cascadia belongs to a competitor', () => {
    // We attend those cases for the Diplomat; the cages are Life Health Care's.
    const need = loanNeed('Cascadia', 'CLV')
    expect(need.need).toBe('none')
    expect(need.reason).toMatch(/Life Health Care/)
  })
})

describe('when it does not know', () => {
  it('says so rather than saying no', () => {
    // A wrong "no loan needed" is a case with no instruments on the day, which
    // is the outcome this whole feature exists to prevent.
    expect(loanNeed('Something New', 'RHH').need).toBe('unknown')
    expect(loanNeed('Diplomat', 'Somewhere else').need).toBe('unknown')
  })

  it('reads a system out of a kit line as the team writes it', () => {
    expect(inventoryFor('Kit - Diplomat (Consignment)').system).toBe('Diplomat')
    expect(inventoryFor('MARINER (LOAN)').system).toBe('Mariner')
    // Longest match wins, or "Global BMD PLIF" could be answered by a shorter
    // entry that happens to appear inside it.
    expect(inventoryFor('Global BMD PLIF').system).toBe('Global BMD PLIF')
  })
})

describe('when the kit has to arrive', () => {
  // Stated as 48 hours, with two worked examples that look inconsistent until
  // the weekend is accounted for.
  it('puts a Thursday case\'s kit in on the Tuesday', () => {
    const by = kitArrivalBy('2026-09-24T08:00:00+10:00')
    expect(by.date).toBe('2026-09-22')
    expect(by.time).toBe('08:00')
  })

  it('pulls a Monday case back to Friday 9am', () => {
    // 48 hours before Monday morning is Saturday, and nobody receives a kit on
    // a Saturday.
    const by = kitArrivalBy('2026-09-21T08:00:00+10:00')
    expect(by.date).toBe('2026-09-18')
    expect(by.time).toBe('09:00')
  })

  it('does the same for a Tuesday case', () => {
    expect(kitArrivalBy('2026-09-22T08:00:00+10:00').date).toBe('2026-09-18')
  })

  it('says when there is no longer time', () => {
    // A booking that arrives inside the window is a phone call, not an email.
    expect(isRush('2026-09-24T08:00:00+10:00', new Date('2026-09-23T00:00:00+10:00'))).toBe(true)
    expect(isRush('2026-09-24T08:00:00+10:00', new Date('2026-09-20T00:00:00+10:00'))).toBe(false)
  })
})

describe('the inventory itself', () => {
  it('names a hospital count or says why not', () => {
    for (const item of INVENTORY) {
      const known = item.consigned && Object.keys(item.consigned).length > 0
      expect(known || item.floating || item.loanSets || item.competitor, item.system).toBeTruthy()
    }
  })
})
