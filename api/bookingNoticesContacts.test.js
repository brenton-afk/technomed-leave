import { describe, it, expect } from 'vitest'
import { applyCorrections, DEFAULT_CONTACTS, DEFAULT_LOAN_REQUESTS } from './_bookingNotices.js'

// "Kaye Maree Watson needed to be removed… We need Asher and the other
// DL-Spine marketing email included." The live contacts are a saved copy in
// Redis, so the correction has to reach that copy, not only the defaults.

const device = s => s.contacts.find(c => c.id === 'device')
const SAVED = {
  contacts: [{ id: 'device', name: 'Device', to: ['DL_VICLoans@device.com.au'],
    cc: ['KWatson@device.com.au'] }],
  rules: []
}

describe('Device Technologies contacts', () => {
  it('no longer copy Kaye in by default', () => {
    const d = DEFAULT_CONTACTS.find(c => c.id === 'device')
    expect([...d.to, ...d.cc]).not.toContain('kwatson@device.com.au')
    expect(d.cc).toEqual(['asherhammond@device.com.au', 'dl_spine_marketing@device.com.au'])
  })

  it('are corrected in a copy saved before the change', () => {
    const fixed = applyCorrections(SAVED)
    expect(device(fixed).to).toEqual(['DL_VICLoans@device.com.au'])
    expect(device(fixed).cc).toEqual(['asherhammond@device.com.au', 'dl_spine_marketing@device.com.au'])
  })

  it('are corrected once, so a later edit in the app is not undone', () => {
    const fixed = applyCorrections(SAVED)
    const edited = { ...fixed, contacts: [{ ...device(fixed), cc: ['someone@device.com.au'] }] }
    expect(applyCorrections(edited)).toBeNull()
  })

  it('get loan requests, like E4 and Globus', () => {
    // "DT also get loan requests, just not booking updates."
    expect(DEFAULT_LOAN_REQUESTS.find(l => l.distributor === 'device')).toMatchObject({ enabled: true })
  })

  it('have loan requests switched on in a copy saved while they were off', () => {
    const saved = { ...SAVED, loanRequests: [{ distributor: 'device', contactId: 'device', enabled: false }] }
    expect(applyCorrections(saved).loanRequests[0].enabled).toBe(true)
  })

  it('still get no booking notices', async () => {
    const { DEFAULT_RULES } = await import('./_bookingNotices.js')
    expect(DEFAULT_RULES.some(r => r.contactId === 'device' || r.distributor === 'device')).toBe(false)
  })
})
