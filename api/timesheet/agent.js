import { requireSession, requireAdmin } from '../_auth.js'
import { STAFF, getStaffByEmail } from '../../src/staffConfig.js'
import {
  saveTimesheetDraft, getTimesheetDraft, clearTimesheetDraft,
  saveTimesheet, getTimesheet, getAllTimesheets, getAllApplications,
  getToilOpening, setToilOpening
} from '../_redis.js'
import {
  fetchEarningsRates, categoriesForStaff, CATEGORY_RULES, assignedRatesFor, unitMismatch,
  demoCategories, isDemo
} from '../_payItems.js'
import { payItemsFor, isReviewed, PAY_ITEMS } from '../../src/payOptions.js'
import { submitTimesheetToXero, approveTimesheetInXero } from '../_timesheetXero.js'
import {
  getXeroToken, findEmployee, matchEmployee, leaveBalances, listEmployees,
  overlappingXeroLeave, submitToXero
} from '../_xeroClient.js'
import { redis, redisSetBody } from '../_redis.js'
import {
  TOIL_TAKEN, earnsToil, leaveForPeriod, cleanToilTaken, totalOf, toilTakenCheck, runsOf, futureDays
} from '../../src/timesheetLeave.js'
import { toilBalanceFor, compareWithXero, toilLedgerFor, leaveOnDays } from '../../src/clinicalPlan/toil.js'
import { normaliseEntries, validate, totals } from '../_timesheetValidate.js'
import { toilOverflow, contractFor } from '../../src/timesheetRules.js'
import {
  onCallHoursFor, totalHours as onCallTotal
} from '../../src/clinicalPlan/onCall.js'
import { callInsFor, COVERED_HOURS } from '../../src/clinicalPlan/callIn.js'
import { periodFor, currentPeriod, recentPeriods, isValidPeriodStart } from '../_fortnight.js'
import { getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY, syncToilCalendar } from '../_googleCalendar.js'
import { sendTimesheetSubmittedEmail, sendTimesheetDecisionEmail } from '../_email.js'

// The spec's five endpoints — payitems, draft, submit, list, plus approve and
// reject — routed by ?action= in one function. Vercel's Hobby plan caps a
// deployment at 12 serverless functions and the app is at that ceiling, so the
// three read-only Xero routes were folded into api/xero/info.js to make room
// for this and the reminder cron. Same pattern as api/meetings/agent.js.

export default async function handler(req, res) {
  const action = req.query.action

  const session = await requireSession(req, res)
  if (!session) return

  try {
    if (action === 'payitems') return await handlePayItems(req, res, session)
    if (action === 'draft') return await handleDraft(req, res, session)
    if (action === 'submit') return await handleSubmit(req, res, session)
    if (action === 'callins') return await handleCallIns(req, res, session)
    if (action === 'mine') return await handleMine(req, res, session)
    if (action === 'list') return await handleList(req, res)
    if (action === 'decide') return await handleDecide(req, res)
    if (action === 'payaudit') return await handlePayAudit(req, res)
    if (action === 'toil') return await handleToil(req, res, session)
    if (action === 'toilopening') return await handleToilOpening(req, res)
    if (action === 'toilmatch') return await handleToilMatch(req, res)
    if (action === 'leavedays') return await handleLeaveDays(req, res, session)
    if (action === 'balances') return await handleBalances(req, res, session)
    if (action === 'toilretry') return await handleToilRetry(req, res)
    return res.status(400).json({ error: 'Unknown or missing action' })
  } catch (err) {
    console.error(`timesheet/${action} failed:`, err.message)
    return res.status(err.status || 500).json({ error: err.message })
  }
}

function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

// ─── Two different questions ─────────────────────────────────────────────────
// "May I open this?" and "may I file one?" were the same check, and they are
// not the same question. The people payroll expects a fortnightly timesheet
// from are one group; the people who need to be able to look at the screen —
// to check it, to sit with somebody who is stuck on it — are a wider one.
//
// Keeping them joined meant an admin could not open their own timesheet at all,
// so the only way to find a bug in it was to be told about one by the person
// hitting it on a Sunday night.

/** Anyone who may open the screen: the people on timesheets, and admins. */
function requireTimesheetAccess(session) {
  const staff = getStaffByEmail(session.email)
  if (!staff) throw Object.assign(new Error('Not authorised'), { status: 403 })
  if (!staff.hasTimesheets && !staff.isAdmin) {
    throw Object.assign(new Error('Timesheets are not enabled for your account'), { status: 403 })
  }
  return staff
}

/**
 * Anyone who may actually file one.
 *
 * Narrower on purpose, and the reason is one line further down this file:
 * submitting posts to Xero. An admin filling the screen in to see how it
 * behaves must not put a draft timesheet into payroll under their own name —
 * particularly one who is not on timesheets and has no employee record for it
 * to attach to.
 */
function requireTimesheetSubmitter(session) {
  const staff = getStaffByEmail(session.email)
  if (!staff?.hasTimesheets) {
    throw Object.assign(new Error(
      'You are not on fortnightly timesheets, so this one cannot be submitted. '
      + 'Everything else on this screen works — it is here so it can be checked.'
    ), { status: 403 })
  }
  return staff
}

