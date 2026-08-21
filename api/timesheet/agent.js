import { requireSession, requireAdmin } from '../_auth.js'
import { STAFF, getStaffByEmail } from '../../src/staffConfig.js'
import {
  saveTimesheetDraft, getTimesheetDraft, clearTimesheetDraft,
  saveTimesheet, getTimesheet, getAllTimesheets
} from '../_redis.js'
import { fetchEarningsRates, categoriesForStaff } from '../_payItems.js'
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

function requireTimesheetStaff(session) {
  const staff = getStaffByEmail(session.email)
  if (!staff?.hasTimesheets) throw Object.assign(new Error('Timesheets are not enabled for your account'), { status: 403 })
  return staff
}

function resolvePeriod(raw) {
  if (!raw) return currentPeriod()
  if (!isValidPeriodStart(raw)) throw badRequest('That is not the start of a fortnight')
  return periodFor(raw)
}

// ─── payitems: categories for this staff member ────────────

async function handlePayItems(req, res, session) {
  const staff = requireTimesheetStaff(session)
  const rates = await fetchEarningsRates()
  const categories = categoriesForStaff(rates, staff.email)
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
  const staff = requireTimesheetStaff(session)

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
  const staff = requireTimesheetStaff(session)
  const period = resolvePeriod(req.body?.periodStart)

  const existing = await getTimesheet('submitted', staff.email, period.start)
  if (existing && existing.status !== 'rejected') {
    return res.status(409).json({
      error: `A timesheet for ${period.start} to ${period.end} has already been ${existing.status}`
    })
  }

  const rates = await fetchEarningsRates()
  const categories = categoriesForStaff(rates, staff.email)
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
  const staff = requireTimesheetStaff(session)
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
  requireTimesheetStaff(session)
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
