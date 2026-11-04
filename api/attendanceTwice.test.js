import { describe, it, expect } from 'vitest'
import { namedInBrackets } from './_googleCalendar.js'

// Invented title. "(Mat/Aimee)" already names Aimee: filing her usage must not
// append "(Aimee)" a second time.
describe('a rep already named on the booking', () => {
  it('is found inside a shared bracket', () => {
    expect(namedInBrackets('Sample DIPLOMAT - Fowler (Mat/Aimee)', 'Aimee')).toBe(true)
    expect(namedInBrackets('Sample DIPLOMAT - Fowler (Mat, Aimee)', 'aimee')).toBe(true)
    expect(namedInBrackets('Sample DIPLOMAT - Fowler (Mat)', 'Aimee')).toBe(false)
    // A bracket that is not people does not count.
    expect(namedInBrackets('Sample DIPLOMAT (RHH) - Fowler', 'Aimee')).toBe(false)
  })
})