function resolvePeriod(raw) {
  if (!raw) return currentPeriod()
  if (!isValidPeriodStart(raw)) throw badRequest('That is not the start of a fortnight')
  return periodFor(raw)
}


// ─── What each person will actually be offered ───────────────────────────────
// Which pay items somebody sees is decided in two places that have to agree:
// the earnings rates Xero holds, and the entitlement table in src/payOptions.js.
// When they disagree nothing breaks and nothing is said — a category simply
// does not appear on a timesheet, which looks identical to not being entitled
// to it, and the first anybody hears is a short payslip.
//
// So this says it out loud, per person, in one place: what they will be
// offered, what the table asks for that Xero has no rate for, and what Xero
// offers that nobody is mapped to. Admin only — it is the whole payroll
// arrangement on one screen.
async function handlePayAudit(req, res) {
  const session = await requireAdmin(req, res)
  if (!session) return

  const rates = await fetchEarningsRates()
  const rateNames = rates.map(r => r.Name || r.name).filter(Boolean)

  const people = await Promise.all(STAFF.filter(s => s.hasTimesheets).map(async person => {
    const assignedRateIds = await assignedRatesFor(person.name)
    const categories = categoriesForStaff(rates, person.email, { assignedRateIds })
    const got = new Set(categories.map(c => c.key))
    return {
      name: person.name,
      email: person.email,
      role: person.role,
      // Where the answer came from. "xero" means their pay template says so,
      // which is the answer worth having; "fallback" means nobody could be
      // asked and the table in payOptions.js decided — worth seeing, because
      // it is a payroll record to go and set up rather than a fact about them.
      source: assignedRateIds ? 'xero' : 'fallback',
      reviewed: isReviewed(person.email),
      offered: categories.map(c => ({
        key: c.key,
        label: c.label,
        xeroName: c.xeroName,
        // What Xero actually pays, and in what unit. Both were hardcoded in
        // the app and one of them was wrong.
        rate: c.ratePerUnit,
        unitType: c.typeOfUnits,
        // The call-in problem: entered as a count, paid by the hour.
        mismatch: unitMismatch(c)
      })),
      // On the fallback only. With a pay template there is nothing to be
      // missing — the template is the list.
      missing: assignedRateIds ? [] : payItemsFor(person.email)
        .filter(key => !got.has(key))
        .map(key => ({ key, label: PAY_ITEMS[key] || key }))
    }
  }))

  return res.status(200).json({
    ok: true,
    people,
    // Rates the org has that no rule recognises. Not an error — a new earnings
    // rate is exactly what this should surface — but worth a look.
    unmapped: rateNames.filter(name =>
      !CATEGORY_RULES.some(rule => rule.pattern.test(name)))
  })
}

// ─── payitems: categories for this staff member ────────────

async function handlePayItems(req, res, session) {
  const staff = requireTimesheetAccess(session)
  const rates = await fetchEarningsRates()
  // Every pay item, invented, for checking the screen. Admin only, and it
  // announces itself — see demoCategories. Brent's own template has one rate
  // on it, so without this the screen he checks is not the screen anybody uses.
  if (req.query.demo === '1' && staff.isAdmin) {
    const categories = demoCategories().map(c => ({ ...c, mismatch: unitMismatch(c) || undefined }))
    return res.status(200).json({
      categories,
      period: currentPeriod(),
      periods: recentPeriods(6).map(p => ({ start: p.start, end: p.end, index: p.index })),
      demo: true,
      note: 'Made-up pay items, so every part of the screen is visible. Nothing here can be filed.'
    })
  }

  const assignedRateIds = await assignedRatesFor(staff.name)
  const categories = categoriesForStaff(rates, staff.email, { assignedRateIds })
    .map(c => ({ ...c, mismatch: unitMismatch(c) || undefined }))
  if (categories.length === 0) {
    throw new Error('No pay categories found in Xero. Check the payroll settings scope and reconnect Xero.')
  }
  return res.status(200).json({
    categories,
    period: currentPeriod(),
    periods: recentPeriods(6).map(p => ({ start: p.start, end: p.end, index: p.index }))
  })
}

// ─── draft: save and resume ────────────────────────────────

