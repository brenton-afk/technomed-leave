import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { loanRequestsFor, describeBooking, DEFAULT_CONTACTS, DEFAULT_RULES, DEFAULT_LOAN_REQUESTS } from './_bookingNotices.js'

// ─── Task 8: loan-set requests to E4 and Globus ─────────────────────────────
// Fake patients. Nothing here sends.

// The bookings below are dated mid-November 2026. Without a fixed clock the
// "needed by" line turned into "as soon as possible" once real time came within
// 48 hours of them, and the test went red on its own.
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T09:00:00+11:00')) })
afterAll(() => { vi.useRealTimers() })

const settings = { contacts: DEFAULT_CONTACTS, rules: DEFAULT_RULES, loanRequests: DEFAULT_LOAN_REQUESTS }
const booking = ({ kit = 'Dakota (Distributor Loan)', hospital = 'CLV', date = '2026-11-12' } = {}) => describeBooking({
  id: 'evt-loan01', summary: 'Testa DAKOTA - Ibbett',
  description: `Surg - Ibbett\nPt - Testa\nProcedure - C5/6 ACDF\nKit - ${kit}\nHospital - ${hospital}`,
  start: { dateTime: `${date}T09:00:00+11:00` }
})

describe('a new booking with an E4 distributor loan', () => {
  it('writes a request to E4, with when the set has to arrive', () => {
    const [req, ...rest] = loanRequestsFor({ kind: 'new', after: booking(), eventId: 'evt-loan01', settings })
    expect(rest).toEqual([])
    expect(req.to).toEqual(['bookings@e4surgical.com'])
    expect(req.subject).toBe('Loan set request — Dakota — CLV 12/11/2026 — Ibbett — Pt Testa')
    expect(req.text).toMatch(/Please send the following loan set: Dakota\./)
    expect(req.text).toMatch(/Needed at the hospital by: 10\/11\/2026/)
    expect(req.loan).toMatchObject({ distributor: 'e4', status: 'request' })
  })

  it('asks nothing when the set is consigned', () => {
    expect(loanRequestsFor({ kind: 'new', after: booking({ kit: 'Dakota (Consignment)' }), eventId: 'x', settings })).toEqual([])
  })

  it('does not ask twice once a request has gone', () => {
    const sent = { e4: { date: '2026-11-12', hospital: 'CLV', systems: ['Dakota'] } }
    expect(loanRequestsFor({ kind: 'changed', after: booking(), eventId: 'x', settings, sent })).toEqual([])
  })
})

describe('after a request has gone', () => {
  const sent = { e4: { date: '2026-11-12', hospital: 'CLV', systems: ['Dakota'] } }
  it('a move redirects it, saying old and new', () => {
    const [req] = loanRequestsFor({ kind: 'moved', before: booking(), after: booking({ date: '2026-11-19' }), eventId: 'x', settings, sent })
    expect(req.loan.status).toBe('update')
    expect(req.text).toMatch(/Date: 12\/11\/2026 → 19\/11\/2026/)
  })
  it('a cancellation calls it off', () => {
    const [req] = loanRequestsFor({ kind: 'cancelled', before: booking(), eventId: 'x', settings, sent })
    expect(req.loan.status).toBe('cancel')
    expect(req.subject).toMatch(/^Loan set no longer needed — Dakota/)
  })
  it('switching to consignment calls it off too', () => {
    const [req] = loanRequestsFor({ kind: 'changed', before: booking(), after: booking({ kit: 'Dakota (Consignment)' }), eventId: 'x', settings, sent })
    expect(req.loan.status).toBe('cancel')
  })
})

describe('Globus, and everybody else', () => {
  it('a Globus loan goes to Globus', () => {
    const [req] = loanRequestsFor({ kind: 'new', after: booking({ kit: 'Nuvasive (Distributor Loan)' }), eventId: 'x', settings })
    expect(req.contactId).toBe('globus')
    expect(req.to).toContain('jlagoon@globusmedical.com')
  })
  it('a Device loan writes a request to Device loans — "DT also get loan requests"', () => {
    const [req] = loanRequestsFor({ kind: 'new', after: booking({ kit: 'Mariner (Distributor Loan)' }), eventId: 'x', settings })
    expect(req.to).toEqual(['DL_VICLoans@device.com.au'])
    expect(req.autoSend).toBe(false)
  })
  it('a Device loan writes nothing when Device are switched off', () => {
    const off = { ...settings, loanRequests: settings.loanRequests.map(l => (l.distributor === 'device' ? { ...l, enabled: false } : l)) }
    expect(loanRequestsFor({ kind: 'new', after: booking({ kit: 'Mariner (Distributor Loan)' }), eventId: 'x', settings: off })).toEqual([])
  })
  it('a request is always shown first', () => {
    const [req] = loanRequestsFor({ kind: 'new', after: booking(), eventId: 'x', settings })
    expect(req.autoSend).toBe(false)
  })
})

// "I don't need [the reference number]." and "the kit wasn't listed as its own
// point under date, surgery etc." — Brent, 2 Nov 2026.
describe('what the loan emails say', async () => {
  const { hospitalLoanNoticesFor, DEFAULT_HOSPITAL_LOAN_NOTICES } = await import('./_bookingNotices.js')
  const settings = { contacts: [{ id: 'calvary_loans', name: 'Calvary loan sets', greeting: 'Sharon and Loans team', to: ['loans@example.org'], cc: [] }],
    hospitalLoanNotices: DEFAULT_HOSPITAL_LOAN_NOTICES }
  const after = { hospital: 'CLV', date: '2026-11-12', surgeon: 'Dubey', procedure: 'L4/5 TLIF', patient: 'Testa',
    loans: { device: ['Mariner MIS'] }, startIso: '2026-11-12T08:00:00+11:00' }

  it('lists the loan set as its own line with the case details, and carries no reference', () => {
    const [n] = hospitalLoanNoticesFor({ kind: 'new', after, eventId: 'evt-1', settings })
    expect(n.text).toMatch(/Patient: Testa\nLoan set: Mariner MIS \(Device Technologies\)/)
    expect(n.html).toContain('Loan set')
    expect(`${n.subject}\n${n.text}\n${n.html}`).not.toMatch(/Reference|TM-|Ref /)
  })
})
