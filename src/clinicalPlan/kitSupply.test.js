import { describe, it, expect } from 'vitest'
import {
  parseKitSupplies, formatKitSupplies, matchSupply, setSupply,
  systemsToSupply, SUPPLY_OPTIONS
} from './kitSupply.js'

// Three answers, and the difference between them is who has to do something:
// consignment is already there, an RHH loan is a tray our team moves on a
// particular morning, and a distributor loan is a request somebody has to send
// and chase. "Loan" covered the last two and hid exactly the distinction that
// decides whether a tray turns up.

describe('the options', () => {
  it('is the three that were asked for', () => {
    expect(SUPPLY_OPTIONS).toEqual(['Consignment', 'RHH Loan', 'Distributor Loan'])
  })
})

describe('matchSupply', () => {
  it('reads each of the three', () => {
    expect(matchSupply('Consignment')).toBe('Consignment')
    expect(matchSupply('RHH Loan')).toBe('RHH Loan')
    expect(matchSupply('Distributor Loan')).toBe('Distributor Loan')
  })

  it('reads how people actually write them', () => {
    expect(matchSupply('consigned')).toBe('Consignment')
    expect(matchSupply('cons')).toBe('Consignment')
    expect(matchSupply('loan from RHH')).toBe('RHH Loan')
    expect(matchSupply('rhh-loan')).toBe('RHH Loan')
    expect(matchSupply('loan from distributor')).toBe('Distributor Loan')
  })

  it('puts the specific ones before the general one', () => {
    // "RHH Loan" contains "loan". Checked in the wrong order, both specific
    // answers collapse into the vague one they were added to replace.
    expect(matchSupply('RHH Loan')).not.toBe('Loan')
    expect(matchSupply('Distributor Loan')).not.toBe('Loan')
  })

  it('leaves an old bare "Loan" as it is', () => {
    // Guessing sends somebody to move a tray that was never at RHH, or waits
    // on a distributor who was never asked.
    expect(matchSupply('Loan')).toBe('Loan')
  })

  it('is not fooled by something that is not a supply', () => {
    expect(matchSupply('2 levels')).toBeNull()
    expect(matchSupply('PM list')).toBeNull()
    expect(matchSupply('')).toBeNull()
  })
})

describe('parseKitSupplies', () => {
  it('keeps two systems apart', () => {
    // Brent's case: Ascot lives at Calvary, Athlet does not.
    expect(parseKitSupplies('Ascot (Consignment) / Athlet (RHH Loan)')).toEqual([
      { system: 'Ascot', supply: 'Consignment' },
      { system: 'Athlet', supply: 'RHH Loan' }
    ])
  })

  it('handles a system with no supply yet', () => {
    expect(parseKitSupplies('Dakota')).toEqual([{ system: 'Dakota', supply: null }])
  })

  it('splits on a comma or a plus as well as a slash', () => {
    expect(parseKitSupplies('Ascot (Consignment), Athlet (RHH Loan)')).toHaveLength(2)
    expect(parseKitSupplies('Diplomat (Consignment) + E4')).toHaveLength(2)
  })

  it('leaves a bracket that is not a supply attached to the system', () => {
    // "(2 levels)" is something the team wrote on purpose, and dropping it
    // loses what they meant.
    expect(parseKitSupplies('Dakota (2 levels)')).toEqual([
      { system: 'Dakota (2 levels)', supply: null }
    ])
  })

  it('finds nothing in nothing', () => {
    expect(parseKitSupplies('')).toEqual([])
    expect(parseKitSupplies(undefined)).toEqual([])
  })
})

describe('formatKitSupplies', () => {
  it('round-trips', () => {
    const text = 'Ascot (Consignment) / Athlet (RHH Loan)'
    expect(formatKitSupplies(parseKitSupplies(text))).toBe(text)
  })

  it('leaves out a supply that has not been chosen', () => {
    expect(formatKitSupplies([{ system: 'Dakota', supply: null }])).toBe('Dakota')
  })
})

describe('setSupply', () => {
  it('sets one without touching the other', () => {
    expect(setSupply('Ascot / Athlet', 'Athlet', 'RHH Loan'))
      .toBe('Ascot / Athlet (RHH Loan)')
  })

  it('changes an answer', () => {
    expect(setSupply('Ascot (Consignment)', 'Ascot', 'Distributor Loan'))
      .toBe('Ascot (Distributor Loan)')
  })

  it('clears it when the same answer is tapped again', () => {
    // There is no fourth button for "I do not know", and somebody who taps
    // the wrong one needs a way back that is not retyping the field.
    expect(setSupply('Ascot (Consignment)', 'Ascot', 'Consignment')).toBe('Ascot')
  })

  it('adds a system that was not in the field', () => {
    expect(setSupply('', 'Dakota', 'Consignment')).toBe('Dakota (Consignment)')
  })

  it('matches the system whatever case it is written in', () => {
    expect(setSupply('ASCOT (Consignment)', 'Ascot', 'RHH Loan'))
      .toBe('ASCOT (RHH Loan)')
  })
})

