import { describe, it, expect } from 'vitest'
import {
  sourceOf, mayNotifyAboutBooking, isSameBooking, mergeBookings, BOOKING_SOURCES
} from './bookingSources.js'
import { normaliseSurgeon } from './parse.js'

describe('recognising where a booking came from', () => {
  it.each([
    ['tobias.long@ths.tas.gov.au', 'rhh'],
    ['bookings@cnstas.com.au', 'cns'],
    ['bookings1@cnstas.com.au', 'cns'],
    // The theatre lists come from a second domain, which is the one that matters.
    ['bookings@tasmanianspineservice.com.au', 'cns'],
    ['Sharon.Ashworth@calvarycare.org.au', 'calvary'],
    ['kwatson@device.com.au', null],
    ['', null]
  ])('%s → %s', (address, expected) => {
    expect(sourceOf(address)?.id ?? null).toBe(expected)
  })

  it('knows the RHH lists arrive as a week at a time', () => {
    const rhh = BOOKING_SOURCES.find(s => s.id === 'rhh')
    expect(rhh.shape).toBe('batch')
    // And that they carry first names and dates of birth, which must never be
    // stored.
    expect(rhh.carriesIdentifiers).toBe(true)
  })
})

describe('what must never be sent back', () => {
  // CNS was added as a second source because Calvary's bookings sometimes
  // arrived incomplete or late on a Friday. It works, and the CNS copy usually
  // lands first — but Calvary does not know that. Nothing the app generates may
  // reveal it.
  it('refuses to send anything about a booking to any source', () => {
    for (const address of [
      'Sharon.Ashworth@calvarycare.org.au',
      'tas-lvh-loansets@calvarycare.org.au',
      'bookings@cnstas.com.au',
      'bookings@tasmanianspineservice.com.au',
      'tobias.long@ths.tas.gov.au',
      'rhhcsdloancoordinator@ths.tas.gov.au'
    ]) {
      expect(mayNotifyAboutBooking(address), address).toBe(false)
    }
  })

  it('still allows the distributors', () => {
    for (const address of ['j.hanson@signus.com.au', 'e4@e4surgical.com', 'info@neurophys.com.au']) {
      expect(mayNotifyAboutBooking(address), address).toBe(true)
    }
  })
})

describe('the same case arriving twice', () => {
  const cns = {
    date: '2026-10-09', patient: 'Okafor', surgeon: 'Dubey',
    kit: 'Mariner', sources: ['cns']
  }
  const calvary = {
    date: '2026-10-09', patient: 'okafor', surgeon: 'Dubey',
    kit: 'Mariner (DT loan)', procedure: 'L4/5 PLIF/TLIF', sources: ['calvary']
  }

  it('is recognised across the two sources', () => {
    expect(isSameBooking(cns, calvary)).toBe(true)
  })

  it('is not confused by two different patients on one day', () => {
    expect(isSameBooking(cns, { ...calvary, patient: 'Marsh' })).toBe(false)
  })

  it('is not confused by the same surname under a different surgeon', () => {
    expect(isSameBooking(cns, { ...calvary, surgeon: 'Ibbett' })).toBe(false)
  })

  it('matches a surgeon written either way, once normalised', () => {
    // The RHH lists write PETERS-WILLKE; the calendar writes JPW.
    const a = { date: '2026-09-22', patient: 'Marsh', surgeon: normaliseSurgeon('PETERS-WILLKE') }
    const b = { date: '2026-09-22', patient: 'Marsh', surgeon: normaliseSurgeon('JPW') }
    expect(isSameBooking(a, b)).toBe(true)
  })

  it('keeps whatever each copy actually said', () => {
    // Neither source is authoritative. CNS is often more complete; Calvary's
    // copy sometimes carries a detail CNS did not have.
    const merged = mergeBookings(cns, calvary)
    expect(merged.kit).toBe('Mariner (DT loan)')      // the fuller kit line
    expect(merged.procedure).toBe('L4/5 PLIF/TLIF')   // only Calvary had it
    expect(merged.patient).toBe('Okafor')             // the first copy's casing
  })

  it('records both sources, for the team and nobody else', () => {
    expect(mergeBookings(cns, calvary).sources.sort()).toEqual(['calvary', 'cns'])
  })

  it('never blanks a field it already had', () => {
    const merged = mergeBookings(cns, { ...calvary, kit: '' })
    expect(merged.kit).toBe('Mariner')
  })
})

describe('the constraint is written down', () => {
  it('explains itself in the source, where it cannot be tidied away', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const text = readFileSync(join(process.cwd(), 'src/clinicalPlan/bookingSources.js'), 'utf8')
    // A rule nobody can look up gets removed by the next person tidying up.
    expect(text).toMatch(/does not know we already have those bookings/i)
    expect(text).toMatch(/Never auto-reply/i)
  })
})
