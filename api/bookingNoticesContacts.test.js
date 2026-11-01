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

  it('offer Device loan requests switched off until somebody ticks them', () => {
    expect(DEFAULT_LOAN_REQUESTS.find(l => l.distributor === 'device')).toMatchObject({ enabled: false })
  })
})
