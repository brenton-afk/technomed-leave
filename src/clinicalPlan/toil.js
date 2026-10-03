// ─── The TOIL balance ────────────────────────────────────────────────────────
// Time off in lieu goes up when somebody works past their hours and down when
// they take the time back. Xero does neither on its own: the accrual arrives as
// an earnings rate on a timesheet, which records hours without touching a leave
// balance, so the balance has been kept by hand.
//
// The app already holds both halves and never put them together:
//
//   accrued  the TOIL hours on every timesheet it has filed
//   taken    every TOIL leave application it has sent to Xero
//
// So it can keep the balance. This does not write to Xero — a number worked out
// here and posted into payroll without anybody looking would be a bad way to
// find out it was wrong — but it ends the arithmetic, and it can be held up
// against the balance Xero reports to show whether the manual adjustments have
// kept pace.
//
// ── Pending is counted separately, and that matters ──
//
// A timesheet that is submitted and not yet approved is a claim, not a fact,
// and leave applied for is not leave taken. Rolling either into the balance
// would have somebody book time off against hours nobody has agreed to. They
// are reported alongside so the number can be read either way.

const TOIL_KEYS = ['toil_accrued']

/** Whether a stored leave application is TOIL. */
const isToil = application => /^toil$/i.test(String(application?.leaveType || '').trim())

/** Hours against the TOIL categories on one stored timesheet. */
export function toilHoursOn(timesheet) {
  const entries = timesheet?.entries || {}
  let hours = 0
  for (const key of TOIL_KEYS) {
    for (const value of Object.values(entries[key] || {})) {
      const amount = Number(value)
      if (Number.isFinite(amount)) hours += amount
    }
  }
  return hours
}

/**
 * Working days between two dates, inclusive.
 *
 * Leave is applied for in dates and TOIL is held in hours, so one has to be
 * turned into the other. Weekends are excluded because a Saturday in the middle
 * of a week off is not a day of leave anybody is charged for.
 */
export function workingDaysBetween(startDate, endDate) {
  const from = new Date(`${String(startDate).slice(0, 10)}T00:00:00Z`)
  const to = new Date(`${String(endDate).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0
  let days = 0
  for (const at = new Date(from); at <= to; at.setUTCDate(at.getUTCDate() + 1)) {
    const weekday = at.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days += 1
  }
  return days
}

/**
 * The hours a TOIL application comes to.
 *
 * A standard day, which is what the timesheet already assumes everywhere else.
 * Half days are not expressible in the leave form, so they are not guessed at
 * here either — somebody taking an afternoon says so, and it is adjusted.
 */
export function toilHoursTaken(application, { standardDay = 7.6 } = {}) {
  if (!isToil(application)) return 0
  return workingDaysBetween(application.startDate, application.endDate) * standardDay
}

/**
 * One person's TOIL position.
 *
 * @param {object} input
 * @param {Array} input.timesheets   every stored timesheet (any status)
 * @param {object} input.leave       { approved, pending } from the leave store
 * @param {string} input.email       whose balance
 * @param {number} [input.opening]   hours carried in from before the app
 * @param {number} [input.standardDay]
 */
export function toilBalanceFor({
  timesheets = [], leave = {}, email, opening = 0, standardDay = 7.6
} = {}) {
  const mine = t => String(t?.email || '').toLowerCase() === String(email || '').toLowerCase()
  const theirs = a => String(a?.email || '').toLowerCase() === String(email || '').toLowerCase()

  const sheets = timesheets.filter(mine)
  const accrued = sheets.filter(t => t.status === 'approved')
    .reduce((n, t) => n + toilHoursOn(t), 0)
  // Submitted and not yet approved. A claim, not a fact.
  const accruedPending = sheets.filter(t => t.status === 'submitted')
    .reduce((n, t) => n + toilHoursOn(t), 0)

  const taken = (leave.approved || []).filter(theirs)
    .reduce((n, a) => n + toilHoursTaken(a, { standardDay }), 0)
  const takenPending = (leave.pending || []).filter(theirs)
    .reduce((n, a) => n + toilHoursTaken(a, { standardDay }), 0)

  const balance = round(opening + accrued - taken)
  return {
    email,
    opening: round(opening),
    accrued: round(accrued),
    taken: round(taken),
    balance,
    // What it would be if everything outstanding went through. Shown rather
    // than used: somebody about to book time off needs to know the difference
    // between hours they have and hours they have asked for.
    pending: { accrued: round(accruedPending), taken: round(takenPending) },
    projected: round(balance + accruedPending - takenPending)
  }
}

/**
 * The app's balance against the one Xero reports.
 *
 * Xero's is the number that pays people, so a difference is not an error to
 * correct quietly — it is the manual adjustment that has not been made yet, or
 * one made twice. Named plainly so it can be acted on rather than puzzled over.
 */
export function compareWithXero(ours, xeroHours) {
  // null and '' both become 0 through Number(), which is finite — so a missing
  // balance would read as a real zero and report a difference equal to the
  // whole balance. "Xero has not told us" and "Xero says none" need different
  // answers, and only one of them is a reason to go and adjust something.
  const reported = xeroHours === null || xeroHours === undefined || xeroHours === ''
    ? NaN
    : Number(xeroHours)
  if (!Number.isFinite(reported)) {
    return { agrees: null, difference: null, note: 'Xero has no TOIL balance for this person.' }
  }
  const difference = round(reported - ours.balance)
  if (Math.abs(difference) < 0.01) {
    return { agrees: true, difference: 0, note: 'Xero agrees with the app.' }
  }
  return {
    agrees: false,
    difference,
    note: difference > 0
      ? `Xero is ${Math.abs(difference)}h higher than the app has worked out.`
      : `Xero is ${Math.abs(difference)}h lower — likely an accrual not yet adjusted in.`
  }
}

/** Two decimal places. Hours come in as 7.6 and adding them up drifts. */
function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}
