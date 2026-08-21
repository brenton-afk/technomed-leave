// ─── Xero timesheet submission ────────────────────────────────────────────────
import { getXeroToken, findEmployee } from './_xeroClient.js'
import { xeroDate, FORTNIGHT_DAYS } from './_fortnight.js'

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
    body: JSON.stringify({ Timesheets: [payload] })
  })
  const data = await res.json()
  if (!res.ok || data.ErrorNumber) {
    const detail = data.Elements?.[0]?.ValidationErrors?.map(v => v.Message).join('; ')
    throw new Error(detail || data.Message || `Xero timesheet failed (${res.status})`)
  }
  const created = data.Timesheets?.[0]
  return { timesheetID: created?.TimesheetID, status: created?.Status }
}

// Staff submission: lands in Xero as DRAFT so payroll can review before it is
// picked up by a pay run.
export async function submitTimesheetToXero({ staffName, start, end, entries, categories, days }) {
  const { token, tenantId } = await getXeroToken()
  const employee = await findEmployee(token, tenantId, staffName)

  const lines = buildTimesheetLines(entries, categories, days)
  if (lines.length === 0) throw new Error('There are no hours to submit')

  const result = await postTimesheet(buildTimesheetPayload({
    employeeID: employee.EmployeeID,
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
    dayCount: days.length
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
