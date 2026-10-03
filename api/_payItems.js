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
  // No dollar figures here any more. These said "$450 per callout" and "$4.50
  // per hour"; the callout rate is $250. A number written down in two places
  // disagrees eventually, and the copy in the code is the one nobody updates.
  // Both now come off the Xero rate itself — see rateFacts below.
  { key: 'call_in', pattern: /call\s*in/i, label: 'Call-In Allowance', kind: 'allowance', unit: 'count', colour: 'purple' },
  { key: 'on_call', pattern: /on\s*call/i, label: 'On-Call Hours', kind: 'allowance', unit: 'hours', colour: 'purple' },
  { key: 'ordinary', pattern: /ordinary/i, label: 'Ordinary Hours', kind: 'ordinary', unit: 'hours', colour: 'navy' }
]


/**
 * What Xero actually says a unit of this rate is, and what it pays.
 *
 * This is the difference between a call-in paying $250 and paying one hour.
 * A timesheet line is always "units"; what a unit *means* is the earnings
 * rate's own setup. Enter 1 against a rate Xero holds as rate-per-unit/Hours
 * and Xero records one hour — which is exactly what has been happening to
 * call-ins.
 *
 * The app cannot fix a pay item's configuration from here. What it can do is
 * stop guessing: show the real figure, and say plainly when the unit a
 * category is entered in is not the unit the rate is paid in.
 */
function rateFacts(rate) {
  const units = String(rate?.TypeOfUnits ?? rate?.typeOfUnits ?? '').trim()
  const amount = Number(rate?.RatePerUnit ?? rate?.ratePerUnit)
  return {
    rateType: String(rate?.RateType ?? rate?.rateType ?? '').trim() || null,
    typeOfUnits: units || null,
    ratePerUnit: Number.isFinite(amount) ? amount : null,
    // "Hours" is the only unit type that means time. Anything else — Callouts,
    // Each, Days — is a thing you count.
    paidByTheHour: /^hours?$/i.test(units)
  }
}

/** The money line under a category, from Xero rather than from memory. */
function hintFor(facts) {
  if (facts.ratePerUnit == null) return ''
  const money = `$${facts.ratePerUnit.toFixed(2).replace(/\.00$/, '')}`
  const per = facts.typeOfUnits ? facts.typeOfUnits.replace(/s$/i, '').toLowerCase() : 'unit'
  return `${money} per ${per}`
}

/**
 * Whether a category is entered in one unit and paid in another.
 *
 * A call-in is counted — one call-in, two call-ins — and if its Xero rate is
 * set up in hours then entering 1 pays one hour instead of one call-in. That
 * is a payroll error the app is otherwise silent about, and the person it
 * short-changes is the one who got out of bed.
 */
export function unitMismatch(category) {
  if (!category || !category.typeOfUnits) return null
  if (category.unit === 'count' && category.paidByTheHour) {
    return `Xero pays ${category.xeroName} by the hour, so entering 1 records one `
      + 'hour rather than one call-in. The pay item needs its own unit in Xero.'
  }
  if (category.unit === 'hours' && !category.paidByTheHour) {
    return `Xero pays ${category.xeroName} per ${category.typeOfUnits.toLowerCase()}, `
      + 'not per hour, so hours entered here are not hours paid.'
  }
  return null
}

/**
 * Pay items that must never appear on a timesheet.
 *
 * Commission is worked out once a month by Brent, from figures nobody else
 * sees, and staff have no business entering their own. It is on their Xero pay
 * template because that is where it is paid from — which became a problem the
 * moment entitlements started coming from the template: the item would have
 * turned up on the fortnightly timesheet with a box to type a number into.
 *
 * Excluded by what the rate is called rather than by who has it, because the
 * rule is about the kind of pay and not about the person. Anything added here
 * disappears from every timesheet at once.
 */
const NOT_ON_TIMESHEETS = /commission|bonus|reimbursement|expense/i

/** Whether an earnings rate is one the team fills in for themselves. */
function enterableOnATimesheet(rate) {
  return !NOT_ON_TIMESHEETS.test(String(rate?.Name ?? rate?.name ?? ''))
}

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
export function categoriesForStaff(allRates, staffEmail, { assignedRateIds } = {}) {
  // Taken out once, here, so neither the recognised pass nor the catch-all
  // below can let one through.
  const earningsRates = (allRates || []).filter(enterableOnATimesheet)
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
      ...rateFacts(match),
      hint: hintFor(rateFacts(match))
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
      // An unrecognised rate is entered in whatever Xero pays it in, rather
      // than assumed to be hours.
      unit: rateFacts(rate).paidByTheHour ? 'hours' : 'count',
      colour: 'navy',
      ...rateFacts(rate),
      hint: hintFor(rateFacts(rate))
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


// ─── A timesheet with everything on it ───────────────────────────────────────
// Brent's own Xero pay template has one earnings rate on it, because he does
// not file a timesheet — so opening the screen to check it shows a single
// column and none of the parts worth checking: the callout counter, the
// on-call drawer, the Toni split, the TOIL balance.
//
// This builds the full set from CATEGORY_RULES rather than from a list written
// out by hand, so a category added to the app appears here without anybody
// remembering to. The rates are invented and say so: the IDs are not Xero IDs
// and could not be posted to a pay run if anything tried.
export const DEMO_RATE_PREFIX = 'demo-'

const DEMO_RATES = {
  ordinary: 48.5,
  ordinary_toni_admin: 44,
  ordinary_toni_scientific: 52,
  overtime_1_5: 72.75,
  overtime_double: 97,
  toil_accrued: 0,
  call_in: 250,
  on_call: 4.5
}

const DEMO_UNITS = { call_in: 'Call Ins' }

/**
 * Every category the app knows how to show, as a timesheet would carry them.
 *
 * Not for filing anything. The earnings rate IDs are prefixed so the submit
 * path can refuse them outright rather than relying on nobody pressing the
 * button.
 */
export function demoCategories() {
  return CATEGORY_RULES.map(rule => {
    const typeOfUnits = DEMO_UNITS[rule.key] || (rule.unit === 'count' ? 'Each' : 'Hours')
    const facts = {
      rateType: 'RATEPERUNIT',
      typeOfUnits,
      ratePerUnit: DEMO_RATES[rule.key] ?? null,
      paidByTheHour: /^hours?$/i.test(typeOfUnits)
    }
    return {
      key: rule.key,
      earningsRateID: `${DEMO_RATE_PREFIX}${rule.key}`,
      xeroName: rule.label,
      label: rule.label,
      kind: rule.kind,
      unit: rule.unit,
      colour: rule.colour,
      ...facts,
      hint: hintFor(facts),
      demo: true
    }
  })
}

/** Whether a set of categories is the invented one. */
export const isDemo = categories =>
  (categories || []).some(c => String(c.earningsRateID || '').startsWith(DEMO_RATE_PREFIX))
