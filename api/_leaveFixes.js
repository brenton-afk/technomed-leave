// ─── One-off corrections to leave records (Brent, 14 Nov 2026) ───────────────
// Toni's personal leave on Mon 2 Nov 2026 was approved in the portal but never
// reached Xero; the same 5.5h was entered in Xero directly, so the timesheet
// showed it twice. Brent: "Clear it". Matched narrowly — this person, this
// day, this type, and only while the record says it never reached Xero — and
// moved from leave:approved to leave:withdrawn with who and why. Nothing in
// Xero or on the calendar is touched. Each fix runs once.

import { redis, redisSetBody } from './_redis.js'

export const LEAVE_FIXES = [
  {
    id: 'toni-sick-2026-11-02',
    email: 'toni@technomed.com.au',
    leaveType: 'SICK',
    startDate: '2026-11-02',
    endDate: '2026-11-02',
    reason: 'Duplicate of the leave entered in Xero; the portal request never reached Xero (Brent, 14 Nov 2026)'
  }
]

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()

/** Whether a record is the one a fix names. Pure. */
export function matchesFix(app, fix) {
  return Boolean(app) && same(app.email, fix.email) && app.leaveType === fix.leaveType
    && app.startDate === fix.startDate && app.endDate === fix.endDate
    && app.xero?.ok !== true
}

/** Applies each fix once to the approved list. Returns the approved left. */
export async function applyLeaveFixes(approved, { store = redis, setBody = redisSetBody } = {}) {
  let kept = approved
  for (const fix of LEAVE_FIXES) {
    const target = kept.find(a => matchesFix(a, fix))
    if (!target?.id) continue
    if (!(await store('set', `leave:fix:${fix.id}`, '1', 'NX'))) continue
    const withdrawn = { ...target, status: 'withdrawn', withdrawn: { by: 'Brent (correction)', at: new Date().toISOString(), reason: fix.reason } }
    await setBody(`leave:${target.id}`, JSON.stringify(withdrawn))
    await store('lrem', 'leave:approved', '0', target.id)
    await store('lpush', 'leave:withdrawn', target.id)
    kept = kept.filter(a => a !== target)
  }
  return kept
}
