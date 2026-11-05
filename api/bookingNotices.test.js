import { describe, it, expect } from 'vitest'
import { noticesFor, describeBooking, DEFAULT_CONTACTS, DEFAULT_RULES, DEFAULT_LOAN_REQUESTS, loanRequestsFor, hospitalLoanNoticesFor, isPosteriorSpine, applyCorrections } from './_bookingNotices.js'

// ─── Task 9: booking notices to Signus and KT Medical (RHH) ─────────────────
// Fake patients. Nothing here sends anything.

const settings = { contacts: DEFAULT_CONTACTS, rules: DEFAULT_RULES }
const event = (over = {}) => ({
  id: 'evt-abc123', summary: 'Testa ASCOT - Ibbett',
  description: 'Surg - Dr Ibbett\nPt - Testa (Jo)\nProcedure - C5/6 ACDF\nKit - Ascot (Consignment)\nHospital - CLV',
  start: { dateTime: '2026-11-06T09:00:00+11:00' }, ...over
})
const read = e => describeBooking(e)

describe('a Signus booking', () => {
  it('a new one is a notice to Signus, to jhanson cc apolites', () => {
    const [notice, ...rest] = noticesFor({ kind: 'new', after: read(event()), eventId: 'evt-abc123', settings })
    expect(rest).toEqual([])
    expect(notice.to).toEqual(['J.Hanson@signus.com.au'])
    expect(notice.cc).toEqual(['A.Polites@signus.com.au'])
    expect(notice.subject).toBe('New booking — Testa 6/11/2026 CLV')
  })

  it('names the surname and never the first name', () => {
    const [notice] = noticesFor({ kind: 'new', after: read(event()), eventId: 'evt-abc123', settings })
    expect(notice.text).toMatch(/Patient: Testa/)
    expect(notice.text + notice.html).not.toMatch(/\bJo\b/)
  })

  it('a move says old and new date, with the same reference so it threads', () => {
    const before = read(event())
    const after = read(event({ start: { dateTime: '2026-11-09T09:00:00+11:00' } }))
    const [notice] = noticesFor({ kind: 'moved', before, after, eventId: 'evt-abc123', settings })
    expect(notice.text).toMatch(/Date: 6\/11\/2026 → 9\/11\/2026/)
    expect(notice.subject).not.toMatch(/Ref|TM-/)
  })

  it('a cancellation is a notice too', () => {
    const [notice] = noticesFor({ kind: 'cancelled', before: read(event()), eventId: 'evt-abc123', settings })
    expect(notice.subject).toMatch(/^Booking cancelled/)
  })

  it('an edit to the notes or rep alone tells them nothing', () => {
    const before = read(event())
    const after = read(event({ summary: 'Testa ASCOT - Ibbett (Mat)' }))
    expect(noticesFor({ kind: 'changed', before, after, eventId: 'x', settings })).toEqual([])
  })
})

describe('KT Medical', () => {
  const kt = (hospital) => event({ summary: 'Testa LONESTAR - Thani',
    description: `Surg - Thani\nPt - Testa\nProcedure - ALIF\nKit - Lonestar\nHospital - ${hospital}` })

  it('is told about an RHH booking', () => {
    const notices = noticesFor({ kind: 'new', after: read(kt('RHH')), eventId: 'k1', settings })
    expect(notices.map(n => n.contactId)).toEqual(['kt'])
  })

  it('is not told about a Calvary one', () => {
    expect(noticesFor({ kind: 'new', after: read(kt('CLV')), eventId: 'k1', settings })).toEqual([])
  })

  it('is told when a booking moves from RHH to Calvary', () => {
    const notices = noticesFor({ kind: 'changed', before: read(kt('RHH')), after: read(kt('CLV')), eventId: 'k1', settings })
    expect(notices).toHaveLength(1)
    expect(notices[0].text).toMatch(/Hospital: RHH → CLV/)
  })
})