async function handleDraft(req, res, session) {
  const staff = requireTimesheetAccess(session)

  if (req.method === 'GET') {
    const draft = await getTimesheetDraft(staff.email)
    return res.status(200).json({ draft })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const period = resolvePeriod(req.body?.periodStart)
  const draft = {
    email: staff.email,
    staffName: staff.name,
    periodStart: period.start,
    periodEnd: period.end,
    entries: req.body?.entries && typeof req.body.entries === 'object' ? req.body.entries : {},
    savedAt: new Date().toISOString()
  }
  // Which call-ins the portal logged stays with the draft, so a save from the
  // screen cannot make it log them again.
  const before = await getTimesheetDraft(staff.email)
  if (before?.periodStart === period.start && before.autoCallIns) draft.autoCallIns = before.autoCallIns
  await saveTimesheetDraft(staff.email, draft)
  const calendar = earnsToil(staff.email)
    ? await toilOnCalendar(staff, period, cleanToilTaken(draft.entries[TOIL_TAKEN], period.days))
    : { errors: [] }
  return res.status(200).json({ saved: true, savedAt: draft.savedAt, calendarErrors: calendar.errors.length ? calendar.errors : undefined })
}

// ─── submit ────────────────────────────────────────────────

async function handleSubmit(req, res, session) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const staff = requireTimesheetSubmitter(session)
  const period = resolvePeriod(req.body?.periodStart)

  const existing = await getTimesheet('submitted', staff.email, period.start)
  if (existing && existing.status !== 'rejected') {
    return res.status(409).json({
      error: `A timesheet for ${period.start} to ${period.end} has already been ${existing.status}`
    })
  }

  const rates = await fetchEarningsRates()
  // The same question the screen asked when it was filled in, so a timesheet
  // cannot be submitted against a category the person is not assigned.
  const assignedRateIds = await assignedRatesFor(staff.name)
  const categories = categoriesForStaff(rates, staff.email, { assignedRateIds })
  // Belt and braces. The demo set is only ever served to an admin, and an
  // admin cannot submit — but a pay item that cannot reach a pay run should be
  // refused by the thing that posts to the pay run, not by the two gates in
  // front of it happening to hold.
  if (isDemo(req.body?.categories) || isDemo(categories)) {
    return res.status(400).json({ error: 'Those are demonstration pay items and cannot be filed.' })
  }
  const entered = normaliseEntries(req.body?.entries, categories, period.days)

  // TOIL taken (Brent, 12 Nov 2026): only for those who earn it, never more
  // than the balance. Kept apart from the pay items — it is leave, and goes to
  // Xero as a TOIL leave application when the timesheet is approved.
  const toilTaken = earnsToil(staff.email) ? cleanToilTaken(req.body?.entries?.[TOIL_TAKEN], period.days) : {}
  if (totalOf(toilTaken) > 0) {
    const room = await toilRoom(staff, { except: period.start })
    const check = toilTakenCheck({ taken: totalOf(toilTaken), balance: room.balance, alreadyClaimed: room.claimed })
    if (!check.ok) return res.status(400).json({ error: check.error, available: check.available })
  }

  // The leave on these days — portal and Xero — kept with the timesheet, so
  // Erin approves exactly what was submitted.
  const periodLeave = await leaveFor(staff, period)

  // Ordinary hours past a full-time contract go to TOIL — the same split the
  // screen showed before submit. See src/timesheetRules.js. Leave and TOIL
  // taken both come off the contract: neither is time worked.
  const leaveHours = periodLeave.total + totalOf(toilTaken)
  const overflow = toilOverflow({
    entries: entered, categories, days: period.days, contract: contractFor(staff.email), leaveHours
  })
  const entries = overflow.entries

  const check = validate(entries, categories, period.days)
  if (!check.ok) return res.status(400).json({ error: check.errors[0], errors: check.errors })

  // Xero first: if it rejects, nothing is recorded as submitted and the staff
  // member can correct and retry.
  const xero = await submitTimesheetToXero({
    staffName: staff.name,
    start: period.start,
    end: period.end,
    entries,
    categories,
    days: period.days
  })

  const record = {
    email: staff.email,
    staffName: staff.name,
    periodStart: period.start,
    periodEnd: period.end,
    days: period.days,
    entries,
    categories: categories.map(c => ({ key: c.key, label: c.label, unit: c.unit, earningsRateID: c.earningsRateID })),
    totals: check.totals,
    warnings: [
      ...check.warnings,
      ...(overflow.moved.length ? [`${overflow.excess}h over the ${overflow.limit}h fortnight banked as TOIL`] : []),
      ...(overflow.excess > 0 && !overflow.toilKey
        ? [`${overflow.excess}h over the ${overflow.limit}h fortnight, but there is no TOIL pay item to bank it in — check with Brent`] : [])
    ],
    toilOverflow: overflow.moved.length ? { excess: overflow.excess, limit: overflow.limit, moved: overflow.moved } : null,
    leave: { rows: periodLeave.rows, pending: periodLeave.pending, total: periodLeave.total, xeroError: periodLeave.xeroError || undefined },
    toilTaken,
    status: 'submitted',
    xero,
    submittedAt: new Date().toISOString()
  }
  await saveTimesheet('submitted', record)
  await clearTimesheetDraft(staff.email)
  if (earnsToil(staff.email)) await toilOnCalendar(staff, period, toilTaken).catch(() => {})

  let emailError = null
  try {
    await sendTimesheetSubmittedEmail(record)
  } catch (err) {
    emailError = err.message
    console.error('Timesheet submit email:', err.message)
  }

  return res.status(200).json({ record, emailError })
}

// ─── mine: this staff member's own timesheets ──────────────

async function handleMine(req, res, session) {
  const staff = requireTimesheetAccess(session)
  const all = await getAllTimesheets(100)
  const mine = all
    .filter(r => r.email === staff.email)
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))
  return res.status(200).json({ records: mine })
}

// ─── callins: after-hours cases, and the on-call weekend ───

/**
 * What the person filing might need to claim.
 *
 * Both halves come off one read of the calendar: the cases they may have been
 * called in to, and the weekends the roster says they were on call.
 *
 * The suggestions used to be every timed entry outside 7am–6pm, shown to
 * whoever was looking. That offered "List Order" — a standing reminder for the
 * team leader to ring the hospitals, on the calendar every weekday and never a
 * case — as something to claim a callout for, and it offered everybody else's
 * cases to everybody. Both are now decided in src/clinicalPlan/callIn.js.
 */
