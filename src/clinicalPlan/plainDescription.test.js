import { describe, it, expect } from 'vitest'
import { plainDescription } from './parse.js'
import { parseLabelledDescription } from './labelledFields.js'

// Brent, 11 Nov 2026: Edit booking opened with "Gupta<br>Patient: …<br>Date: …"
// in the surgeon box and every other field blank. Made-up names only.
const HTML = 'Surgeon: Gupta<br>Patient: Testcase<br>Date: 11/11/2026<br>Hospital: Calvary<br>Procedure: L4/5 PLIF<br>Kit: Diplomat (Consignment)'

describe('notes Google stored as HTML', () => {
  it('reads as plain lines, so every field is found', () => {
    expect(parseLabelledDescription(plainDescription(HTML))).toMatchObject({
      surgeon: 'Gupta', patient: 'Testcase', hospital: 'Calvary', procedure: 'L4/5 PLIF', kit: 'Diplomat (Consignment)'
    })
  })

  it('keeps where a link went', () => {
    expect(plainDescription('See <a href="https://example.com/x">the list</a><br>Kit: Dakota'))
      .toBe('See the list (https://example.com/x)\nKit: Dakota')
    expect(plainDescription('<a href="https://example.com/x">https://example.com/x</a>')).toBe('https://example.com/x')
  })
})
