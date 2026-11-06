import { describe, it, expect } from 'vitest'
import { appHeight } from './appHeight.js'

// An iPhone with the Dynamic Island: 393 x 852 points, a 59pt status bar.
const iphone = { screenWidth: 393, screenHeight: 852 }

describe("the installed app's height", () => {
  it('fills the glass when iOS reports it a status bar short', () => {
    expect(appHeight({ ...iphone, installed: true, innerHeight: 793, portrait: true })).toBe(852)
  })

  it('leaves a browser tab alone', () => {
    expect(appHeight({ ...iphone, installed: false, innerHeight: 700, portrait: true })).toBeNull()
  })

  it('leaves it alone when iOS already reports the whole screen', () => {
    expect(appHeight({ ...iphone, installed: true, innerHeight: 852, portrait: true })).toBeNull()
  })

  it('leaves it alone when far more is missing than a status bar (a keyboard, split view)', () => {
    expect(appHeight({ ...iphone, installed: true, innerHeight: 500, portrait: true })).toBeNull()
  })

  it('uses the short side of the screen in landscape', () => {
    expect(appHeight({ ...iphone, installed: true, innerHeight: 360, portrait: false })).toBe(393)
  })
})
