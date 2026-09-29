import { describe, it, expect } from 'vitest'
import { sourceOf, mayNotifyAboutBooking, isSameBooking, mergeBookings, BOOKING_SOURCES, isDistributorEmail } from './bookingSources.js'
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

describe('a distributor is not a booking source', () => {
  it('knows the distributors that send confirmations back', () => {
    // Globus/Nuvasive and Device are the two that do it every time — a calendar
    // invite to bookings@, which Google then adds to the calendar by itself.
    expect(isDistributorEmail('jlagoon@globusmedical.com')).toBe(true)
    expect(isDistributorEmail('orthobookings@device.com.au')).toBe(true)
    expect(isDistributorEmail('bookings@e4surgical.com')).toBe(true)
    expect(isDistributorEmail('a.polites@signus.com.au')).toBe(true)
  })

  it('does not mistake our own address, or a hospital, for a distributor', () => {
    // Getting this wrong would silently drop real bookings, which is the exact
    // failure the whole review queue exists to prevent.
    expect(isDistributorEmail('bookings@technomed.com.au')).toBe(false)
    expect(isDistributorEmail('tobias.long@ths.tas.gov.au')).toBe(false)
    expect(isDistributorEmail('someone@cnstas.com.au')).toBe(false)
    expect(isDistributorEmail('')).toBe(false)
    expect(isDistributorEmail(null)).toBe(false)
  })

  it('matches subdomains but not lookalike domains', () => {
    expect(isDistributorEmail('rep@mail.device.com.au')).toBe(true)
    // A domain that merely ends in the same letters is somebody else entirely.
    expect(isDistributorEmail('rep@notdevice.com.au')).toBe(false)
    expect(isDistributorEmail('rep@device.com.au.example.org')).toBe(false)
  })

  it('is kept separate from being an unrecognised sender', () => {
    // sourceOf already returns null for a distributor, so the ingestion would
    // skip one either way. The distinction is what the team is told: an
    // unrecognised sender is reported as possibly-a-missed-booking, which
    // invites someone to add the domain as a source and recreate the duplicate.
    expect(sourceOf('jlagoon@globusmedical.com')).toBe(null)
    expect(isDistributorEmail('jlagoon@globusmedical.com')).toBe(true)
  })
})

describe('a case already on the calendar', () => {
  // The first real mailbox check offered a queue of bookings that were, all but
  // one, already entered. isSameBooking is what the cross-check leans on, so it
  // has to hold against a calendar booking as the calendar actually writes it —
  // parsed out of a title and a labelled description, not typed by the parser
  // that made the candidate.
  const fromEmail = { patient: 'Cooper', surgeon: 'Ibbett', date: '2026-10-02' }

  it('matches however the two were written', () => {
    expect(isSameBooking(fromEmail, { patient: 'cooper', surgeon: 'Ibbett', date: '2026-10-02' }))
      .toBe(true)
    expect(isSameBooking(fromEmail, { patient: 'Cooper ', surgeon: 'ibbett', date: '2026-10-02' }))
      .toBe(true)
  })

  it('does not match a different day', () => {
    // A case moved to another day is a different booking, and the app must
    // offer it rather than assume the old one covers it.
    expect(isSameBooking(fromEmail, { ...fromEmail, date: '2026-10-05' })).toBe(false)
  })

  it('does not match a different patient or surgeon', () => {
    expect(isSameBooking(fromEmail, { ...fromEmail, patient: 'Marsh' })).toBe(false)
    expect(isSameBooking(fromEmail, { ...fromEmail, surgeon: 'Fowler' })).toBe(false)
  })

  it('will not match when the candidate has no date at all', () => {
    // A dateless candidate must reach the queue. Treating it as already booked
    // because the names happen to match would lose a real case.
    expect(isSameBooking({ patient: 'Cooper', surgeon: 'Ibbett' }, fromEmail)).toBe(false)
  })
})

describe('a booking forwarded by the team', () => {
  // A Max Fax booking sent to bookings@ from Brent's own address was skipped
  // without a word, and the app looked broken when it was doing exactly what it
  // had been told. Our own mail plainly is a booking source.
  it('is read like any other', () => {
    expect(sourceOf('brenton@technomed.com.au')?.id).toBe('internal')
    expect(sourceOf('toni@technomed.com.au')?.id).toBe('internal')
  })

  it('carries no hospital of its own', () => {
    // A forwarded booking has to say where it is; the sender cannot imply it.
    expect(sourceOf('brenton@technomed.com.au').hospital).toBeNull()
  })

  it('is not a distributor, and does not become one', () => {
    expect(isDistributorEmail('brenton@technomed.com.au')).toBe(false)
  })

  it('may still be written to', () => {
    // The silence rule is about hospitals. Saying nothing to ourselves would be
    // an odd way to honour it.
    expect(mayNotifyAboutBooking('brenton@technomed.com.au')).toBe(true)
    expect(mayNotifyAboutBooking('Sharon.Ashworth@calvarycare.org.au')).toBe(false)
  })
})
