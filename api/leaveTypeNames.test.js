import { describe, it, expect, vi } from 'vitest'

vi.mock('./_redis.js', () => ({ redis: vi.fn(async () => null) }))
const leaveTypes = [
  { LeaveTypeID: 'pt', Name: 'Annual Leave PT' }, { LeaveTypeID: 'al', Name: 'Annual Leave' },
  { LeaveTypeID: 'old', Name: 'Time off in Lieu (TOIL)', CurrentRecord: false },
  { LeaveTypeID: 'pc', Name: 'Personal/Carer’s Leave' }, { LeaveTypeID: 't', Name: 'TOIL' },
  { LeaveTypeID: 'ta', Name: 'TOIL - Admin' }, { LeaveTypeID: 'ts', Name: 'TOIL - Science' }
]
global.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ LeaveTypes: leaveTypes }), json: async () => ({ LeaveTypes: leaveTypes }) }))
const { getLeaveTypeId } = await import('./_xeroClient.js')

describe('leave types by their exact Xero names (15 Nov 2026)', () => {
  it('finds Annual Leave, not Annual Leave PT; Personal/Carer’s; current TOIL', async () => {
    expect(await getLeaveTypeId('t', 'x', 'ANNUAL_LEAVE')).toBe('al')
    expect(await getLeaveTypeId('t', 'x', 'SICK')).toBe('pc')
    expect(await getLeaveTypeId('t', 'x', 'TOIL')).toBe('t')
  })
  it('takes Toni\'s TOIL from TOIL - Admin by name', async () => {
    expect(await getLeaveTypeId('t', 'x', 'TOIL', { exactName: 'TOIL - Admin' })).toBe('ta')
  })
})
