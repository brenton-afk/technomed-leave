import { describe, it, expect } from 'vitest'
import { flagsFor, needsDecision } from './timesheetFlags.js'

describe('what Erin looks at (14 Nov 2026)', () => {
  it('says nothing about a plain fortnight', () => {
    expect(flagsFor({ entries: { ordinary: { a: 7.6 } }, warnings: [] })).toEqual([])
  })
  it('lists overtime to decide, TOIL, call-ins, on call and leave', () => {
    const kinds = flagsFor({
      overtimeClaim: { status: 'pending', hours: 4 },
      toilOverflow: { excess: 2 },
      toilTaken: { a: 3 },
      entries: { call_in: { a: 1, b: 1 }, on_call: { a: 7, b: 24 } },
      leave: { total: 7.6, rows: [{ inXero: false }] },
      warnings: ['4h over the 76h fortnight claimed as overtime at double time — needs Erin\'s approval', 'Something else']
    }).map(f => f.kind)
    expect(kinds).toEqual(['overtime', 'toil-banked', 'toil-taken', 'call-ins', 'on-call', 'leave', 'leave-xero', 'warning'])
  })
  it('only an overtime claim stops Approve all', () => {
    expect(needsDecision({ overtimeClaim: { status: 'pending' } })).toBe(true)
    expect(needsDecision({ overtimeClaim: { status: 'approved' } })).toBe(false)
    expect(needsDecision({ toilTaken: { a: 2 } })).toBe(false)
  })
})