async function handleCallIns(req, res, session) {
  const staff = requireTimesheetAccess(session)
  const period = resolvePeriod(req.query.periodStart)

  const token = await getGoogleToken(CALENDAR_SCOPE_READONLY)
  const timeMin = `${period.start}T00:00:00+10:00`
  const timeMax = `${period.end}T23:59:59+10:00`
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getCalendarId())}/events`
    + `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
    + '&singleEvents=true&orderBy=startTime&maxResults=250'

  const eventsRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = await eventsRes.json()
  if (data.error) throw new Error(data.error.message)

  const events = data.items || []
  const onCallEntries = events
    .map(e => ({
      title: e.summary || '',
      date: (e.start?.dateTime || e.start?.date || '').slice(0, 10)
    }))
    .filter(e => e.date)

  // Only for people paid call-ins (Brent, 7 Nov 2026: "I am also attending
  // but I'm not on call and I don't get paid call-ins as a director"): somebody
  // not on timesheets, or without the call-in allowance among their pay items,
  // is neither offered one nor has one logged.
  const suggestions = paidCallIns(staff)
    ? callInsFor(events, staff, period.days, { onCallEntries })
    : []

  // Logged, not just offered (Brent, 7 Nov 2026: "the portal should auto log
  // call-ins … and prepopulate their timesheets"). A case out of hours on the
  // person's own on-call weekend, where they are on the booking or nobody is,
  // goes into their draft as one call-in on that day — once: the ids logged
  // are kept on the draft, so a call-in somebody takes back out stays out.
  // Never into a fortnight already filed, and only for people whose pay
  // items include the call-in allowance.
  const logged = await logCallIns(staff, period, suggestions.filter(s => s.auto))

  // The roster, read rather than computed — see src/clinicalPlan/onCall.js.
  const onCall = onCallHoursFor(onCallEntries, staff, period.days)

  return res.status(200).json({
    suggestions,
    logged,
    onCall: {
      byDay: onCall,
      hours: onCallTotal(onCall),
      offered: Object.keys(onCall).length > 0
    },
    // What a long call-in earns on top of the allowance, so the screen does
    // not have to know the rule.
    coveredHours: COVERED_HOURS,
    period: { start: period.start, end: period.end }
  })
}

/** Whether this person is paid call-ins at all. */
export function paidCallIns(staff) {
  return Boolean(staff?.hasTimesheets) && payItemsFor(staff.email).includes('call_in')
}

export async function logCallIns(staff, period, auto) {
  if (!auto.length || !paidCallIns(staff)) return []
  const filed = (await getAllTimesheets(100))
    .some(r => r.email === staff.email && r.periodStart === period.start && r.status !== 'rejected')
  if (filed) return []
  const draft = await getTimesheetDraft(staff.email)
  const base = draft?.periodStart === period.start
    ? draft
    : { email: staff.email, staffName: staff.name, periodStart: period.start, periodEnd: period.end, entries: {} }
  const done = new Set(base.autoCallIns || [])
  const fresh = auto.filter(s => !done.has(s.id))
  if (!fresh.length) return []
  const row = { ...(base.entries?.call_in || {}) }
  for (const s of fresh) row[s.day] = (Number(row[s.day]) || 0) + 1
  await saveTimesheetDraft(staff.email, {
    ...base,
    entries: { ...(base.entries || {}), call_in: row },
    autoCallIns: [...done, ...fresh.map(s => s.id)],
    savedAt: new Date().toISOString()
  })
  return fresh.map(({ id, day, title, time }) => ({ id, day, title, time }))
}

// ─── The TOIL balance ────────────────────────────────────────────────────────
// Xero accrues nothing from a timesheet — "TOIL Accrued" is an earnings rate,
// which records hours and does not move a leave balance — so the balance has
// been kept by hand. The app already held both halves and never put them
// together: the TOIL on every timesheet it has filed, and every TOIL leave
// application it has sent to Xero.
//
// It does not write the answer back. A number worked out here and posted into
// payroll with nobody looking would be a poor way to find out it was wrong.
// What it does is end the arithmetic, and say whether Xero has kept pace.
/**
 * Annual, sick and TOIL balances, read from Xero.
 *
 * Asked for so Erin can see that somebody actually has the leave they are
 * applying for, which until now meant opening Xero in another tab beside the
 * application. The numbers come from payroll rather than being recomputed
 * here: Xero is what pays people, and a second opinion on a leave balance is
 * worse than none — it invites somebody to approve against the wrong one.
 *
 * `all=1` for an admin returns the team; everybody else gets their own, which
 * is also worth having. Somebody who can see they have 38 hours of annual
 * leave before they apply is somebody who does not apply for 50.
 */
