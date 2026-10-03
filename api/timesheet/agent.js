import { requireSession, requireAdmin } from '../_auth.js'
import { STAFF, getStaffByEmail } from '../../src/staffConfig.js'
import {
  saveTimesheetDraft, getTimesheetDraft, clearTimesheetDraft,
  saveTimesheet, getTimesheet, getAllTimesheets
} from '../_redis.js'
import {
  fetchEarningsRates, categoriesForStaff, CATEGORY_RULES, assignedRatesFor, unitMismatch
} from '../_payItems.js'
import { payItemsFor, isReviewed, PAY_ITEMS } from '../../src/payOptions.js'
import { submitTimesheetToXero, approveTimesheetInXero } from '../_timesheetXero.js'
import { normaliseEntries, validate, totals } from '../_timesheetValidate.js'
import { periodFor, currentPeriod, recentPeriods, isValidPeriodStart } from '../_fortnight.js'
import { getGoogleToken, getCalendarId, CALENDAR_SCOPE_READONLY } from '../_googleCalendar.js'
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
  await saveTimesheetDraft(staff.email, draft)
  return res.status(200).json({ saved: true, savedAt: draft.savedAt })
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
  const entries = normaliseEntries(req.body?.entries, categories, period.days)

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
    warnings: check.warnings,
    status: 'submitted',
    xero,
    submittedAt: new Date().toISOString()
  }
  await saveTimesheet('submitted', record)
  await clearTimesheetDraft(staff.email)

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

// ─── callins: after-hours calendar cases ───────────────────

// Surfaces bookings that fall outside business hours so the staff member can
// confirm whether they were called in. It cannot tell whose case it was — the
// calendar has no rep field — so these are prompts, never auto-entered.
async function handleCallIns(req, res, session) {
  requireTimesheetAccess(session)
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

  const BUSINESS_START = 7
  const BUSINESS_END = 18
  const suggestions = []

  for (const event of data.items || []) {
    const startsAt = event.start?.dateTime
    if (!startsAt) continue // all-day entries are leave, not callouts
    // Read the hour in Tasmanian time regardless of the server's zone.
    const aest = new Date(new Date(startsAt).getTime() + 10 * 3600 * 1000)
    const hour = aest.getUTCHours()
    const day = aest.toISOString().slice(0, 10)
    const weekend = [0, 6].includes(aest.getUTCDay())
    if (!weekend && hour >= BUSINESS_START && hour < BUSINESS_END) continue
    if (!period.days.includes(day)) continue
    suggestions.push({
      id: event.id,
      day,
      title: event.summary || 'Case',
      time: `${String(hour).padStart(2, '0')}:${String(aest.getUTCMinutes()).padStart(2, '0')}`,
      location: event.location || null,
      reason: weekend ? 'weekend' : 'outside 7am–6pm'
    })
  }

  return res.status(200).json({ suggestions, period: { start: period.start, end: period.end } })
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

  // Push the approval to Xero before recording it, so an approved record always
  // means Xero agrees.
  const xeroResult = await approveTimesheetInXero(approvedRecord, categories)
  approvedRecord.xero = { ...approvedRecord.xero, ...xeroResult }

  await saveTimesheet('submitted', approvedRecord)
  await saveTimesheet('approved', approvedRecord)

  let emailError = null
  try { await sendTimesheetDecisionEmail(approvedRecord, 'approved') } catch (err) { emailError = err.message }

  return res.status(200).json({ record: approvedRecord, emailError })
}

export { totals }