describe('everyone else', () => {
  it('Device is never sent a booking notice — they asked not to', () => {
    const mariner = event({ summary: 'Testa MARINER - Gupta', description: 'Pt - Testa\nKit - Mariner\nHospital - RHH' })
    expect(noticesFor({ kind: 'new', after: read(mariner), eventId: 'd1', settings })).toEqual([])
  })

  it('nothing is sent without being shown first, unless a rule says so', () => {
    expect(DEFAULT_RULES.every(r => r.autoSend === false)).toBe(true)
  })
})

// ─── A case switched to another supplier ─────────────────────────────────────
// Read as Diplomat (Signus, consignment) from the email; the surgeon then
// wanted Mariner (Device Technologies, loan) at Calvary. Fake patient only.
describe('a booking changed from Diplomat to Mariner', () => {
  const base = { date: '2026-11-10', hospital: 'CLV', surgeon: 'Thani', patient: 'Testa', procedure: 'L4/5 PLIF', startIso: '2026-11-10T09:00:00+11:00' }
  const before = { ...base, kit: 'Diplomat (Consignment)', distributors: ['signus'], loans: {} }
  const after = { ...base, kit: 'Mariner (Distributor Loan)', distributors: ['device'], loans: { device: ['Mariner'] } }

  it('does not tell Signus about a case that is no longer theirs', async () => {
    const { noticesFor, DEFAULT_CONTACTS, DEFAULT_RULES } = await import('./_bookingNotices.js')
    const out = noticesFor({ kind: 'changed', before, after, eventId: 'e1', settings: { contacts: DEFAULT_CONTACTS, rules: DEFAULT_RULES } })
    expect(out.map(n => n.contactId)).not.toContain('signus')
  })

  it('still tells Signus when a Signus case itself is cancelled', async () => {
    const { noticesFor, DEFAULT_CONTACTS, DEFAULT_RULES } = await import('./_bookingNotices.js')
    const out = noticesFor({ kind: 'cancelled', before, after: null, eventId: 'e1', settings: { contacts: DEFAULT_CONTACTS, rules: DEFAULT_RULES } })
    expect(out.map(n => n.contactId)).toContain('signus')
  })

  it('asks Device for the Mariner loan set', async () => {
    const { loanRequestsFor, DEFAULT_CONTACTS, DEFAULT_LOAN_REQUESTS } = await import('./_bookingNotices.js')
    const out = loanRequestsFor({ kind: 'changed', before, after, eventId: 'e1', settings: { contacts: DEFAULT_CONTACTS, loanRequests: DEFAULT_LOAN_REQUESTS } })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ contactId: 'device', loan: { status: 'request', systems: ['Mariner'] } })
  })

  it('tells Calvary\'s loan sets team the set is coming, and that the booking changed', async () => {
    const { hospitalLoanNoticesFor, DEFAULT_CONTACTS } = await import('./_bookingNotices.js')
    const out = hospitalLoanNoticesFor({ kind: 'changed', before, after, eventId: 'e1', settings: { contacts: DEFAULT_CONTACTS } })
    expect(out).toHaveLength(1)
    expect(out[0].to).toContain('TAS-LVH-Loansets@calvarycare.org.au')
    expect(out[0].text).toContain('A loan set has been ordered for this case: Mariner (Device Technologies).')
    expect(out[0].text).toContain('The booking has changed: Diplomat (Consignment) → Mariner (Distributor Loan).')
  })

  it('tells Calvary once, then only when the set or date changes, and when it is off', async () => {
    const { hospitalLoanNoticesFor, DEFAULT_CONTACTS } = await import('./_bookingNotices.js')
    const settings = { contacts: DEFAULT_CONTACTS }
    const sent = { 'hosp-CLV': { date: after.date, systems: ['Mariner (Device Technologies)'] } }
    expect(hospitalLoanNoticesFor({ kind: 'changed', before: after, after: { ...after, procedure: 'L4/5 TLIF' }, eventId: 'e1', settings, sent })).toEqual([])
    const moved = hospitalLoanNoticesFor({ kind: 'moved', before: after, after: { ...after, date: '2026-11-12' }, eventId: 'e1', settings, sent })
    expect(moved[0].loan.status).toBe('update')
    const off = hospitalLoanNoticesFor({ kind: 'cancelled', before: after, after: null, eventId: 'e1', settings, sent })
    expect(off[0].loan.status).toBe('cancel')
  })

  it('says nothing to Calvary about a case at RHH', async () => {
    const { hospitalLoanNoticesFor, DEFAULT_CONTACTS } = await import('./_bookingNotices.js')
    const rhh = { ...after, hospital: 'RHH' }
    expect(hospitalLoanNoticesFor({ kind: 'new', after: rhh, eventId: 'e1', settings: { contacts: DEFAULT_CONTACTS } })).toEqual([])
  })
})