async function handleBalances(req, res, session) {
  const staff = requireTimesheetAccess(session)
  const everyone = req.query.all === '1' && staff.isAdmin
  const who = everyone ? STAFF.filter(s => s.hasTimesheets) : [staff]

  let token
  let tenantId
  try {
    ;({ token, tenantId } = await getXeroToken())
  } catch {
    // Not connected, or the refresh failed. Said plainly rather than as seven
    // people with no leave — an empty balance beside an application reads as
    // "they have none", which is the opposite of "we could not check".
    return res.status(200).json({ connected: false, people: [] })
  }

  // One employee list for everybody and one person at a time — Xero allows
  // five calls at once, and the whole team in parallel was well over that.
  let employees = null
  try { employees = await listEmployees(token, tenantId) } catch { /* each falls back to its own lookup */ }
  const people = []
  for (const person of who) {
    try {
      const employee = await findStaffInXero(token, tenantId, person, employees)
      const balances = await leaveBalances(token, tenantId, employee.EmployeeID)
      // TOIL from every record and every TOIL line, the same figure the
      // timesheet and leave screens show — see toilInXero.
      const toil = await toilInXero(token, tenantId, person, employees).catch(() => null)
      if (balances && toil && toil.hours !== null) {
        balances.toil = { ...(balances.toil || { kind: 'toil', units: 'Hours' }),
          name: toil.parts.length === 1 ? toil.parts[0].name : 'TOIL',
          hours: toil.hours, parts: toil.parts }
      }
      people.push({ name: person.name, email: person.email, matched: true, balances })
    } catch {
      // One person's lookup failing must not take the other eight with it.
      people.push({ name: person.name, email: person.email, matched: false, balances: null })
    }
  }

  return res.status(200).json({ connected: true, people })
}

async function handleToil(req, res, session) {
  const staff = requireTimesheetAccess(session)
  // An admin can ask about the whole team; everybody else gets their own.
  const everyone = req.query.all === '1' && staff.isAdmin
  const who = everyone ? STAFF.filter(s => s.hasTimesheets) : [staff]

  const [timesheets, leave] = await Promise.all([
    getAllTimesheets(200),
    getAllApplications().catch(() => ({ approved: [], pending: [] }))
  ])

  // Xero once for the whole team — the token and the employee list — then one
  // person at a time. Asking about seven people at once was ~25 calls in
  // parallel against Xero's limit of five, and each one refused came back as
  // an error on that person's card.
  let xero = null
  let xeroDown = ''
  try {
    const { token, tenantId } = await getXeroToken()
    xero = { token, tenantId, employees: await listEmployees(token, tenantId) }
  } catch (err) {
    xeroDown = err.message || 'Xero could not be read'
  }

  const people = []
  for (const person of who) people.push(await (async () => {
    const opening = await getToilOpening(person.email).catch(() => null)
    const ours = toilBalanceFor({ timesheets, leave, email: person.email, opening })
    const ledger = toilLedgerFor({ timesheets, leave, email: person.email, opening })
    // Xero's is the number that pays people, so it is the one staff are shown.
    // Every TOIL line is read — Toni has one per role — and a failure to find
    // somebody is said, not swallowed: "none" for Mat was indistinguishable
    // from Xero saying he had none.
    let inXero = null
    let xeroParts = []
    let xeroError = ''
    let xeroNote = ''
    if (xero) {
      try {
        const found = await toilInXero(xero.token, xero.tenantId, person, xero.employees)
        inXero = found.hours
        xeroParts = found.parts
        // Not having TOIL set up in Xero is a fact about the person, not a
        // fault — most of the team never accrue any. Said quietly.
        if (found.hours === null) xeroNote = found.error
      } catch (err) {
        xeroError = plainXeroError(err, person)
      }
    }
    return {
      name: person.name,
      email: person.email,
      ...ours,
      xero: inXero,
      xeroParts,
      xeroError,
      xeroNote,
      // What staff see as "in the bank": Xero's, where Xero answered, plus
      // nothing the app has not yet sent there. The app's own sum is the
      // check, shown to admins beside it.
      bank: inXero !== null ? inXero : ours.balance,
      bankSource: inXero !== null ? 'xero' : 'portal',
      check: compareWithXero(ours, inXero),
      ledger,
      openingNote: opening?.note || ''
    }
  })())

  return res.status(200).json({
    ok: true, people: everyone ? people : undefined, me: people[0],
    // Said once, at the top, when Xero itself could not be reached — not as
    // the same error on every card.
    xeroError: xeroDown ? plainXeroError(new Error(xeroDown)) : ''
  })
}

/** A Xero failure as a sentence an admin can act on, not Xero's raw words. */
function plainXeroError(err, person = null) {
  const text = String(err?.message || err || '')
  if (/not found in Xero/i.test(text)) {
    return `${person?.name || 'This person'} is not in Xero under that name — check the employee's name in Xero payroll.`
  }
  if (/429|rate limit|too many/i.test(text)) return 'Xero was busy — refresh the page in a minute.'
  if (/401|403|token|unauthori[sz]ed|forbidden|connect/i.test(text)) {
    return 'Xero needs reconnecting — Admin → Xero → Connect.'
  }
  return `Xero could not be read (${text.slice(0, 120)})`
}

/**
 * A staff member's Xero employee record, trying every name they go by.
 *
 * Mat is "Mat Usher" on the roster and may be "Matthew Usher" in Xero; the
 * roster's `aka` already lists that, so it is tried before giving up.
 */
async function findStaffInXero(token, tenantId, person, employees = null) {
  const names = [person.name, ...(person.aka || []).filter(n => /\s/.test(n))]
  let lastError = null
  for (const name of names) {
    try {
      const found = employees
        ? matchEmployee(employees, name)
        : await findEmployee(token, tenantId, name)
      if (found) return found
    } catch (err) {
      lastError = err
    }
  }
  throw lastError || new Error(`${person.name} was not found in Xero`)
}

