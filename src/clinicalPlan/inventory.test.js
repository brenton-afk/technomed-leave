import { describe, it, expect } from 'vitest'
import { inventoryFor, loanNeed, kitArrivalBy, isRush, INVENTORY, dayShortfall } from './inventory.js'
import { systemsInKit, resolveE4Product, resolveKit } from './systems.js'

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

describe('two cases, one kit, same day', () => {
  it('catches a second Diplomat at RHH', () => {
    // The case that prompted this: a Friday already had a Diplomat booking, a
    // second was added by voice, and both said "Consignment". RHH holds one.
    const short = dayShortfall('Diplomat', 'RHH', 2)
    expect(short).toBeTruthy()
    expect(short.held).toBe(1)
    expect(short.short).toBe(1)
    // Calvary has three, so moving one beats ordering one.
    expect(short.from).toBe('Calvary')
    expect(short.reason).toMatch(/Borrow one from Calvary, which has 3/)
  })

  it('says nothing about a single case', () => {
    expect(dayShortfall('Diplomat', 'RHH', 1)).toBeNull()
  })

  it('knows Calvary can take three Diplomats and not four', () => {
    expect(dayShortfall('Diplomat', 'CLV', 3)).toBeNull()
    expect(dayShortfall('Diplomat', 'CLV', 4)).toBeTruthy()
  })

  it('asks for a loan when there is nothing to borrow', () => {
    // Calvary holds no Mariner, so a second one at RHH cannot be covered by
    // moving a set across.
    const short = dayShortfall('Mariner', 'RHH', 2)
    expect(short.from).toBeNull()
    expect(short.reason).toMatch(/loan set has to be requested/)
  })

  it('counts the floating kit, which is a real set', () => {
    // Dakota: one at RHH plus the floating one. Two cases are covered, three
    // are not.
    expect(dayShortfall('Dakota', 'RHH', 2)).toBeNull()
    expect(dayShortfall('Dakota', 'RHH', 3)).toBeTruthy()
  })

  it('stays out of what is not ours', () => {
    // A competitor's cage, and KT's Calvary sets, are not our problem to solve.
    expect(dayShortfall('Cascadia', 'RHH', 3)).toBeNull()
    expect(dayShortfall('Lonestar', 'CLV', 3)).toBeNull()
  })

  it('does not guess at an unrecognised hospital or system', () => {
    expect(dayShortfall('Diplomat', 'Somewhere else', 3)).toBeNull()
    expect(dayShortfall('Not a system', 'RHH', 3)).toBeNull()
  })
})

describe('the names a system is written under', () => {
  // Two naming schemes for one product: the detector called it "E4 Global PLIF"
  // and the inventory "Global BMD PLIF". A booking that spelled the product out
  // properly matched nothing — no loan verdict, no clash check — on every PLIF
  // that named its cage.
  it('finds the inventory entry however the booking spells it', () => {
    for (const written of ['Global BMD PLIF', 'E4 Global PLIF', 'Global PLIF', 'global bmd plif']) {
      const found = systemsInKit(written)
      expect(found, written).toContain('Global BMD PLIF')
      expect(inventoryFor(found[0]), written).toBeTruthy()
    }
  })

  it('does the same for the ALIF cage', () => {
    for (const written of ['Global BMD ALIF', 'E4 Global ALIF']) {
      expect(systemsInKit(written), written).toContain('Global BMD ALIF')
    }
  })

  it('every system a kit line resolves to is one we hold', () => {
    // The check that would have caught it. A system the app names but the
    // inventory has never heard of gives no supply answer and no clash warning,
    // and does so silently.
    const kits = [
      'Diplomat (Consignment)', 'Global BMD PLIF', 'Mariner (Monoaxial Screws)',
      'Dakota', 'Reform Cervical (Loan set)', 'Athlet + Ascot', 'CYLOX (LOAN)',
      'Diplomat + Global BMD PLIF', 'Shoreline', 'Lonestar (KT Medical)'
    ]
    const missing = []
    for (const kit of kits) {
      for (const system of systemsInKit(kit)) {
        if (!inventoryFor(system)) missing.push(`${kit} → ${system}`)
      }
    }
    expect(missing).toEqual([])
  })
})

describe('what Thani writes', () => {
  it('reads "E4 cages" on a PLIF as the Global BMD PLIF cage', () => {
    // On a PLIF there is no other E4 product it could be.
    expect(resolveE4Product('E4 cages', 'L4/5 PLIF')).toBe('Global BMD PLIF')
    expect(resolveE4Product('E4 cages', 'L5/S1 PLIF and PSF')).toBe('Global BMD PLIF')
  })

  it('leaves "E4 cages" alone when nothing says which', () => {
    // E4 make four products and the wrong one is a tray nobody can use.
    expect(resolveE4Product('E4 cages', '')).toBeNull()
    expect(resolveE4Product('E4 cages', 'C5/6 ACDF')).toBeNull()
  })

  it('does not override a product that was named outright', () => {
    expect(resolveE4Product('E4 Dakota', 'L4/5 PLIF')).toBeNull()
    expect(resolveE4Product('Global BMD ALIF', 'L5/S1 PLIF')).toBeNull()
  })
})

describe('the kit line, resolved wherever it is read', () => {
  // The fix kept not taking: it was applied only where an email is read, so a
  // candidate already queued — and a booking already on the calendar — went on
  // naming a product nobody can bring. It runs in one place now and is called
  // from every path that shows or writes a kit.
  it('turns Implanet into Diplomat', () => {
    // Implanet is not a pedicle screw system and we do not carry it.
    expect(resolveKit('Implanet', 'L4/5 pedicle screw fixation')).toBe('Diplomat')
    expect(resolveKit('IMPLANET', '')).toBe('Diplomat')
  })

  it('names the E4 cage on a PLIF', () => {
    expect(resolveKit('E4 Cages', 'L5/S1 PLIF')).toBe('Global BMD PLIF')
    expect(resolveKit('Implanet + E4 Cages', 'L4/5 PLIF'))
      .toBe('Diplomat + Global BMD PLIF')
  })

  it('leaves E4 alone where the procedure does not settle it', () => {
    expect(resolveKit('E4 Cages', 'C5/6 ACDF')).toBe('E4 Cages')
  })

  it('resolves to systems the inventory actually holds', () => {
    // The whole point: a kit line nobody can act on is the failure.
    const kit = resolveKit('Implanet + E4 Cages', 'L4/5 PLIF')
    for (const system of systemsInKit(kit)) {
      expect(inventoryFor(system), system).toBeTruthy()
    }
  })

  it('leaves an ordinary kit line untouched', () => {
    expect(resolveKit('Diplomat (Consignment)', 'L4/5 PLIF')).toBe('Diplomat (Consignment)')
    expect(resolveKit('Dakota', 'C5/6 ACDF')).toBe('Dakota')
    expect(resolveKit('', 'L4/5 PLIF')).toBe('')
  })
})