// "It added to the calendar correctly from the email but didn't ask if I
// wanted to send email requests. Make sure you include Mariner MIS in the
// request email to DT." Fake patient only.
describe('a Calvary case read from an email as "Mariner MIS", no supply written', () => {
  const event = (kit, hospital = 'CLV') => ({
    summary: `Testa ${kit} - Thani`,
    description: `Surgeon: Thani\nPatient: Testa\nDate: 10/11/2026\nHospital: ${hospital}\nProcedure: L4/5 TLIF\nKit: ${kit}`,
    start: { dateTime: '2026-11-10T09:00:00+11:00' }
  })

  it('is read as a Device loan, named as written', async () => {
    const { describeBooking } = await import('./_bookingNotices.js')
    expect(describeBooking(event('Mariner MIS')).loans).toEqual({ device: ['Mariner MIS'] })
  })

  it('offers the request to Device with Mariner MIS in it, and tells Calvary', async () => {
    const { describeBooking, loanRequestsFor, hospitalLoanNoticesFor, DEFAULT_CONTACTS, DEFAULT_LOAN_REQUESTS } = await import('./_bookingNotices.js')
    const after = describeBooking(event('Mariner MIS'))
    const settings = { contacts: DEFAULT_CONTACTS, loanRequests: DEFAULT_LOAN_REQUESTS }
    const [req] = loanRequestsFor({ kind: 'new', after, eventId: 'e1', settings })
    expect(req.contactId).toBe('device')
    expect(req.text).toContain('Please send the following loan set: Mariner MIS.')
    expect(req.subject).toContain('Mariner MIS')
    const [clv] = hospitalLoanNoticesFor({ kind: 'new', after, eventId: 'e1', settings })
    expect(clv.text).toContain('Mariner MIS (Device Technologies)')
  })

  it('asks for nothing where the hospital holds the set', async () => {
    const { describeBooking } = await import('./_bookingNotices.js')
    expect(describeBooking(event('Mariner MIS', 'RHH')).loans).toEqual({})
    expect(describeBooking(event('Diplomat')).loans).toEqual({})
  })
})

describe('loan set emails only for a set new to the booking (Brent, 4 Nov 2026)', () => {
  // Invented case. Its E4 loan was requested by hand before the portal, so the
  // portal holds no record of a request — and changing its list order must
  // not offer a fresh one.
  const settings = { contacts: DEFAULT_CONTACTS, loanRequests: DEFAULT_LOAN_REQUESTS }
  const booked = {
    date: '2026-11-05', hospital: 'CLV', surgeon: 'Ibbett', patient: 'Sample', procedure: 'C1/2 posterior fixation',
    kit: 'Reform Cervical (Distributor Loan)', loans: { e4: ['Reform Cervical'] }
  }
  it('offers nothing when an edit does not add the set', () => {
    expect(loanRequestsFor({ kind: 'changed', before: booked, after: { ...booked }, eventId: 'e1', settings })).toEqual([])
    expect(hospitalLoanNoticesFor({ kind: 'changed', before: booked, after: { ...booked }, eventId: 'e1', settings })).toEqual([])
  })
  it('still asks when the booking is first placed', () => {
    expect(loanRequestsFor({ kind: 'new', after: booked, eventId: 'e1', settings })).toHaveLength(1)
  })
})