/**
 * Everything Xero holds as TOIL for one staff member, added up.
 *
 * Two ways a person's TOIL can be split, and both are read: several TOIL leave
 * types on one employee record, or — where payroll keeps a second role as a
 * second employee — several records under the same name. Toni has 12h for her
 * admin role and 13.5h for her science role; showing either alone is wrong.
 *
 * @returns {{hours: number|null, parts: Array<{name, hours}>, error: string}}
 */
export async function toilInXero(token, tenantId, person, employees = null) {
  const primary = await findStaffInXero(token, tenantId, person, employees)
  const fullName = e => `${e.FirstName || ''} ${e.LastName || ''}`.trim().toLowerCase()
  let records = [primary]
  try {
    const everyone = employees || await listEmployees(token, tenantId)
    records = [primary, ...everyone.filter(e =>
      e.EmployeeID !== primary.EmployeeID && fullName(e) === fullName(primary))]
  } catch {
    // The primary record alone is still a correct answer for most people.
  }
  const parts = []
  const seen = []
  for (const record of records) {
    const balances = await leaveBalances(token, tenantId, record.EmployeeID)
    for (const part of balances?.toil?.parts || []) parts.push(part)
    for (const line of balances?.all || []) seen.push(line.name)
  }
  const counted = parts.filter(p => p.hours !== null)
  const hours = counted.length
    ? Math.round(counted.reduce((sum, p) => sum + p.hours, 0) * 100) / 100
    : null
  const error = hours !== null ? ''
    : `Xero has no TOIL balance for ${person.name}`
      + (seen.length ? ` (it has: ${[...new Set(seen)].join(', ')})` : '')
  return { hours, parts, error }
}

/**
 * Sets the portal's TOIL history to agree with Xero, today. Admin only.
 *
 * "We need to make sure these are accurate and talking to each other." The
 * portal's own balance starts from what it has seen — approved timesheets and
 * TOIL leave since it began — so anything earlier was missing, which is why it
 * showed nothing for Mat. This sets the opening balance to whatever makes the
 * portal's total equal Xero's now, with a note saying so; from then on the
 * two move together and any difference is a real one.
 */
async function handleToilMatch(req, res) {
  const admin = await requireAdmin(req, res)
  if (!admin) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const person = STAFF.find(s => s.email === req.body?.email && s.hasTimesheets)
  if (!person) return res.status(400).json({ error: 'Not somebody on timesheets' })
  const { token, tenantId } = await getXeroToken()
  const found = await toilInXero(token, tenantId, person)
  const xero = found.hours
  if (xero === null) {
    return res.status(400).json({ error: found.error || 'Xero has no TOIL balance for this person to match' })
  }
  const [timesheets, leave] = await Promise.all([
    getAllTimesheets(200), getAllApplications().catch(() => ({ approved: [], pending: [] }))
  ])
  const without = toilBalanceFor({ timesheets, leave, email: person.email, opening: 0 })
  const hours = Math.round((xero - without.balance) * 100) / 100
  const today = new Date().toISOString().slice(0, 10)
  const opening = {
    hours,
    note: `Matched to Xero (${xero}h${found.parts.length > 1
      ? ` — ${found.parts.map(p => `${p.name} ${p.hours}h`).join(', ')}` : ''}) on ${today}`,
    asAt: today,
    by: admin.name || admin.email,
    at: new Date().toISOString()
  }
  await setToilOpening(person.email, opening)
  return res.status(200).json({ ok: true, opening, xero })
}

/**
 * Sets somebody's TOIL opening balance. Admin only.
 *
 * "Allow an opening balance per person (e.g. from Xero) with a note." The
 * hours the app could not have seen — accrued before it kept the balance —
 * and where the number came from, so the ledger's first line explains itself.
 */
async function handleToilOpening(req, res) {
  const admin = await requireAdmin(req, res)
  if (!admin) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { email, hours, note, asAt } = req.body || {}
  const person = STAFF.find(s => s.email === email && s.hasTimesheets)
  if (!person) return res.status(400).json({ error: 'Not somebody on timesheets' })
  const value = Number(hours)
  if (!Number.isFinite(value) || Math.abs(value) > 500) {
    return res.status(400).json({ error: 'Hours must be a number' })
  }
  const opening = {
    hours: Math.round(value * 100) / 100,
    note: String(note || '').trim().slice(0, 200),
    asAt: /^\d{4}-\d{2}-\d{2}$/.test(String(asAt || '')) ? asAt : '',
    by: admin.name || admin.email,
    at: new Date().toISOString()
  }
  await setToilOpening(person.email, opening)
  return res.status(200).json({ ok: true, opening })
}

/**
 * Approved leave on the days of a pay period, for the person filing it.
 *
 * So the timesheet can show it, and the standard week can leave those hours
 * out rather than claim them twice — once as leave, once as ordinary time.
 */
