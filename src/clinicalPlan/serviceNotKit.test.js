import { describe, it, expect } from 'vitest'
import { isServiceOnly, isNotAKit } from './systems.js'
import { systemsToSupply } from './kitSupply.js'
import { suppliesFor } from '../pages/CaseWeek.jsx'

// Brent, 25 Nov 2026: "Neurophysiologist is not a system/kit. It is a service
// that is booked for some cases. No need for it to be on booking tabs."
describe('a booked service is not a kit', () => {
  it('knows neurophysiology however it is written', () => {
    for (const t of ['Neurophysiologist', 'Neurophysiologist (supply?)', 'Neurophys', 'Neuro phys', 'IONM', 'Neuromonitoring required', 'Neurophysiology']) {
      expect(isServiceOnly(t), t).toBe(true)
      expect(isNotAKit(t), t).toBe(true)
    }
  })

  it('leaves real systems alone', () => {
    for (const t of ['Firebird', 'Forza XP', 'Mariner', 'Pillar SA', 'Reform Cervical']) {
      expect(isNotAKit(t), t).toBe(false)
    }
  })

  it('asks no supply for it and draws no chip for it', () => {
    expect(systemsToSupply({ kit: 'Firebird (Consignment), Forza XP (Consignment), Neurophysiologist' }))
      .toEqual(['Firebird', 'Forza XP'])
    const chips = suppliesFor({
      hospital: 'Calvary Lenah Valley', operation: 'PLIF L4/5',
      supplies: [{ system: 'Firebird', supply: 'Consignment' }, { system: 'Forza XP', supply: 'Consignment' }, { system: 'Neurophysiologist' }]
    })
    expect(chips.map(c => c.system)).toEqual(['Firebird', 'Forza XP'])
  })
})
