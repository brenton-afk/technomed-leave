import { describe, it, expect } from 'vitest'
import { emailShell, para, factsPanel, shellFromText } from './_emailLayout.js'
import { noticesFor, DEFAULT_CONTACTS, DEFAULT_RULES } from './_bookingNotices.js'

// Brent, 18 Nov 2026: "all communications from the portal had clear
// consistency and were labeled clearly (booking, usage, loan set request)".

describe('the one letterhead', () => {
  it('carries the logo, the label and the address', () => {
    const html = emailShell({ label: 'New booking', body: para('Hi team,') })
    expect(html).toContain('src="cid:technomed-logo"')
    expect(html).toMatch(/data-email-label[^>]*>New booking</)
    expect(html).toContain('295 Elizabeth Street')
  })
  it('escapes everything it is given', () => {
    expect(para('<b>x</b>')).toContain('&lt;b&gt;')
    expect(factsPanel([['Kit', '<script>']])).not.toContain('<script>')
    expect(shellFromText({ label: 'x', text: 'a\n\n<img>' })).not.toContain('<img>')
  })
  it('leaves out an empty fact', () => {
    expect(factsPanel([['Kit', ''], ['Surgeon', 'Thani']])).not.toContain('>Kit<')
  })
})

describe('booking notices say what they are', () => {
  it('a new booking is labelled New booking', () => {
    const after = { date: '2026-12-07', hospital: 'CLV', surgeon: 'Thani', procedure: 'ACDF', kit: 'Diplomat', distributors: ['signus'], patient: 'Testa' }
    const out = noticesFor({ kind: 'new', after, eventId: 'e1', settings: { contacts: DEFAULT_CONTACTS, rules: DEFAULT_RULES } })
    if (out.length) expect(out[0].badge).toBe('New booking')
  })
})