async function handleLeaveDays(req, res, session) {
  const staff = requireTimesheetAccess(session)
  const start = String(req.query.periodStart || '')
  if (!isValidPeriodStart(start)) return res.status(400).json({ error: 'periodStart is not a period start' })
  // An admin may look at someone else's (Erin, checking a timesheet).
  const who = req.query.email && staff.isAdmin ? getStaffByEmail(String(req.query.email)) : staff
  if (!who) return res.status(404).json({ error: 'No such person' })
  const period = periodFor(start)
  const leave = await getAllApplications().catch(() => ({ approved: [] }))
  const periodLeave = await leaveFor(who, period, leave)
  let toil = null
  if (earnsToil(who.email)) {
    const room = await toilRoom(who, { except: start })
    toil = { balance: room.balance, claimed: room.claimed, source: room.source,
      available: room.balance === null ? null : Math.round((room.balance - room.claimed) * 100) / 100 }
  }
  return res.status(200).json({
    days: leaveOnDays({ leave, email: who.email, days: period.days }),
    leave: periodLeave,
    earnsToil: earnsToil(who.email),
    toil
  })
}

// ─── Leave and TOIL taken on the timesheet (Brent, 12 Nov 2026) ──────────────
// See src/timesheetLeave.js for the rules.

/** This person's leave over a fortnight: the portal's and Xero's own. */
async function leaveFor(person, period, leaveIn = null) {
  const leave = leaveIn || await getAllApplications().catch(() => ({ approved: [], pending: [] }))
  let xero = []
  let xeroError = ''
  try {
    const { token, tenantId } = await getXeroToken()
    const employee = await findStaffInXero(token, tenantId, person)
    xero = await overlappingXeroLeave(token, tenantId, employee.EmployeeID, period.start, period.end)
  } catch (err) {
    xeroError = `Leave entered straight into Xero could not be read (${err.message})`
  }
  return { ...leaveForPeriod({ leave, xero, email: person.email, days: period.days }), xeroError }
}

const hobartToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Hobart' }).format(new Date())

/**
 * How much TOIL this person can take: Xero's balance (the portal's where Xero
 * cannot say), less TOIL taken on their timesheets awaiting approval, and on
 * ones approved in the last fortnight — Xero's balance only moves when the
 * pay run is processed, so those hours are spoken for but not yet off it.
 */
async function toilRoom(person, { except = '' } = {}) {
  const [timesheets, leave] = await Promise.all([
    getAllTimesheets(200), getAllApplications().catch(() => ({ approved: [], pending: [] }))
  ])
  const mine = timesheets.filter(t => String(t.email).toLowerCase() === person.email.toLowerCase() && t.periodStart !== except)
  const cutoff = new Date(Date.now() - 15 * 86400000).toISOString().slice(0, 10)
  let balance = null
  let source = 'xero'
  try {
    const { token, tenantId } = await getXeroToken()
    balance = (await toilInXero(token, tenantId, person)).hours
  } catch { /* falls back below */ }
  const portalTaken = t => totalOf(t.toilTaken)
  let claimed = mine.filter(t => t.status === 'submitted').reduce((s, t) => s + portalTaken(t), 0)
  if (balance === null) {
    source = 'portal'
    const opening = await getToilOpening(person.email).catch(() => null)
    balance = toilBalanceFor({ timesheets, leave, email: person.email, opening }).balance
  } else {
    claimed += mine.filter(t => t.status === 'approved' && String(t.periodEnd) >= cutoff).reduce((s, t) => s + portalTaken(t), 0)
  }
  return { balance, claimed: Math.round(claimed * 100) / 100, source }
}

/** Future TOIL days on the leave calendar, kept in step with the timesheet. */
async function toilOnCalendar(person, period, toilTaken) {
  const key = `toilcal:${person.email}:${period.start}`
  let existing = {}
  try { existing = JSON.parse(await redis('get', key) || '{}') || {} } catch { existing = {} }
  const today = hobartToday()
  const want = futureDays(toilTaken, today)
  if (!Object.keys(want).length && !Object.keys(existing).some(d => d >= today)) return { errors: [] }
  try {
    const { entries, errors } = await syncToilCalendar({ name: person.name, want, existing, today })
    await redisSetBody(key, JSON.stringify(entries))
    return { errors }
  } catch (err) {
    return { errors: [`The leave calendar could not be updated (${err.message})`] }
  }
}

/**
 * TOIL taken on an approved timesheet, sent to Xero as TOIL leave — one
 * application per run of consecutive days — and kept in the portal's leave
 * store (source 'timesheet') so the TOIL balance and ledger count it. Each run
 * is done once: what Xero already accepted is remembered on the record.
 */
async function sendToilTaken(record, staff) {
  const done = { ...(record.toilLeave?.done || {}) }
  const errors = []
  for (const run of runsOf(record.toilTaken)) {
    const key = run[0].date
    if (done[key]) continue
    try {
      const result = await submitToXero({
        name: staff.name, startDate: run[0].date, endDate: run[run.length - 1].date, leaveType: 'TOIL',
        reason: `TOIL taken on the timesheet for ${record.periodStart} to ${record.periodEnd}`,
        hours: run
      })
      const id = `ts-${staff.email.split('@')[0]}-${key}-${Math.random().toString(36).slice(2, 7)}`
      const application = {
        id, email: staff.email, name: staff.name, division: staff.division, leaveType: 'TOIL',
        startDate: run[0].date, endDate: run[run.length - 1].date, hours: run,
        totalHours: Math.round(run.reduce((s, d) => s + d.hours, 0) * 100) / 100,
        reason: `TOIL taken on timesheet ${record.periodStart}`, status: 'approved', source: 'timesheet',
        xero: { ok: true, id: result?.leaveApplicationID || null, at: new Date().toISOString() },
        createdAt: new Date().toISOString()
      }
      await redisSetBody(`leave:${id}`, JSON.stringify(application))
      await redis('lpush', 'leave:approved', id)
      done[key] = { xeroId: result?.leaveApplicationID || null, leaveId: id, hours: application.totalHours }
    } catch (err) {
      errors.push(`${key}: ${err.message}`)
    }
  }
  return { ok: errors.length === 0, done, error: errors.join(' · ') || undefined, at: new Date().toISOString() }
}

