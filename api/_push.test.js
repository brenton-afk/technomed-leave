import { describe, it, expect } from 'vitest'
import { preview } from './_push.js'

// A lock screen is a public place — read over a shoulder in a theatre corridor
// by people who do not work here. The channels already refuse patient
// identifiers (src/chat/identifiers.js warns before a message is sent), and the
// preview adds a length limit on top so a long message starts on the lock
// screen and is finished in the app.

describe('what goes on a lock screen', () => {
  it('carries the message, because that is the point', () => {
    expect(preview('Dubey list tomorrow: ACDF first, then us')).
      toBe('Dubey list tomorrow: ACDF first, then us')
  })

  it('flattens the line breaks a pasted running order comes with', () => {
    expect(preview('1. ACDF\n2. Kon\n3. Rowe')).toBe('1. ACDF 2. Kon 3. Rowe')
  })

  it('cuts a long one rather than filling the screen', () => {
    const long = 'x'.repeat(300)
    expect(preview(long)).toHaveLength(140)
    expect(preview(long).endsWith('…')).toBe(true)
  })

  it('does not cut one that fits', () => {
    const fits = 'y'.repeat(140)
    expect(preview(fits)).toBe(fits)
  })

  it('copes with nothing', () => {
    expect(preview('')).toBe('')
    expect(preview(null)).toBe('')
  })
})
