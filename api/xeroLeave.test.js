import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Task 14: leave reaches Xero as exact hours, and never twice ────────────
// Xero is faked. Nothing here talks to a real Xero organisation.

vi.mock('./_redis.js', () => ({ redis: vi.fn() }))

let existing
let posted

vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
  url = String(url)
  const json = body => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body), json: async () => body })
  if (url.includes('/Employees')) return json({ Employees: [{ EmployeeID: 'emp-toni', FirstName: 'Toni', LastName: 'Hoppitt' }] })
  if (url.includes('/LeaveTypes')) return json({ LeaveTypes: [{ LeaveTypeID: 'lt-personal', Name: 'Personal/Carer\'s Leave' }, { LeaveTypeID: 'lt-annual', Name: 'Annual Leave' }] })
  if (url.includes('/LeaveApplications') && (init.method || 'GET') === 'GET') return json({ LeaveApplications: existing })
  if (url.includes('/LeaveApplications')) { posted = JSON.parse(init.body); return json([{ LeaveApplicationID: 'new-1' }]) }
  throw new Error(`unexpected ${url}`)
}))

const xero = await import('./_xeroClient.js')
vi.spyOn(xero, 'getXeroToken')

beforeEach(() => { existing = []; posted = null })

// getXeroToken reads Redis; give it a token.
const { redis } = await import('./_redis.js')
redis.mockImplementation(async (cmd, key) => ({
  xero_at: 'token', xero_rt: 'refresh', xero_tid: 'tenant', xero_exp: String(Date.now() + 3_600_000)
})[key] ?? null)

const TONI_LEAVE = {
  name: 'Toni Hoppitt', leaveType: 'SICK', reason: 'Surgery',
  startDate: '2026-10-27', endDate: '2026-11-02',
  hours: [{ date: '2026-10-28', hours: 5.5 }, { date: '2026-10-29', hours: 5.5 }, { date: '2026-11-02', hours: 5.5 }]
}

describe('a Toni-style request', () => {
  it('is one request with 11h in the period ending 1 Nov and 5.5h in the one ending 15 Nov', async () => {
    await xero.submitToXero(TONI_LEAVE)
    expect(posted).toHaveLength(1)
    const periods = posted[0].LeavePeriods.map(p => ({
      end: xero.fromXeroDate(p.PayPeriodEndDate), hours: p.NumberOfUnits
    }))
    expect(periods).toEqual([{ end: '2026-11-01', hours: 11 }, { end: '2026-11-15', hours: 5.5 }])
  })

  it('runs from the first day with hours to the last, not the whole range asked for', async () => {
    await xero.submitToXero(TONI_LEAVE)
    expect(xero.fromXeroDate(posted[0].StartDate)).toBe('2026-10-28')
    expect(xero.fromXeroDate(posted[0].EndDate)).toBe('2026-11-02')
  })
})

describe('leave Xero already has', () => {
  it('stops the request and names what is there, so nothing is paid twice', async () => {
    existing = [{ LeaveApplicationID: 'x1', EmployeeID: 'emp-toni', Title: 'Personal leave',
      StartDate: '/Date(1793145600000+0000)/', EndDate: '/Date(1793145600000+0000)/',
      LeavePeriods: [{ NumberOfUnits: 5.5 }] }] // 28 Oct 2026
    await expect(xero.submitToXero(TONI_LEAVE)).rejects.toMatchObject({ code: 'duplicate' })
    expect(posted).toBeNull()
  })

  it('lodging the same dates twice does not create a second request', async () => {
    await xero.submitToXero(TONI_LEAVE)
    existing = [{ LeaveApplicationID: 'new-1', EmployeeID: 'emp-toni', Title: 'Toni Hoppitt - SICK',
      StartDate: posted[0].StartDate, EndDate: posted[0].EndDate, LeavePeriods: posted[0].LeavePeriods }]
    posted = null
    await expect(xero.submitToXero(TONI_LEAVE)).rejects.toThrow(/already has leave/)
    expect(posted).toBeNull()
  })

  it('ignores leave on other dates', async () => {
    existing = [{ LeaveApplicationID: 'x2', EmployeeID: 'emp-toni', Title: 'Annual',
      StartDate: '/Date(1795219200000+0000)/', EndDate: '/Date(1795219200000+0000)/' }] // 21 Nov
    await xero.submitToXero(TONI_LEAVE)
    expect(posted).toHaveLength(1)
  })
})

describe('a full-time request', () => {
  it('still sends the plain range, which Xero gets right for a standard week', async () => {
    await xero.submitToXero({ name: 'Toni Hoppitt', leaveType: 'ANNUAL_LEAVE', startDate: '2026-12-01', endDate: '2026-12-05' })
    expect(posted[0].LeavePeriods).toBeUndefined()
  })
})

describe('when Xero cannot be asked', () => {
  it('sends nothing rather than risk a second request', async () => {
    const real = global.fetch
    global.fetch = vi.fn(async (url, init = {}) => {
      if (String(url).includes('/LeaveApplications') && (init.method || 'GET') === 'GET') {
        return { ok: false, status: 403, headers: { get: () => 'application/json' },
          text: async () => '{"Message":"Forbidden"}', json: async () => ({ Message: 'Forbidden' }) }
      }
      return real(url, init)
    })
    await expect(xero.submitToXero(TONI_LEAVE)).rejects.toMatchObject({ code: 'unchecked' })
    expect(posted).toBeNull()
    global.fetch = real
  })
})
