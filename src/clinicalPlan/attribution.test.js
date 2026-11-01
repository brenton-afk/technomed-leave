import { describe, it, expect } from 'vitest'
import { withAttribution, enteredByOf } from './attribution.js'

// ─── Task 6: "Entered by" names the person who entered the booking ───────────

const NOTES = 'Surg - Ibbett\nPt - Testa\nKit - CYLOX (Loan)'

describe('creating a booking', () => {
  it('names the signed-in person', () => {
    expect(withAttribution(NOTES, 'Toni', { created: true })).toMatch(/\n\nEntered by Toni$/)
  })

  it('says when it was confirmed from the email check', () => {
    expect(withAttribution(NOTES, 'Toni', { created: true, source: 'email' }))
      .toMatch(/Entered by Toni \(from email\)$/)
  })

  it('does not inherit an "Entered by" line that arrived in the notes', () => {
    const out = withAttribution(`${NOTES}\n\nEntered by Brent`, 'Toni', { created: true })
    expect(enteredByOf(out)).toBe('Toni')
    expect(out).not.toMatch(/Brent/)
  })
})

describe('editing a booking', () => {
  it('never claims the editor entered a booking that has no line', () => {
    // The reported bug: a booking typed straight into Google, first touched in
    // the portal by Brent, came out "Entered by Brent".
    const out = withAttribution(NOTES, 'Brent', { today: '2026-11-01' })
    expect(out).not.toMatch(/Entered by Brent/)
    expect(out).toMatch(/Amended by Brent 1\/11\/2026$/)
  })

  it('keeps the original creator and dates the amendment', () => {
    const out = withAttribution(`${NOTES}\n\nEntered by Toni`, 'Brent', { today: '2026-11-01' })
    expect(out).toMatch(/Entered by Toni · amended by Brent 1\/11\/2026$/)
  })

  it('keeps "(from email)" through an amendment', () => {
    const out = withAttribution(`${NOTES}\n\nEntered by Toni (from email)`, 'Mat', { today: '2026-11-02' })
    expect(out).toMatch(/Entered by Toni \(from email\) · amended by Mat 2\/11\/2026$/)
  })

  it('replaces the previous amender rather than stacking them', () => {
    const once = withAttribution(`${NOTES}\n\nEntered by Toni`, 'Brent', { today: '2026-11-01' })
    const twice = withAttribution(once, 'Mat', { today: '2026-11-02' })
    expect(twice.match(/by/g)).toHaveLength(2)
    expect(twice).toMatch(/Entered by Toni · amended by Mat 2\/11\/2026$/)
  })

  it('uses the creator recorded on the event when the line was removed in Google', () => {
    const out = withAttribution(NOTES, 'Brent', { knownCreator: 'Toni', today: '2026-11-01' })
    expect(out).toMatch(/Entered by Toni · amended by Brent 1\/11\/2026$/)
  })

  it('treats the creator amending their own booking as one person', () => {
    expect(withAttribution(`${NOTES}\n\nEntered by Toni (from email)`, 'Toni', { today: '2026-11-01' }))
      .toMatch(/Entered by Toni \(from email\)$/)
  })

  it('updates an earlier "Amended by" line in place', () => {
    const once = withAttribution(NOTES, 'Brent', { today: '2026-11-01' })
    const twice = withAttribution(once, 'Mat', { today: '2026-11-02' })
    expect(twice).toMatch(/Amended by Mat 2\/11\/2026$/)
    expect(twice).not.toMatch(/Brent/)
  })
})

describe('nobody known', () => {
  it('writes nothing rather than a fallback name', () => {
    expect(withAttribution(NOTES, '', { created: true })).toBe(NOTES)
    expect(withAttribution(NOTES, undefined, { today: '2026-11-01' })).toBe(NOTES)
  })
})
