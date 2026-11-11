import { describe, it, expect } from 'vitest'
import { onMobileData } from './lazyScreens.jsx'

// Brent, 11 Nov 2026: background downloads on Wi-Fi only.
describe('background downloads wait for Wi-Fi', () => {
  it('waits on mobile data or data saver, goes ahead on Wi-Fi or when the phone will not say', () => {
    expect(onMobileData({ type: 'cellular' })).toBe(true)
    expect(onMobileData({ type: 'wifi', saveData: true })).toBe(true)
    expect(onMobileData({ type: 'wifi' })).toBe(false)
    expect(onMobileData(undefined)).toBe(false)
  })
})
