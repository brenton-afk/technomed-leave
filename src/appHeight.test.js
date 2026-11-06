import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { viewportShortfall, watchAppHeight } from './appHeight.js'

// An iPhone with the Dynamic Island: 393 x 852 points, a 59pt status bar.
const iphone = { screenWidth: 393, screenHeight: 852 }

describe('the installed app on a short iOS viewport', () => {
  it('notices iOS leaving a status bar of glass below the page', () => {
    expect(viewportShortfall({ ...iphone, installed: true, innerHeight: 793, portrait: true })).toBe(59)
  })

  it('leaves a browser tab alone', () => {
    expect(viewportShortfall({ ...iphone, installed: false, innerHeight: 700, portrait: true })).toBe(0)
  })

  it('leaves it alone when iOS reports the whole screen', () => {
    expect(viewportShortfall({ ...iphone, installed: true, innerHeight: 852, portrait: true })).toBe(0)
  })

  it('leaves it alone when far more is missing (a keyboard, split view)', () => {
    expect(viewportShortfall({ ...iphone, installed: true, innerHeight: 500, portrait: true })).toBe(0)
  })
})

// "I think you've lost your marbles. Now it's too small again." Sizing the
// frame past the viewport put the tab bar where iOS draws nothing. Never again:
// the frame is the viewport's height, and the strip below is the canvas.
describe('the frame never reaches past what iOS draws', () => {
  const css = readFileSync(join(__dirname, 'index.css'), 'utf8')
  const app = readFileSync(join(__dirname, 'App.jsx'), 'utf8')

  it('does not size #root from the screen', () => {
    expect(css).not.toMatch(/--tm-app-height/)
    expect(css).not.toMatch(/tm-app-height/)
  })

  it('paints the strip below in the tab bar\'s own white', () => {
    const block = css.match(/html\.tm-short-viewport\s*\{[^}]*\}/)?.[0] || ''
    expect(block).toMatch(/background:\s*#ffffff/i)
    expect(block).toMatch(/--tm-bar-bg:\s*#ffffff/i)
    expect(block).toMatch(/--tm-bottom-inset:\s*0px/)
  })

  it('lets the tab bar take its padding and colour from those', () => {
    expect(app).toMatch(/paddingBottom: 'var\(--tm-bottom-inset, env\(safe-area-inset-bottom, 0px\)\)'/)
    expect(app).toMatch(/background: 'var\(--tm-bar-bg, rgba\(255,255,255,0\.92\)\)'/)
  })
})

describe('the canvas colour', () => {
  const fakeWindow = innerHeight => {
    const listeners = {}
    return {
      document, innerHeight, innerWidth: 393, screen: { width: 393, height: 852 },
      navigator: { standalone: true }, matchMedia: () => ({ matches: false }),
      addEventListener: (k, f) => { listeners[k] = f }, removeEventListener() {}
    }
  }

  it('beats the inline navy on <html> when the viewport is short', () => {
    document.documentElement.style.background = '#042746'
    const stop = watchAppHeight(fakeWindow(793))
    expect(document.documentElement.classList.contains('tm-short-viewport')).toBe(true)
    expect(document.documentElement.style.background).toMatch(/255, 255, 255|#ffffff/i)
    stop()
  })

  it('stays navy when it is not', () => {
    const stop = watchAppHeight(fakeWindow(852))
    expect(document.documentElement.classList.contains('tm-short-viewport')).toBe(false)
    expect(document.documentElement.style.background).toMatch(/4, 39, 70|#042746/i)
    stop()
  })
})