describe('systemsToSupply', () => {
  it('takes the systems from the kit field where there is one', () => {
    expect(systemsToSupply({ kit: 'Ascot (Consignment) / Athlet', system: 'Ignored' }))
      .toEqual(['Ascot', 'Athlet'])
  })

  it('falls back to the system when there is no kit field', () => {
    expect(systemsToSupply({ system: 'ATHLET AND ASCOT PLATE' }))
      .toEqual(['ATHLET AND ASCOT PLATE'])
  })

  it('does not offer the same system twice', () => {
    expect(systemsToSupply({ kit: 'Ascot / ascot' })).toEqual(['Ascot'])
  })

  it('offers nothing for a booking that names no system', () => {
    expect(systemsToSupply({})).toEqual([])
  })
})


describe('the bookings as the team actually writes them', () => {
  // "Pt Loane on Friday is Distributor Loan for the Mariner kit and
  // consignment for the E4 Global BMD PLIF cages. The app gets confused and
  // can't assign loan to one and consignment to the other."
  //
  // Two faults, both visible in the live booking:
  //
  //   Kit: Mariner (DT LOAN) E4 Global PLIF (Consignment)
  //
  // There is no separator between the two systems — the team writes these by
  // hand and the bracket is the separator — so splitting on "/" or "+" made it
  // one entry with one row of buttons. And "DT LOAN" is Device Technologies,
  // which the matcher read as a bare "Loan", losing the distinction between a
  // tray we fetch and a tray somebody has to request and chase.
  it('reads Pt Loane correctly', () => {
    expect(parseKitSupplies('Mariner (DT LOAN) E4 Global PLIF (Consignment)')).toEqual([
      { system: 'Mariner', supply: 'Distributor Loan' },
      { system: 'E4 Global PLIF', supply: 'Consignment' }
    ])
  })

  it('offers a row of buttons for each of them', () => {
    expect(systemsToSupply({ kit: 'Mariner (DT LOAN) E4 Global PLIF (Consignment)' }))
      .toEqual(['Mariner', 'E4 Global PLIF'])
  })

  it('reads the same booking written with a separator', () => {
    // Pt O'Brien, same day, same two systems, written with a plus.
    expect(parseKitSupplies('Mariner (DT Loan)  + E4 BMD (Consignment)')).toEqual([
      { system: 'Mariner', supply: 'Distributor Loan' },
      { system: 'E4 BMD', supply: 'Consignment' }
    ])
  })

  it('knows the distributors by the names the team uses', () => {
    // Every one of these is a request to send and a delivery to chase.
    for (const said of ['DT LOAN', 'SIGNUS LOAN', 'KT loan', 'loan from Device',
      'Orthofix Loan', 'E4 loan']) {
      expect(matchSupply(said), said).toBe('Distributor Loan')
    }
  })

  it('still tells an RHH loan from a distributor one', () => {
    // The two that look alike and mean different jobs.
    expect(matchSupply('RHH Loan')).toBe('RHH Loan')
    expect(matchSupply('DT Loan')).toBe('Distributor Loan')
  })

  it('sets one of two systems that share no separator', () => {
    // The thing that could not be done before: change the Mariner without
    // touching the cages.
    expect(setSupply('Mariner (DT LOAN) E4 Global PLIF (Consignment)', 'Mariner', 'RHH Loan'))
      .toBe('Mariner (RHH Loan) / E4 Global PLIF (Consignment)')
  })

  it('keeps a bracket that is not a supply with its system', () => {
    expect(parseKitSupplies('Mariner (DT LOAN) E4 Global PLIF (2 levels)')).toEqual([
      { system: 'Mariner', supply: 'Distributor Loan' },
      { system: 'E4 Global PLIF (2 levels)', supply: null }
    ])
  })

  it('splits two systems sharing one bracket', () => {
    // "Diplomat / Cascadia (Consignment)" is two systems, and only the last
    // carries the supply it was written against.
    expect(parseKitSupplies('Diplomat / Cascadia (Consignment)')).toEqual([
      { system: 'Diplomat', supply: null },
      { system: 'Cascadia', supply: 'Consignment' }
    ])
  })
})
