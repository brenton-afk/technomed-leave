import { describe, it, expect } from 'vitest'
import { systemsInKit, resolveKit } from './systems.js'
import { inventoryFor } from './inventory.js'
import { readBooking } from './parse.js'

// "Catenary is the proper name for the cage and Nova may write this on his
// bookings… the same cage as the E4 Global ALIF." Fake surnames only.

describe('Catenary', () => {
  it('is read as the E4 Global BMD ALIF', () => {
    expect(systemsInKit('Catenary')).toEqual(['Global BMD ALIF'])
    expect(systemsInKit('CATENARY cage')).toEqual(['Global BMD ALIF'])
    expect(inventoryFor('Global BMD ALIF').distributor).toBe('e4')
  })

  it('is not mistaken for a PLIF cage when E4 is written beside it', () => {
    expect(resolveKit('E4 Catenary', 'L5/S1 ALIF')).toBe('E4 Catenary')
  })

  it('is recognised on a booking written by hand', () => {
    const b = readBooking('Testa L5/S1 ALIF Catenary - Dubey', '')
    expect(systemsInKit(`${b.system || ''} ${b.kit || ''}`)).toContain('Global BMD ALIF')
  })
})

describe('Nova', () => {
  it('is Dr Thani, by first name or in full', () => {
    expect(readBooking('Testa L5/S1 ALIF Catenary - Nova', '').surgeon).toBe('Thani')
    expect(readBooking('Testa L5/S1 ALIF - Dr Nova Thani', '').surgeon).toBe('Thani')
  })

  it('is not found inside a product name', () => {
    expect(readBooking('Testa L4/5 PLIF Novabone - Fowler', '').surgeon).toBe('Fowler')
  })
})
