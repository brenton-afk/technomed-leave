import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Ben, 24 Nov 2026: a BMD cage's size had to be scrolled across on the review.
// The size gets the room, the quantity is a narrow box, and the size box grows.
const src = readFileSync(join(__dirname, 'UsageScan.jsx'), 'utf8')

describe('usage review: size and quantity', () => {
  it('puts size beside a narrow quantity box', () => {
    expect(src).toMatch(/data-size-row[^>]*gridTemplateColumns: 'minmax\(0, 1fr\) 76px'/)
    expect(src).toMatch(/<GrowField label="Size"/)
  })
  it('lets the size box grow instead of scrolling, and drops a typed newline', () => {
    expect(src).toMatch(/el\.style\.height = `\$\{el\.scrollHeight\}px`/)
    expect(src).toMatch(/replace\(\/\\s\*\\n\\s\*\/g, ' '\)/)
  })
})
