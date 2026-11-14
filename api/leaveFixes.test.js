import { describe, it, expect } from 'vitest'
import { applyLeaveFixes, matchesFix, LEAVE_FIXES } from './_leaveFixes.js'

const fix = LEAVE_FIXES[0]
const target = { id: 'a1', email: fix.email, leaveType: 'SICK', startDate: fix.startDate, endDate: fix.endDate }

describe('one-off leave corrections', () => {
  it('withdraws the named unsent request once, and nothing else', async () => {
    const keys = new Set(); const calls = []; const bodies = {}
    const store = async (cmd, ...args) => {
      calls.push([cmd, ...args])
      if (cmd === 'set') { if (keys.has(args[0])) return null; keys.add(args[0]); return 'OK' }
      return 1
    }
    const other = { id: 'b2', email: fix.email, leaveType: 'ANNUAL_LEAVE', startDate: fix.startDate, endDate: fix.endDate }
    const kept = await applyLeaveFixes([target, other], { store, setBody: async (k, v) => { bodies[k] = JSON.parse(v) } })
    expect(kept).toEqual([other])
    expect(bodies['leave:a1'].status).toBe('withdrawn')
    expect(calls).toContainEqual(['lrem', 'leave:approved', '0', 'a1'])
    expect(calls).toContainEqual(['lpush', 'leave:withdrawn', 'a1'])
    // Second time: already done, untouched.
    expect(await applyLeaveFixes([target], { store, setBody: async () => {} })).toEqual([target])
  })

  it('never touches a request that reached Xero', () => {
    expect(matchesFix({ ...target, xero: { ok: true, id: 'x' } }, fix)).toBe(false)
    expect(matchesFix(target, fix)).toBe(true)
  })
})
