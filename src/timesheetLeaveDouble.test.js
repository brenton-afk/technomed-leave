import { describe, it, expect } from 'vitest'
import { leaveForPeriod } from './timesheetLeave.js'

// 14 Nov 2026: Toni's Monday showed the same 5.5h twice — "Personal leave ⚠"
// (a portal request never sent to Xero) and "Leave" (Xero's own, its type
// unnamed). Invented person and dates.
const email = 'someone@example.test'
const days = ['2026-11-02', '2026-11-03']

describe('one day of leave is shown once', () => {
  it('drops the unsent portal copy on a day Xero holds leave, and names the Xero entry by it', () => {
    const out = leaveForPeriod({
      email, days, xeroRead: true,
      leave: { approved: [{ email, leaveType: 'SICK', startDate: '2026-11-02', endDate: '2026-11-02', hours: [{ date: '2026-11-02', hours: 5.5 }] }] },
      xero: [{ id: 'x1', title: '', typeName: '', start: '2026-11-02', end: '2026-11-02', hours: 5.5 }]
    })
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toMatchObject({ type: 'SICK', label: 'Personal leave', total: 5.5 })
    expect(out.total).toBe(5.5)
  })

  it('still shows a portal request on a day Xero has nothing', () => {
    const out = leaveForPeriod({
      email, days, xeroRead: true,
      leave: { approved: [{ email, leaveType: 'SICK', startDate: '2026-11-03', endDate: '2026-11-03', hours: [{ date: '2026-11-03', hours: 7.6 }] }] },
      xero: []
    })
    expect(out.rows[0]).toMatchObject({ type: 'SICK', total: 7.6, inXero: false })
  })
})
