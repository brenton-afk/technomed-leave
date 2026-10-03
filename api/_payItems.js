// ─── Xero pay items → timesheet categories ────────────────────────────────────
// Earnings rates come from Xero so the IDs are always the org's real ones, but
// which categories a staff member sees, how each is coloured, and whether it is
// measured in hours or callouts is decided here.
import { getXeroToken, findEmployee, assignedEarningsRateIds } from './_xeroClient.js'
import { payItemsFor } from '../src/payOptions.js'

const XERO_API_BASE = 'https://api.xero.com/payroll.xro/1.0'

// Matched against the Xero earnings rate name, most specific first — the two
// Toni rates must be tested before the generic "Ordinary Hours".
//
// These say how a rate is *shown*: its label, whether it is measured in hours
// or callouts, what colour it takes. They no longer say who gets it. Who gets
// what is a business question and it is answered in one reviewable table, in
// src/payOptions.js, rather than as onlyFor/notFor flags buried in a list of
// regular expressions where nobody could check the policy.
export const CATEGORY_RULES = [
  { key: 'ordinary_toni_admin', pattern: /ordinary.*toni.*admin/i, label: 'Ordinary — Admin', kind: 'ordinary', unit: 'hours', colour: 'navy' },
  { key: 'ordinary_toni_scientific', pattern: /ordinary.*toni.*scientific/i, label: 'Ordinary — Scientific', kind: 'ordinary', unit: 'hours', colour: 'blue' },
  { key: 'overtime_double', pattern: /double\s*time|overtime.*(2x|double)/i, label: 'Overtime — Double', kind: 'overtime', unit: 'hours', colour: 'amber' },
  { key: 'overtime_1_5', pattern: /overtime/i, label: 'Overtime 1.5×', kind: 'overtime', unit: 'hours', colour: 'amber' },
  { key: 'toil_accrued', pattern: /toil/i, label: 'TOIL Accrued', kind: 'toil', unit: 'hours', colour: 'teal' },
  { key: 'call_in', pattern: /call\s*in/i, label: 'Call-In Allowance', kind: 'allowance', unit: 'count', colour: 'purple', hint: '$450 per callout' },
  { key: 'on_call', pattern: /on\s*call/i, label: 'On-Call Hours', kind: 'allowance', unit: 'hours', colour: 'purple', hint: '$4.50 per hour' },
  { key: 'ordinary', pattern: /ordinary/i, label: 'Ordinary Hours', kind: 'ordinary', unit: 'hours', colour: 'navy' }
]

function classify(rateName) {
  return CATEGORY_RULES.find(rule => rule.pattern.test(rateName || '')) || null
}

// Xero nests earnings rates under PayItems; shape has varied across API
// versions, so accept either the wrapper or a bare array.
function extractEarningsRates(payload) {
  const items = payload?.PayItems ?? payload
  const rates = items?.EarningsRates ?? items?.earningsRates
  return Array.isArray(rates) ? rates : []
}

export async function fetchEarningsRates() {
  const { token, tenantId } = await getXeroToken()
  const res = await fetch(`${XERO_API_BASE}/PayItems`, {
    headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' }
  })
  const data = await res.json()
  if (!res.ok || data.ErrorNumber) {
    throw new Error(`Xero PayItems failed (${res.status}): ${data.Message || 'unknown error'}`)
  }
  return extractEarningsRates(data)
}

// The categories one staff member should see, in display order. Anything in
// Xero we do not recognise is returned too (as `kind: 'other'`) rather than
// hidden, so a new earnings rate is visible instead of silently missing.
export function categoriesForStaff(earningsRates, staffEmail, { assignedRateIds } = {}) {
  const email = String(staffEmail || '').toLowerCase()
  const seen = new Set()
  const categories = []

  // What this person may claim.
  //
  // From Xero where their pay template says — that is the entitlement, kept by
  // whoever runs payroll, in the system that actually pays people. Add a pay
  // item to somebody there and it appears on their timesheet; nobody has to
  // remember to tell the app.
  //
  // The table in src/payOptions.js is the fallback for an employee Xero cannot
  // be asked about: no template set up, no matching record, or Xero down. An
  // empty timesheet is a worse answer than a reasonable default, and somebody
  // who cannot file their hours on a Sunday night does not care why.
  const assigned = Array.isArray(assignedRateIds) && assignedRateIds.length
    ? new Set(assignedRateIds)
    : null
  const allowed = assigned ? null : new Set(payItemsFor(email))

  for (const rule of CATEGORY_RULES) {
    if (allowed && !allowed.has(rule.key)) continue

    const match = earningsRates.find(r => {
      const id = r.EarningsRateID || r.earningsRateID
      if (seen.has(id)) return false
      // When Xero has told us what this person is assigned, that decides it.
      if (assigned && !assigned.has(id)) return false
      return classify(r.Name || r.name)?.key === rule.key
    })
    if (!match) continue

    const id = match.EarningsRateID || match.earningsRateID
    seen.add(id)
    categories.push({
      key: rule.key,
      earningsRateID: id,
      xeroName: match.Name || match.name,
      label: rule.label,
      kind: rule.kind,
      unit: rule.unit,
      colour: rule.colour,
      hint: rule.hint || ''
    })
  }

  for (const rate of earningsRates) {
    const id = rate.EarningsRateID || rate.earningsRateID
    if (seen.has(id) || !id) continue
    // An unrecognised rate is still shown rather than hidden — a new earnings
    // rate should be visible, not silently missing — but only to the people
    // Xero says have it.
    if (assigned && !assigned.has(id)) continue
    if (classify(rate.Name || rate.name)) continue // a known kind this staffer does not get
    categories.push({
      key: `other_${id}`,
      earningsRateID: id,
      xeroName: rate.Name || rate.name,
      label: rate.Name || rate.name,
      kind: 'other',
      unit: 'hours',
      colour: 'navy',
      hint: ''
    })
  }

  return categories
}


/**
 * The earnings rates Xero says one of our staff is assigned.
 *
 * Null whenever the question cannot be answered — no matching employee, no pay
 * template, Xero unreachable — so the caller falls back to the table rather
 * than presenting somebody a timesheet with nothing on it. A payroll outage
 * must not stop the team recording their hours.
 */
export async function assignedRatesFor(staffName) {
  try {
    const { token, tenantId } = await getXeroToken()
    const employee = await findEmployee(token, tenantId, staffName)
    const id = employee?.EmployeeID || employee?.employeeID
    if (!id) return null
    return await assignedEarningsRateIds(token, tenantId, id)
  } catch {
    return null
  }
}
