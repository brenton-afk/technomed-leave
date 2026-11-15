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
export function buildTimesheetLines(entries, categories, days, { salaried = false } = {}) {
  const lines = []
  for (const category of categories) {
    // A salaried person's ordinary hours stay in the portal (Claude in Chrome's
    // audit, 15 Nov 2026): on the Xero timesheet they would replace the salary
    // line and pay the hours at an hourly rate. Only what is on top of the
    // salary — TOIL, overtime, call-ins, on-call — is sent.
    if (salaried && category.kind === 'ordinary') continue
    // A pay item Xero will not take on a timesheet goes in the pay run instead
    // (see timesheetOk in _payItems.js and notOnTimesheet below).
    if (category.timesheetOk === false) continue
    const units = unitsForCategory(entries?.[category.key], days)
    if (units.every(u => u === 0)) continue // don't send empty lines
    lines.push({ EarningsRateID: category.earningsRateID, NumberOfUnits: units })
  }
  return lines
}

/** Entries on pay items Xero will not take on a timesheet: label and total. */
export function notOnTimesheet(entries, categories, days) {
  return categories.filter(c => c.timesheetOk === false).map(c => ({
    key: c.key, label: c.label || c.xeroName, xeroName: c.xeroName,
    total: unitsForCategory(entries?.[c.key], days).reduce((a, b) => a + b, 0)
  })).filter(c => c.total > 0)
}

const REFUSED_RATE = /Earnings Rate ([0-9a-f-]{36}) does not exist or is not valid for timesheets/i

/**
 * Posts a timesheet, and when Xero refuses a pay item for timesheets (Ben,
 * 14 Nov 2026) posts it again without that item's line — whatever the reason
 * Xero gives no detail on. The refused items come back so the portal keeps
 * them for the pay run. Never drops the last line.
 */
export async function postDroppingRefused(post, lines, categories = []) {
  let remaining = [...lines]
  const refused = []
  for (;;) {
    try {
      return { result: await post(remaining), refused }
    } catch (err) {
      const id = String(err.message || '').match(REFUSED_RATE)?.[1]
      const left = remaining.filter(l => l.EarningsRateID !== id)
      if (!id || left.length === remaining.length || left.length === 0) {
        throw new Error(namedXeroError(err.message, categories))
      }
      refused.push(id)
      remaining = left
    }
  }
}

