import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Brent, 24 Nov 2026: the separate Boost tracking form scan is obsolete — the
// portal splits the Boost forms out of the usage scan and sends them itself.
describe('no separate Boost form on the usage screen', () => {
  it('offers neither the Done-screen card nor the Past scans button', () => {
    const src = readFileSync(join(__dirname, 'UsageScan.jsx'), 'utf8')
    expect(src).not.toMatch(/<BoostForm\b/)
    expect(src).not.toMatch(/data-boost-form-open/)
  })
})