describe('Neurophys for Dubey posterior cases at Calvary (Toni, 4 Nov 2026)', () => {
  const booking = over => ({ date: '2026-11-20', hospital: 'CLV', surgeon: 'Dubey', patient: 'Testa',
    procedure: 'L4/5 PLIF', kit: 'Diplomat', distributors: ['signus'], loans: {}, ...over })
  const neuro = list => list.filter(n => n.contactId === 'neurophys')

  it('offers a drafted request, shown first, on a new Dubey posterior case at Calvary', () => {
    const [n] = neuro(noticesFor({ kind: 'new', after: booking(), eventId: 'e1', settings }))
    expect(n).toBeTruthy()
    expect(n.autoSend).toBe(false)
    expect(n.to).toEqual(['info@neurophys.com.au'])
    expect(n.text).toMatch(/book neurophysiology monitoring/)
  })

  it('stays quiet for another surgeon, RHH, or anterior work', () => {
    expect(neuro(noticesFor({ kind: 'new', after: booking({ surgeon: 'Gupta' }), settings }))).toEqual([])
    expect(neuro(noticesFor({ kind: 'new', after: booking({ hospital: 'RHH' }), settings }))).toEqual([])
    expect(neuro(noticesFor({ kind: 'new', after: booking({ procedure: 'C5/6 ACDF' }), settings }))).toEqual([])
  })

  it('tells them when the case moves or is cancelled', () => {
    const moved = neuro(noticesFor({ kind: 'moved', before: booking(), after: booking({ date: '2026-11-21' }), settings }))
    expect(moved).toHaveLength(1)
    expect(neuro(noticesFor({ kind: 'cancelled', before: booking(), settings }))).toHaveLength(1)
  })

  it('reads posterior spine from the operation', () => {
    for (const p of ['L4/5 PLIF', 'T10-L2 posterior fusion', 'L3-5 laminectomy', 'posterior cervical fusion C3-6', 'T12-L2 fixation', 'ALIF + posterior fixation'])
      expect(isPosteriorSpine(p)).toBe(true)
    for (const p of ['C5/6 ACDF', 'L5/S1 ALIF', 'C4/5 TDR', 'C5 corpectomy'])
      expect(isPosteriorSpine(p)).toBe(false)
  })

  it('is added to settings saved before the rule existed', () => {
    const saved = { contacts: DEFAULT_CONTACTS.filter(c => c.id !== 'neurophys'), rules: DEFAULT_RULES.slice(0, 2),
      applied: ['device-2026-11-01', 'kit-hospitals-2026-11-01', 'device-loans-on-2026-11-02'] }
    const next = applyCorrections(saved)
    expect(next.rules.map(r => r.id)).toContain('neurophys-dubey-clv')
    expect(next.contacts.map(c => c.id)).toContain('neurophys')
  })
})

import { changesBetween } from './_bookingNotices.js'

describe('a change only in capitals or spacing is not a change', () => {
  it('DIPLOMAT ON STANDBY → Diplomat on standby says nothing', () => {
    const before = { date: '2026-11-05', hospital: 'CLV', surgeon: 'Thani', procedure: 'Redo L5/S1', kit: 'DIPLOMAT ON STANDBY' }
    expect(changesBetween(before, { ...before, kit: 'Diplomat  on standby' })).toEqual([])
    expect(changesBetween(before, { ...before, kit: 'Mariner' }).map(c => c.key)).toEqual(['kit'])
  })
})
