// ─── Xero timesheet submission ────────────────────────────────────────────────
import { getXeroToken, findEmployee } from './_xeroClient.js'
import { xeroDate, FORTNIGHT_DAYS } from './_fortnight.js'
import { readXero } from './_xeroResponse.js'

const XERO_API_BASE = 'https://api.xero.com/payroll.xro/1.0'

// Xero wants one value per day of the timesheet period. The spec's example
// showed a 7-value array, but a fortnight is 14 days — a 7-value array would
// silently drop the second week — so the length is derived from the period.
export function unitsForCategory(entries, days) {
  return days.map(day => {
    const value = Number(entries?.[day] ?? 0)
    if (!Number.isFinite(value) || value <= 0) return 0
    return Math.round(value * 100) / 100
  })
}

// entries: { [categoryKey]: { [dateStr]: hours } }
export function buildTimesheetLines(entries, categories, days) {
  const lines = []
  for (const category of categories) {
    const units = unitsForCategory(entries?.[category.key], days)
    if (units.every(u => u === 0)) continue // don't send empty lines
    lines.push({ EarningsRateID: category.earningsRateID, NumberOfUnits: units })
  }
  return lines
}

export function buildTimesheetPayload({ employeeID, timesheetID, start, end, lines, status }) {
  const payload = {
    EmployeeID: employeeID,
    StartDate: xeroDate(start),
    EndDate: xeroDate(end),
    Status: status,
    TimesheetLines: lines
  }
  // Including the ID turns the same POST into an update, which is how approval
  // moves an already-submitted timesheet to APPROVED.
  if (timesheetID) payload.TimesheetID = timesheetID
  return payload
}

async function postTimesheet(payload) {
  const { token, tenantId } = await getXeroToken()
  const res = await fetch(`${XERO_API_BASE}/Timesheets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    // A bare array, not { Timesheets: [...] }.
    //
    // Xero's AU payroll endpoints take the collection at the root of the body.
    // Wrapped, it answered:
    //
    //   Cannot deserialize the current JSON object into type
    //   UpdateTimesheetRequest because the type requires a JSON array.
    //   Path 'Timesheets', line 1, position 14.
    //
    // Position 14 being exactly where `{"Timesheets":` ends. The reply still
    // comes back wrapped, which is the asymmetry that made this easy to get
    // wrong — see below.
    body: JSON.stringify([payload])
  })
  // Through readXero, because Xero answers errors with XML and `res.json()`
  // threw on the angle bracket — replacing the real message with a parse
  // error that told a staff member nothing at all.
  const { ok, data, error } = await readXero(res, 'Xero timesheet')
  if (!ok) throw new Error(error)
  // The request takes a bare array and the response comes back wrapped, so
  // both shapes are accepted rather than assuming the one we happened to see.
  const created = Array.isArray(data) ? data[0] : data.Timesheets?.[0]
  return { timesheetID: created?.TimesheetID, status: created?.Status }
}

// Staff submission: lands in Xero as DRAFT so payroll can review before it is
// picked up by a pay run.

/**
 * The timesheet Xero already holds for this person and fortnight, if any.
 *
 * The app checked its own records for a duplicate and never asked Xero, which
 * was fine until a submission failed in a way that left Xero holding one and
 * the app holding nothing. That is exactly what this morning's errors did: the
 * post reached Xero, the reply could not be read, and the staff member was
 * told it had failed. It had not.
 *
 * Returns null rather than throwing when the lookup itself fails — not being
 * able to check is not the same as there being nothing, and the submit below
 * still gets Xero's own answer either way.
 */
async function existingTimesheet(token, tenantId, employeeID, start) {
  try {
    const res = await fetch(`${XERO_API_BASE}/Timesheets`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Xero-tenant-id': tenantId,
        Accept: 'application/json'
      }
    })
    const { ok, data } = await readXero(res, 'Xero timesheets')
    if (!ok) return null
    const all = Array.isArray(data) ? data : data.Timesheets || []
    const wanted = String(start).slice(0, 10)
    return all.find(t =>
      t.EmployeeID === employeeID
      && xeroDateToIso(t.StartDate) === wanted) || null
  } catch {
    return null
  }
}

/** Xero answers dates as /Date(1234567890000+0000)/ — back to YYYY-MM-DD. */
function xeroDateToIso(value) {
  const ms = /\/Date\((-?\d+)/.exec(String(value || ''))
  if (ms) return new Date(Number(ms[1])).toISOString().slice(0, 10)
  return String(value || '').slice(0, 10)
}

export async function submitTimesheetToXero({ staffName, start, end, entries, categories, days }) {
  const { token, tenantId } = await getXeroToken()
  const employee = await findEmployee(token, tenantId, staffName)

  const lines = buildTimesheetLines(entries, categories, days)
  if (lines.length === 0) throw new Error('There are no hours to submit')

  // Xero refuses a second timesheet for the same person and fortnight —
  // "This timesheet already exists, please provide the timesheet ID" — and it
  // is right to. Sending the ID turns the same post into an update, which is
  // what somebody resubmitting actually means.
  const already = await existingTimesheet(token, tenantId, employee.EmployeeID, start)

  // Unless payroll has already dealt with it. Overwriting an approved or
  // processed timesheet is changing what somebody has been paid, and that is
  // not a thing a resubmission should do quietly.
  if (already && !['DRAFT', 'PROCESSED'].includes(String(already.Status || '').toUpperCase())) {
    throw new Error(
      `Xero already has this fortnight marked ${String(already.Status).toLowerCase()}. `
      + 'Ask Brent or Erin to reopen it before resubmitting.')
  }

  const result = await postTimesheet(buildTimesheetPayload({
    employeeID: employee.EmployeeID,
    timesheetID: already?.TimesheetID,
    start,
    end,
    lines,
    status: 'DRAFT'
  }))

  return {
    ...result,
    employeeID: employee.EmployeeID,
    employeeName: `${employee.FirstName} ${employee.LastName}`,
    lineCount: lines.length,
    dayCount: days.length,
    // Recorded so a resubmission is distinguishable from a first one when
    // somebody asks later why Xero has a different number.
    replaced: Boolean(already)
  }
}

// Admin approval: flips the existing Xero timesheet to APPROVED so it is picked
// up by the pay run.
export async function approveTimesheetInXero(record, categories) {
  if (!record.xero?.timesheetID) {
    throw new Error('This timesheet has no Xero timesheet ID — it was never submitted to Xero')
  }
  const days = record.days || []
  return postTimesheet(buildTimesheetPayload({
    employeeID: record.xero.employeeID,
    timesheetID: record.xero.timesheetID,
    start: record.periodStart,
    end: record.periodEnd,
    lines: buildTimesheetLines(record.entries, categories, days),
    status: 'APPROVED'
  }))
}

export { FORTNIGHT_DAYS }
