// `isClinicalTeam` marks who is copied on every usage email. It lives here rather
// than as a list of addresses in api/_distributors.js so that changing someone's
// email cannot quietly drop them off the copy list — the roster is the one place
// a person is described, and this is a fact about a person.
//
// `firstName` is the name the team actually uses, which is why it is written down
// rather than derived: Brenton is Brent and Matthew is Mat, and no rule gets from
// one to the other. It goes on the bookings calendar to show who attended, so it
// has to match what everyone already writes there by hand.
// Full time, 76 hours a fortnight; ordinary hours past that are banked as
// TOIL automatically unless entered as double time (Brent, 2 Nov 2026). See
// src/timesheetRules.js.
const FULL_TIME_TOIL = { fortnightHours: 76, overflowToToil: true }

// `phone` is shown in the sign-off of booking emails (api/_email.js
// bookingSignature). It is deliberately not `mobileNumber`: that field is what
// the weekend timesheet reminder texts, so filling it in starts SMS to that
// person. Set it only when they should get those texts.
export const STAFF = [
  { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', firstName: 'Brent', division: 'Operations', role: 'Managing Director', isAdmin: true, isClinicalTeam: true, hasTimesheets: false, phone: '0400 997 550', mobileNumber: '' },
  // The one leave approver (Brent, 1 Nov 2026): lodged leave is sent to her.
  // Permanent part-time, 24 hours a week on days that change (Brent, 1 Nov 2026).
  { name: 'Erin Smallbon', email: 'erin@technomed.com.au', firstName: 'Erin', division: 'Operations', role: 'General Manager', isAdmin: true, isLeaveApprover: true, hasTimesheets: true, mobileNumber: '',
    workPattern: { kind: 'flexible', weeklyHours: 24 } },
  { name: 'Emma Lovering', email: 'marketing@technomed.com.au', firstName: 'Emma', division: 'Operations', role: 'Co-Founder, Brand Lead', isAdmin: false, hasTimesheets: false, mobileNumber: '' },
  // Permanent part-time, 16.5 hours a week (contract, Erin 8 May 2026): Monday,
  // Wednesday and Thursday at 5.5 (her own email of 26 Oct 2026). See leaveHours.js.
  { name: 'Toni Hoppitt', email: 'toni@technomed.com.au', firstName: 'Toni', division: 'Operations', role: 'Operations Coordinator', isAdmin: false, hasTimesheets: true, mobileNumber: '',
    workPattern: { kind: 'fixed', days: [5.5, 0, 5.5, 5.5, 0, 0, 0] } },
  { name: 'Ben Cassidy', email: 'ben@technomed.com.au', firstName: 'Ben', division: 'Spine', role: 'Clinical Support Specialist', isAdmin: false, isClinicalTeam: true, hasTimesheets: true, contract: FULL_TIME_TOIL, phone: '0409 437 131', mobileNumber: '' },
  // "All references to Mat Usher in the portal should be Mat not Matt."
  //
  // `firstName` was already Mat and the rep names on a booking already tidy
  // "(Matt)" into it. What did not was `name`, which is what the assignee
  // dropdowns, the PIN screen, the admin list and every worklist item show —
  // all of them read "Matthew Usher".
  //
  // `aka` keeps every spelling the portal has ever used or been given. It is
  // never displayed; it is what lets an old worklist item assigned to
  // "Matthew Usher" still be his, and what lets a transcript saying "Matt"
  // find him. Removing them would fix the display and break the reading.
  { name: 'Mat Usher', email: 'mat@technomed.com.au', firstName: 'Mat', aka: ['Matt', 'Matthew', 'Matthew Usher'], division: 'CMF', role: 'Business Development and Director', isAdmin: false, isClinicalTeam: true, hasTimesheets: true, contract: FULL_TIME_TOIL, phone: '0420 458 837', mobileNumber: '' },
  { name: 'Jeremy Sharpen', email: 'jeremy@technomed.com.au', firstName: 'Jeremy', division: 'Orthopaedics', role: 'Director of Orthopaedics', isAdmin: false, hasTimesheets: true, mobileNumber: '' },
  { name: 'April Foale', email: 'april@technomed.com.au', firstName: 'April', division: 'Orthopaedics', role: 'Clinical Support Specialist', isAdmin: false, hasTimesheets: true, mobileNumber: '' },
  { name: 'Aimee Vulinovich', email: 'aimee@technomed.com.au', firstName: 'Aimee', division: 'Spine', role: 'Clinical Support Specialist', isAdmin: false, isClinicalTeam: true, hasTimesheets: true, contract: FULL_TIME_TOIL, phone: '0477 334 561', mobileNumber: '' }
]
/**
 * Who may open the timesheet screen.
 *
 * Wider than `hasTimesheets`, which says who payroll expects a fortnightly
 * timesheet from. Admins can open it without being on it: the screen has to be
 * checkable by somebody other than the person filing at nine on a Sunday night,
 * and until this existed the only way to find a bug in it was to be told.
 *
 * Filing one is a separate question — see requireTimesheetSubmitter in
 * api/timesheet/agent.js. Submitting posts to Xero.
 */
export function mayOpenTimesheets(staff) {
  return Boolean(staff?.hasTimesheets || staff?.isAdmin)
}

/**
 * Whether a name written down somewhere refers to this person.
 *
 * Tolerant on purpose. Names in this app are stored as strings in places that
 * were written months ago — a worklist item, a leave application, a calendar
 * title — and renaming somebody in staffConfig would otherwise orphan every
 * one of them. Mat was "Matthew Usher" until October 2026 and a task assigned
 * to him before that is still his.
 */
export function isSameStaff(written, staff) {
  const value = String(written || '').trim().toLowerCase()
  if (!value || !staff) return false
  return [staff.name, staff.firstName, ...(staff.aka || [])]
    .filter(Boolean)
    .some(form => String(form).toLowerCase() === value)
}

export function getStaffByName(name) {
  return STAFF.find(s => s.name === name) || STAFF.find(s => isSameStaff(name, s))
}
export function getStaffByEmail(email) { return STAFF.find(s => s.email === email) }


/**
 * The name the team calls someone, from their work email.
 *
 * On the roster rather than in each API file that needs it: the usage sheet, the
 * calendar attendance note and the team-leader run-sheet all record who did
 * something, and they must all spell it the same way.
 */
export function firstNameFor(email) {
  const person = STAFF.find(s => s.email.toLowerCase() === String(email || '').toLowerCase())
  return person?.firstName || ''
}


/**
 * The reps who attend theatre cases, in the order they are usually listed.
 *
 * Narrower than `isClinicalTeam`, which decides who is copied on a usage email.
 * This is who can be recorded as having been in the room, and it is what the
 * booking sheet offers rather than asking anybody to type a name.
 */
export const ATTENDING_REPS = ['Ben', 'Aimee', 'Brent', 'Mat']

/**
 * Who a team leader can allocate to a case (Task 10). The spine reps plus the
 * orthopaedic team, because ortho cases are allocated the same way.
 */
export const ALLOCATABLE_REPS = [...ATTENDING_REPS, 'Jeremy', 'April']

/** "Ben / Aimee", "Ben and Aimee", "ben, aimee" → ['Ben', 'Aimee'], roster names only. */
export function parseRepNames(value) {
  const known = new Map(STAFF.flatMap(s => [s.firstName, ...(s.aka || [])]
    .map(n => [String(n).toLowerCase(), s.firstName])))
  const out = []
  for (const part of String(value || '').split(/\s*(?:[/,&+]|\band\b)\s*/i)) {
    const name = known.get(part.trim().toLowerCase())
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}


/**
 * Who approves leave, and so who is told the moment some is lodged.
 *
 * Narrower than isAdmin: both Brent and Erin can open the admin portal, but
 * Erin alone approves leave, and an email to two people about one decision is
 * an email each assumes the other has handled.
 */
export function leaveApprovers() {
  return STAFF.filter(s => s.isLeaveApprover).map(s => s.email)
}

/** A staff member's work pattern, or null for a standard full-time week. */
export function workPatternFor(email) {
  return STAFF.find(s => s.email.toLowerCase() === String(email || '').toLowerCase())?.workPattern || null
}
