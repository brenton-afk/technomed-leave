import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isRhhCase } from './UsageScan.jsx'

// Brent, 24 Nov 2026: the registrar text is for RHH cases only, not Calvary.
describe('registrar text, RHH only', () => {
  it('knows an RHH case and nothing else', () => {
    expect(isRhhCase({ hospital: 'RHH' })).toBe(true)
    expect(isRhhCase({ hospital: 'Royal Hobart Hospital' })).toBe(true)
    expect(isRhhCase({ hospital: 'CLV' })).toBe(false)
    expect(isRhhCase({ hospital: 'Calvary' })).toBe(false)
    expect(isRhhCase({ hospital: '' })).toBe(false)
  })
  it('gates the registrar text on it', () => {
    const src = readFileSync(join(__dirname, 'UsageScan.jsx'), 'utf8')
    expect(src).toMatch(/caseRecord && isRhhCase\(caseRecord\) && \(\s*<RegistrarText/)
  })
})
