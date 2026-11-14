// ─── Read-only payroll check (Brent, 14 Nov 2026: "Do a read only check") ────
// Does Xero's payroll match what the portal has been told about each person?
// Reads the org's earnings rates and leave types, and each timesheet person's
// pay template, and lays them against their contract row in src/payOptions.js.
// Nothing is written to Xero. Pay amounts on a person's own template are not
// returned — only which pay items they have; the org-wide rate on an
// allowance (call-in, on-call) is, because that is what the portal relies on.

import { getXeroToken, findEmployee, getEmployee, listLeaveTypes } from './_xeroClient.js'
import { fetchEarningsRates, categoriesForStaff, rateFacts, classify, enterableOnATimesheet } from './_payItems.js'
import { STAFF } from '../src/staffConfig.js'
import { payItemsFor, PAY_ITEMS } from '../src/payOptions.js'
import { contractFor } from '../src/timesheetRules.js'
import { paidOnCall, paysCallIns } from '../src/clinicalPlan/onCall.js'
import { earnsToil } from '../src/timesheetLeave.js'

const idOf = r => r?.EarningsRateID || r?.earningsRateID
const nameOf = r => r?.Name || r?.name || ''

/** Pure: one person's contract against Xero. Exported for tests. */
export function comparePerson({ person, rates, templateIds }) {
  const wanted = payItemsFor(person.email)
  const byId = new Map(rates.map(r => [idOf(r), r]))
  const template = (templateIds || []).map(id => byId.get(id)).filter(Boolean)
  const templateKeys = new Map(template.map(r => [classify(nameOf(r))?.key || `other:${nameOf(r)}`, nameOf(r)]))
  const offered = categoriesForStaff(rates, person.email, { assignedRateIds: templateIds })
  const offeredKeys = new Set(offered.map(c => c.key))
  const problems = []
  if (!templateIds) problems.push('No pay template found in Xero (or the employee could not be matched by name).')
  for (const key of wanted) {
    if (offeredKeys.has(key)) continue
    // Toni's TOIL fallback is only needed when the split rates are missing.
    if (key === 'toil_accrued' && wanted.includes('toil_toni_admin') && offeredKeys.has('toil_toni_admin')) continue
    const exists = rates.some(r => classify(nameOf(r))?.key === key)
    problems.push(exists
      ? `${PAY_ITEMS[key]} is in their contract but not on their Xero pay template.`
      : `${PAY_ITEMS[key]} is in their contract but Xero has no earnings rate for it.`)
  }
  for (const [key, name] of templateKeys) {
    if (key.startsWith('other:')) {
      if (enterableOnATimesheet({ Name: name })) problems.push(`"${name}" is on their Xero template; the portal does not know what it is.`)
      continue
    }
    if (!wanted.includes(key)) problems.push(`"${name}" is on their Xero template but not in their contract — they will not see it on a timesheet.`)
  }
  for (const c of offered) {
    if (c.timesheetOk === false) problems.push(`"${c.xeroName}" cannot go on a Xero timesheet (fixed amount, archived or lump sum) — it has to be added in the pay run.`)
    if (c.key === 'call_in' && c.paidByTheHour) problems.push(`"${c.xeroName}" is paid by the hour in Xero — one call-in would pay one hour, not $250.`)
    if (c.key === 'on_call' && c.typeOfUnits && !c.paidByTheHour) problems.push(`"${c.xeroName}" is not paid by the hour in Xero, but on-call is sent in hours.`)
  }
  return {
    name: person.name,
    contract: {
      fortnightHours: contractFor(person.email)?.fortnightHours ?? null,
      earnsToil: earnsToil(person.email),
      paidOnCall: paidOnCall(person.email),
      paidCallIns: paysCallIns(person.email),
      items: wanted.map(k => PAY_ITEMS[k] || k)
    },
    xeroTemplate: [...templateKeys.values()],
    willSee: offered.map(c => c.label),
    problems
  }
}

export async function payrollCheck() {
  const rates = await fetchEarningsRates()
  const { token, tenantId } = await getXeroToken()
  let leaveTypes = []
  let leaveTypesError = ''
  try { leaveTypes = (await listLeaveTypes(token, tenantId)).map(t => ({ name: t.Name, unit: t.TypeOfUnits, paid: t.IsPaidLeave })) }
  catch (err) { leaveTypesError = err.message }

  const people = []
  for (const person of STAFF.filter(s => s.hasTimesheets)) {
    let templateIds = null
    try {
      const employee = await findEmployee(token, tenantId, person.name)
      const id = employee?.EmployeeID || employee?.employeeID
      if (id) {
        const full = await getEmployee(token, tenantId, id)
        const lines = full?.PayTemplate?.EarningsLines || []
        templateIds = lines.length ? [...new Set(lines.map(l => l.EarningsRateID || l.earningsRateID).filter(Boolean))] : null
      }
    } catch { templateIds = null }
    people.push(comparePerson({ person, rates, templateIds }))
  }

  return {
    checkedAt: new Date().toISOString(),
    earningsRates: rates.map(r => {
      const facts = rateFacts(r)
      const key = classify(nameOf(r))?.key || null
      return {
        name: nameOf(r),
        portalItem: key ? PAY_ITEMS[key] : null,
        earningsType: r.EarningsType || null,
        rateType: facts.rateType,
        unit: facts.typeOfUnits,
        // Org-wide rates only matter for allowances; ordinary rates are per person.
        rate: /call|allowance/i.test(nameOf(r)) || r.EarningsType === 'ALLOWANCE' ? facts.ratePerUnit : undefined,
        onTimesheets: facts.timesheetOk,
        archived: r.CurrentRecord === false || undefined
      }
    }),
    leaveTypes,
    leaveTypesError: leaveTypesError || undefined,
    people,
    allClear: people.every(p => !p.problems.length)
  }
}
