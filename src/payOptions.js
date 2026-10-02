// ─── Who is offered which pay item ───────────────────────────────────────────
// The earnings rates themselves come from Xero, so the IDs are always the org's
// real ones and nothing here can invent a pay item that payroll has never heard
// of. What this decides is narrower and entirely a business question: which of
// those rates each person is allowed to put hours against.
//
// It used to be answered by two flags buried in the matching rules in
// api/_payItems.js — `onlyFor` and `notFor`, both naming Toni's email — which
// worked, and hid the answer in the middle of a list of regular expressions.
// Nobody can review a policy written like that, and the policy is the part that
// has to be right: a category somebody should not see is a wrong payslip, and a
// category they should see and do not is an unpaid callout.
//
// So it is a table. One row per person, saying what they may claim.
//
// ── Filling this in ──
//
// `DEFAULT` is what everybody gets unless their row says otherwise, and the
// rows below reproduce exactly what the app did before this file existed —
// nothing has changed yet, on purpose. Marking someone as salaried, or as not
// entitled to overtime, is a change to what they are paid, and that is not a
// thing to guess at from the outside. Set `reviewed: true` on a row once the
// entitlement has actually been confirmed against their contract.

/** Every category the app knows how to show. Keys match CATEGORY_RULES. */
export const PAY_ITEMS = {
  ordinary: 'Ordinary Hours',
  ordinary_toni_admin: 'Ordinary — Admin',
  ordinary_toni_scientific: 'Ordinary — Scientific',
  overtime_1_5: 'Overtime 1.5×',
  overtime_double: 'Overtime — Double',
  toil_accrued: 'TOIL Accrued',
  call_in: 'Call-In Allowance',
  on_call: 'On-Call Hours'
}

/**
 * What somebody is offered when their row does not say.
 *
 * Everything the app knows about, less the two rates that exist only for Toni's
 * split. That is what the code did before, expressed as a list instead of as a
 * pair of exclusions.
 */
export const DEFAULT = [
  'ordinary', 'overtime_1_5', 'overtime_double', 'toil_accrued', 'call_in', 'on_call'
]

/**
 * Per-person entitlements.
 *
 * `items`     the categories this person may claim
 * `reviewed`  whether a human has checked this against their contract. False
 *             means "this is what the app happened to do", not "this is right".
 * `note`      why it differs, for whoever reads this next
 */
export const PAY_OPTIONS = {
  'toni@technomed.com.au': {
    // Toni's ordinary hours are split between two rates so the scientific
    // portion is costed separately. The split is why the timesheet offers her a
    // slider rather than one box.
    items: ['ordinary_toni_admin', 'ordinary_toni_scientific',
      'overtime_1_5', 'overtime_double', 'toil_accrued', 'call_in', 'on_call'],
    reviewed: true,
    note: 'Ordinary hours split between admin and scientific rates.'
  }
}

/**
 * The category keys one person may claim.
 *
 * Unknown people get the default rather than nothing: a new starter who has not
 * been added here should be able to file a timesheet, and an empty list would
 * present them with a screen that cannot be filled in and no explanation.
 */
export function payItemsFor(email) {
  const row = PAY_OPTIONS[String(email || '').toLowerCase()]
  return row?.items || DEFAULT
}

/** Whether somebody's entitlement has actually been checked, or is just inherited. */
export function isReviewed(email) {
  return Boolean(PAY_OPTIONS[String(email || '').toLowerCase()]?.reviewed)
}
