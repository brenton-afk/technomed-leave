import { describe, it, expect } from 'vitest'
import { DEFAULT_COURIERS, dialable, cleanCouriers, bookingWords, withKnownNumbers } from './couriers.js'

describe('couriers for a tray move (Brent, 20 Nov 2026)', () => {
  it('has Jet, the Smartways office and the three Smartways contractors', () => {
    const jet = DEFAULT_COURIERS.find(c => c.id === 'jet')
    expect(dialable(jet.phone)).toBe('0362281900')
    expect(DEFAULT_COURIERS.map(c => c.name).join(' ')).toMatch(/Smartways \(office\).*Chetan.*Clayton.*Stefan/)
    expect(DEFAULT_COURIERS.every(c => dialable(c.phone))).toBe(true)
    expect(JSON.stringify(DEFAULT_COURIERS)).not.toMatch(/password/i)
  })
  it('dials only a real number', () => {
    expect(dialable('+61 400 000 000')).toBe('+61400000000')
    expect(dialable('call me')).toBe('')
  })
  it('cleans a saved list and refuses a password or a bad number', () => {
    expect(cleanCouriers([{ name: ' Clayton ', phone: '0400 111 222' }, { name: '' }])).toHaveLength(1)
    expect(() => cleanCouriers([{ name: 'X', phone: 'abc' }])).toThrow(/not a phone number/)
    expect(() => cleanCouriers([{ name: 'X', note: 'Password: x' }])).toThrow(/passwords/)
  })
  it('says the move in a few words to read out', () => {
    expect(bookingWords({ kitName: 'Diplomat', trays: ['Screws 1', 'Screws 2'], from: 'RHH', to: 'CLV', places: { RHH: 'RHH', CLV: 'Calvary' } }))
      .toBe('Collect from RHH, deliver to Calvary. Diplomat: Screws 1, Screws 2 — 2 items.')
  })
  it('fills in a list saved before the numbers were known, never over a typed one', () => {
    const saved = [
      { id: 'jet', name: 'Jet Couriers', phone: '03 6228 1900' },
      { id: 'smartways-clayton', name: 'Clayton (Smartways)', phone: '' },
      { id: 'smartways-stefan', name: 'Stefan (Smartways)', phone: '0400 000 000' },
      { id: 'smartways-3', name: 'Smartways contractor', phone: '' }
    ]
    const out = withKnownNumbers(saved)
    expect(out.map(c => c.id)).toEqual(['jet', 'smartways-chetan', 'smartways-clayton', 'smartways-stefan'])
    expect(out.find(c => c.id === 'smartways-clayton').phone).toBe('0431 635 575')
    expect(out.find(c => c.id === 'smartways-stefan').phone).toBe('0400 000 000')
  })
})