/** Xero's error with any earnings rate id named as the pay item it is. */
export function namedXeroError(message, categories = []) {
  let text = String(message || '')
  for (const c of categories) {
    if (c.earningsRateID && text.includes(c.earningsRateID)) {
      text = text.split(c.earningsRateID).join(`"${c.xeroName || c.label}"`)
    }
  }
  return text
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
    const wanted = String(start).slice(0, 10)
    // Xero answers 100 timesheets a page, oldest first. Reading only the first
    // page found nothing once the org had more than 100 — every person, every
    // fortnight since June — and a resubmission then posted a second one.
    for (let page = 1; page <= 30; page++) {
      const res = await fetch(`${XERO_API_BASE}/Timesheets?page=${page}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Xero-tenant-id': tenantId,
          Accept: 'application/json'
        }
      })
      const { ok, data } = await readXero(res, 'Xero timesheets')
      if (!ok) return null
      const all = Array.isArray(data) ? data : data.Timesheets || []
      const found = all.find(t =>
        t.EmployeeID === employeeID
        && xeroDateToIso(t.StartDate) === wanted)
      if (found) return found
      if (all.length < 100) return null
    }
    return null
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

export async function submitTimesheetToXero({ staffName, start, end, entries, categories, days, salaried = false }) {
  const { token, tenantId } = await getXeroToken()
  const employee = await findEmployee(token, tenantId, staffName)

  const lines = buildTimesheetLines(entries, categories, days, { salaried })
  if (lines.length === 0 && salaried) {
    // Nothing on top of the salary: no Xero timesheet, so the pay run pays
    // the salary. One already in Xero for the fortnight would replace it.
    const already = await existingTimesheet(token, tenantId, employee.EmployeeID, start)
    return {
      skipped: true, salaried: true, employeeID: employee.EmployeeID,
      employeeName: `${employee.FirstName} ${employee.LastName}`,
      existingDraft: already ? { id: already.TimesheetID, status: already.Status } : null
    }
  }
  if (lines.length === 0) throw new Error('There are no hours to submit')

  // Xero refuses a second timesheet for the same person and fortnight —
  // "This timesheet already exists, please provide the timesheet ID" — and it
  // is right to. Sending the ID turns the same post into an update, which is
  // what somebody resubmitting actually means.
  const already = await existingTimesheet(token, tenantId, employee.EmployeeID, start)

  // Unless payroll has already dealt with it. Overwriting an approved or
  // processed timesheet is changing what somebody has been paid, and that is
  // not a thing a resubmission should do quietly. PROCESSED (in a pay run —
  // paid) used to be on the allowed list, which was exactly backwards; only a
  // draft, or one payroll sent back, may be replaced.
  if (already && !['DRAFT', 'REJECTED'].includes(String(already.Status || '').toUpperCase())) {
    throw new Error(
      `Xero already has this fortnight marked ${String(already.Status).toLowerCase()}. `
      + 'Ask Brent or Erin to reopen it before resubmitting.')
  }

  let posted
  try {
    posted = await postDroppingRefused(sendLines => postTimesheet(buildTimesheetPayload({
      employeeID: employee.EmployeeID,
      timesheetID: already?.TimesheetID,
      start,
      end,
      lines: sendLines,
      status: 'DRAFT'
    })), lines, categories)
  } catch (err) {
    // A timesheet the person made themselves in Xero (Xero Me) cannot be
    // changed by anyone else (Brent's test of Mat's, 15 Nov 2026).
    if (/employee created timesheets/i.test(err.message)) {
      throw new Error(`${employee.FirstName} already has a timesheet in Xero for this fortnight that they made themselves, and Xero will not let the portal change it. Delete it in Xero (Payroll → Timesheets), then submit again.`)
    }
    throw err
  }
  const { result, refused } = posted
  const refusedCats = categories.filter(c => refused.includes(c.earningsRateID))
    .map(c => ({ ...c, timesheetOk: false }))

  return {
    ...result,
    employeeID: employee.EmployeeID,
    employeeName: `${employee.FirstName} ${employee.LastName}`,
    lineCount: lines.length,
    notOnTimesheet: notOnTimesheet(entries, categories.map(c => refusedCats.find(r => r.key === c.key) || c), days),
    // Kept so approval leaves the same lines off.
    refusedRateIds: refused,
    dayCount: days.length,
    // Recorded so a resubmission is distinguishable from a first one when
    // somebody asks later why Xero has a different number.
    replaced: Boolean(already),
    salaried: Boolean(salaried)
  }
}

// Admin approval: flips the existing Xero timesheet to APPROVED so it is picked
// up by the pay run.
export async function approveTimesheetInXero(record, categories) {
  // Salaried with nothing on top of the salary: there is no Xero timesheet.
  if (record.xero?.skipped) return { status: 'NONE', skipped: true }
  if (!record.xero?.timesheetID) {
    throw new Error('This timesheet has no Xero timesheet ID — it was never submitted to Xero')
  }
  const days = record.days || []
  const skip = new Set(record.xero?.refusedRateIds || [])
  const lines = buildTimesheetLines(record.entries, categories, days, { salaried: Boolean(record.xero?.salaried) }).filter(l => !skip.has(l.EarningsRateID))
  const { result } = await postDroppingRefused(sendLines => postTimesheet(buildTimesheetPayload({
    employeeID: record.xero.employeeID,
    timesheetID: record.xero.timesheetID,
    start: record.periodStart,
    end: record.periodEnd,
    lines: sendLines,
    status: 'APPROVED'
  })), lines, categories)
  return result
}

export { FORTNIGHT_DAYS }

// ─── The pay run and banked TOIL (Claude in Chrome's audit, 15 Nov 2026) ──────
// "A draft pay run only picks up timesheets approved before it was created",
// and "the TOIL … Accrued timesheet lines pay $0 but don't add to the TOIL
// leave balance" — every TOIL leave type is set to no automatic calculation.
// So on approval the portal says whether a draft pay run already exists, and
// lists the banked hours as a leave accrual for Erin to add to the payslip.

/** The draft pay run covering a period, or null. Read only. */
export async function draftPayRunFor(periodStart) {
  try {
    const { token, tenantId } = await getXeroToken()
    const res = await fetch(`${XERO_API_BASE}/PayRuns?where=${encodeURIComponent('PayRunStatus=="DRAFT"')}`, {
      headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' }
    })
    const { ok, data } = await readXero(res, 'Xero pay runs')
    if (!ok) return null
    const runs = Array.isArray(data) ? data : data.PayRuns || []
    const run = runs.find(r => String(r.PayRunStatus || '').toUpperCase() === 'DRAFT'
      && xeroDateToIso(r.PayRunPeriodStartDate) === String(periodStart).slice(0, 10))
    return run ? { id: run.PayRunID, paymentDate: xeroDateToIso(run.PaymentDate) } : null
  } catch {
    return null
  }
}

/** Xero's TOIL leave type for each TOIL pay item. */
export const TOIL_LEAVE_FOR = { toil_accrued: 'TOIL', toil_toni_admin: 'TOIL - Admin', toil_toni_scientific: 'TOIL - Science' }

/** Banked TOIL on an approved timesheet, per Xero leave type: [{ leaveType, hours }]. Pure. */
export function toilToAccrue(entries) {
  const out = []
  for (const [key, leaveType] of Object.entries(TOIL_LEAVE_FOR)) {
    const hours = Math.round(Object.values(entries?.[key] || {}).reduce((s, v) => s + Number(v || 0), 0) * 100) / 100
    if (hours > 0) out.push({ leaveType, hours })
  }
  return out
}

// ─── Banked TOIL onto the draft payslip (Brent's amendment, 15 Nov 2026) ─────
// "Xero draft payslips have a leave accrual section … for banked TOIL, as well
// as the $0 TOIL Accrued timesheet line, write a leave accrual line to the
// employee's payslip in the DRAFT pay run against the matching leave type …
// After posting, read the balance back and flag any mismatch."

async function xeroCall(method, path, body) {
  const { token, tenantId } = await getXeroToken()
  const res = await fetch(`${XERO_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const { ok, data, error } = await readXero(res, `Xero ${path.split('?')[0]}`)
  if (!ok) throw new Error(error)
  return data
}

const plainType = n => String(n || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
const unitsOf = l => Number(l?.NumberOfUnits ?? 0)

/**
 * What to post to the payslip's leave accrual lines. Pure. Keeps every line
 * already there (Xero's own annual and personal accruals) and adds one per
 * banked TOIL type — unless that type already has a line, which is left alone
 * and reported (Erin may have added it by hand; adding again would double it).
 */
export function accrualLinesFor(existing, wanted) {
  const lines = (existing || []).map(l => ({ LeaveTypeID: l.LeaveTypeID, NumberOfUnits: unitsOf(l), AutoCalculate: Boolean(l.AutoCalculate) }))
  const added = []
  const already = []
  for (const w of wanted) {
    const there = lines.find(l => l.LeaveTypeID === w.leaveTypeID)
    if (there && there.NumberOfUnits > 0) { already.push({ ...w, onPayslip: there.NumberOfUnits }); continue }
    if (there) { there.NumberOfUnits = w.hours; there.AutoCalculate = false } else lines.push({ LeaveTypeID: w.leaveTypeID, NumberOfUnits: w.hours, AutoCalculate: false })
    added.push(w)
  }
  return { lines, added, already }
}

/** Current TOIL leave type ids by name. */
async function toilTypeIds() {
  const data = await xeroCall('GET', '/LeaveTypes')
  const types = (data.LeaveTypes || []).filter(t => (t.CurrentRecord ?? true) !== false)
  return name => types.find(t => plainType(t.Name) === plainType(name))?.LeaveTypeID || null
}

/** Each leave type's balance by name, for the before/after check. */
async function balancesByName(employeeID) {
  const data = await xeroCall('GET', `/Employees/${employeeID}`)
  const emp = (data.Employees || [])[0] || {}
  const out = {}
  for (const b of emp.LeaveBalances || []) out[plainType(b.LeaveName)] = Number(b.NumberOfUnits ?? 0)
  return out
}

/**
 * Writes banked TOIL onto the person's payslip in the draft pay run for the
 * period. lines: [{ leaveType, hours }]. Returns { status } — 'added',
 * 'no-draft' (no draft pay run yet: try again once Erin creates it),
 * 'not-on-payslip', or 'already' (a line of that type is on it already).
 */
export async function addToilToPayslip({ employeeID, periodStart, lines }) {
  const run = await draftPayRunFor(periodStart)
  if (!run) return { status: 'no-draft' }
  const runData = await xeroCall('GET', `/PayRuns/${run.id}`)
  const slip = ((runData.PayRuns || [])[0]?.Payslips || []).find(p => p.EmployeeID === employeeID)
  if (!slip) return { status: 'not-on-payslip', payRunID: run.id }

  const idFor = await toilTypeIds()
  const wanted = []
  for (const l of lines) {
    const leaveTypeID = idFor(l.leaveType)
    if (!leaveTypeID) throw new Error(`No current Xero leave type called "${l.leaveType}"`)
    wanted.push({ ...l, leaveTypeID })
  }
  const before = await balancesByName(employeeID)
  const slipData = await xeroCall('GET', `/Payslip/${slip.PayslipID}`)
  const { lines: post, added, already } = accrualLinesFor(slipData.Payslip?.LeaveAccrualLines, wanted)
  if (added.length) await xeroCall('POST', `/Payslip/${slip.PayslipID}`, [{ LeaveAccrualLines: post }])

  // Read it back: the line is there, at the hours, or it is not done.
  const after = await xeroCall('GET', `/Payslip/${slip.PayslipID}`)
  const onSlip = after.Payslip?.LeaveAccrualLines || []
  const missing = added.filter(w => !onSlip.some(l => l.LeaveTypeID === w.leaveTypeID && Math.abs(unitsOf(l) - w.hours) < 0.01))
  if (missing.length) throw new Error(`Xero did not keep the TOIL accrual on the payslip (${missing.map(m => m.leaveType).join(', ')})`)
  return {
    status: already.length && !added.length ? 'already' : 'added',
    payRunID: run.id, payslipID: slip.PayslipID,
    lines: wanted.map(w => ({ leaveType: w.leaveType, hours: w.hours, before: before[plainType(w.leaveType)] ?? null })),
    already: already.map(a => ({ leaveType: a.leaveType, hours: a.hours, onPayslip: a.onPayslip })),
    at: new Date().toISOString()
  }
}

/**
 * Once the pay run is posted, each TOIL balance should be what it was before
 * plus what was banked, less TOIL taken in the same pay run. Pure.
 */
export function toilBalanceMismatches(lines, after, takenByType = {}) {
  return lines.filter(l => l.before !== null && l.before !== undefined).map(l => {
    const expected = Math.round((l.before + l.hours - Number(takenByType[l.leaveType] || 0)) * 100) / 100
    const actual = after[plainType(l.leaveType)]
    return { leaveType: l.leaveType, expected, actual: actual ?? null }
  }).filter(m => m.actual === null || Math.abs(m.actual - m.expected) > 0.01)
}

/** After the pay run is posted: reads the balances back. */
export async function checkToilBalance({ employeeID, payRunID, lines, takenByType }) {
  const runData = await xeroCall('GET', `/PayRuns/${payRunID}`)
  const status = String((runData.PayRuns || [])[0]?.PayRunStatus || '').toUpperCase()
  if (status !== 'POSTED') return { status: 'not-posted', payRunStatus: status || 'unknown' }
  const after = await balancesByName(employeeID)
  const mismatches = toilBalanceMismatches(lines, after, takenByType)
  return { status: mismatches.length ? 'mismatch' : 'ok', mismatches, checkedAt: new Date().toISOString() }
}