/** Admin: try again to send TOIL taken that Xero refused at approval. */
async function handleToilRetry(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const admin = await requireAdmin(req, res)
  if (!admin) return
  const { email, periodStart } = req.body || {}
  const record = await getTimesheet('submitted', email, periodStart)
  if (!record || record.status !== 'approved') return res.status(404).json({ error: 'No approved timesheet to send TOIL for' })
  const staff = getStaffByEmail(email)
  const toilLeave = await sendToilTaken(record, staff)
  const next = { ...record, toilLeave }
  await saveTimesheet('submitted', next)
  await saveTimesheet('approved', next)
  return res.status(200).json({ record: next })
}

// ─── list / decide: admin ──────────────────────────────────

async function handleList(req, res) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  const all = await getAllTimesheets(100)
  const byStatus = { submitted: [], approved: [], rejected: [] }
  for (const r of all) (byStatus[r.status] ||= []).push(r)

  const period = currentPeriod()
  const expected = STAFF.filter(s => s.hasTimesheets)
  const submittedThisPeriod = new Set(all.filter(r => r.periodStart === period.start).map(r => r.email))

  return res.status(200).json({
    ...byStatus,
    currentPeriod: { start: period.start, end: period.end },
    outstanding: expected
      .filter(s => !submittedThisPeriod.has(s.email))
      .map(s => ({ name: s.name, email: s.email }))
  })
}

async function handleDecide(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const admin = await requireAdmin(req, res)
  if (!admin) return

  const { email, periodStart, decision, reason, entries } = req.body || {}
  if (!email || !periodStart) throw badRequest('email and periodStart are required')
  if (!['approve', 'reject'].includes(decision)) throw badRequest('decision must be approve or reject')

  const record = await getTimesheet('submitted', email, periodStart)
  if (!record) return res.status(404).json({ error: 'Timesheet not found' })
  if (record.status !== 'submitted') {
    return res.status(409).json({ error: `This timesheet has already been ${record.status}` })
  }

  if (decision === 'reject') {
    if (!String(reason || '').trim()) throw badRequest('A reason is required when returning a timesheet')
    const rejected = {
      ...record, status: 'rejected', rejectionReason: reason,
      decidedBy: admin.email, decidedAt: new Date().toISOString()
    }
    await saveTimesheet('submitted', rejected)
    let emailError = null
    try { await sendTimesheetDecisionEmail(rejected, 'rejected', reason) } catch (err) { emailError = err.message }
    return res.status(200).json({ record: rejected, emailError })
  }

  // An admin may correct hours before approving; re-validate whatever they send.
  const staff = getStaffByEmail(email)
  const rates = await fetchEarningsRates()
  const categories = categoriesForStaff(rates, email)
  const finalEntries = entries
    ? normaliseEntries(entries, categories, record.days)
    : record.entries

  const check = validate(finalEntries, categories, record.days)
  if (!check.ok) return res.status(400).json({ error: check.errors[0], errors: check.errors })

  const edited = entries ? JSON.stringify(finalEntries) !== JSON.stringify(record.entries) : false
  const approvedRecord = {
    ...record,
    staffName: staff?.name || record.staffName,
    entries: finalEntries,
    totals: check.totals,
    status: 'approved',
    editedByAdmin: edited,
    decidedBy: admin.email,
    decidedAt: new Date().toISOString()
  }

  // TOIL taken is checked against the balance again — it may have moved since
  // the timesheet was submitted. Over it, the timesheet is not approved.
  const taking = totalOf(record.toilTaken)
  if (taking > 0) {
    const room = await toilRoom(staff || { email, name: record.staffName }, { except: record.periodStart })
    const check = toilTakenCheck({ taken: taking, balance: room.balance, alreadyClaimed: room.claimed })
    if (!check.ok) {
      return res.status(400).json({ error: `${record.staffName}: ${check.error.replace(/^You have/, 'has')} Return the timesheet to have it corrected.` })
    }
  }

  // Push the approval to Xero before recording it, so an approved record always
  // means Xero agrees.
  const xeroResult = await approveTimesheetInXero(approvedRecord, categories)
  approvedRecord.xero = { ...approvedRecord.xero, ...xeroResult }

  // Then the TOIL taken, as TOIL leave in Xero. A failure does not undo the
  // approval: it is said on the timesheet with Try again.
  if (taking > 0) approvedRecord.toilLeave = await sendToilTaken(approvedRecord, staff || { email, name: record.staffName })

  await saveTimesheet('submitted', approvedRecord)
  await saveTimesheet('approved', approvedRecord)

  let emailError = null
  try { await sendTimesheetDecisionEmail(approvedRecord, 'approved') } catch (err) { emailError = err.message }

  return res.status(200).json({ record: approvedRecord, emailError })
}

export { totals }
