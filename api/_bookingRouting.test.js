import { describe, it, expect } from 'vitest'
import {
  distributorsForKit, isOwnStock, BOOKING_NOTIFY, NEUROPHYS, DISTRIBUTORS
} from './_distributors.js'

// Routing that decides who gets an email about a real theatre case, so the tests
// are the specification: confirmed by Brent on 23 September, and every line here
// is a decision he made rather than a pattern that happened to work.

describe('which distributor a kit belongs to', () => {
  it.each([
    ['Athlet', 'signus'], ['Ascot', 'signus'], ['Diplomat', 'signus'],
    ['MOBIS', 'signus'], ['CYLOX', 'signus'],
    ['Mariner', 'device'], ['Shoreline', 'device'],
    ['Global BMD PLIF', 'e4'], ['Global BMD ALIF', 'e4'],
    ['Dakota ACDF', 'e4'], ['Reform Cervical', 'e4']
  ])('%s is %s', (kit, expected) => {
    expect(distributorsForKit(kit)).toEqual([expected])
  })

  it('finds every distributor on a kit line, not just the first', () => {
    // "Diplomat + E4" is a real RHH booking: Diplomat from Signus alongside E4
    // cages. Returning one of them loses a request nobody knows is missing.
    expect(distributorsForKit('Diplomat + E4').sort()).toEqual(['e4', 'signus'])
    expect(distributorsForKit('Diplomat insitu T10-L5 + Connectors + E4').sort())
      .toEqual(['e4', 'signus'])
  })

  it('reads a kit line as the team writes it', () => {
    expect(distributorsForKit('Kit - Diplomat (Consignment) /Cascadia/AIRO')).toEqual(['signus'])
    expect(distributorsForKit('MARINER (LOAN)')).toEqual(['device'])
  })

  it('knows TechnoMed is not a distributor', () => {
    // Own stock is an answer, not a failure to match: there is no external
    // request to make, and the queue should say so rather than look blank.
    expect(distributorsForKit('Technomed')).toEqual([])
    expect(isOwnStock('Technomed')).toBe(true)
    expect(isOwnStock('Diplomat')).toBe(false)
  })

  it('returns nothing for a system it has not been told about', () => {
    // Rather than guessing. An unrecognised kit is a question in the review
    // queue; a guessed one is an email to the wrong company.
    expect(distributorsForKit('Cascadia')).toEqual([])
    expect(distributorsForKit('KT Lonestar')).toEqual([])
    expect(distributorsForKit('')).toEqual([])
  })
})

describe('who hears about a booking', () => {
  it('tells Signus, E4 and ATEC', () => {
    for (const key of ['signus', 'e4', 'atec']) {
      expect(BOOKING_NOTIFY[key].notifyOnBooking, key).toBe(true)
      expect(BOOKING_NOTIFY[key].to.length, key).toBeGreaterThan(0)
    }
  })

  it('tells Device nothing about bookings', () => {
    // Their own request: a stream of booking notices would be read as a stream
    // of loan requests, and they could not keep up with either.
    expect(BOOKING_NOTIFY.device.notifyOnBooking).toBe(false)
    expect(BOOKING_NOTIFY.device.to).toBeUndefined()
  })

  it('tells nobody who only deals in usage', () => {
    for (const key of ['dtbv', 'device_boost', 'globus', 'kt']) {
      expect(BOOKING_NOTIFY[key].notifyOnBooking, key).toBe(false)
    }
  })

  it('still sends all of them usage', () => {
    // The two lists are independent. Device hears nothing about a booking and
    // everything about what was used.
    expect(DISTRIBUTORS.device.to.length).toBeGreaterThan(0)
    expect(DISTRIBUTORS.dtbv.to.length).toBeGreaterThan(0)
  })

  it('uses booking addresses, not the usage ones', () => {
    // They genuinely differ. Device's usage mail goes to dl_spine_marketing and
    // ortho; anything about a booking goes to the product managers. Wiring
    // bookings to the usage list emailed the wrong people at every distributor.
    expect(BOOKING_NOTIFY.e4.to).not.toEqual(DISTRIBUTORS.e4.to)
    expect(BOOKING_NOTIFY.e4.to).toContain('bookings@e4surgical.com')
    expect(DISTRIBUTORS.e4.to).toContain('admin@e4surgical.com')
  })

  it('reaches Neurophys, who are not a distributor at all', () => {
    expect(NEUROPHYS.to).toEqual(['info@neurophys.com.au'])
  })

  it('never emails a hospital about a booking', () => {
    // Calvary, CNS and RHH are where bookings come *from*. Sending them back
    // would be telling them what they just told us.
    const everyone = [
      ...Object.values(BOOKING_NOTIFY).flatMap(d => d.to || []),
      ...NEUROPHYS.to
    ].join(' ').toLowerCase()
    for (const domain of ['calvarycare.org.au', 'ths.tas.gov.au', 'cnstas.com.au', 'brainlab.com']) {
      expect(everyone, domain).not.toContain(domain)
    }
  })
})
