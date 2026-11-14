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
  toil_toni_admin: 'TOIL — Admin',
  toil_toni_scientific: 'TOIL — Scientific',
  call_in: 'Call-in',
  on_call: 'On-call (roster)'
}

/**
 * What somebody is offered when their row does not say.
 *
 * Everything the app knows about, less the rates that exist only for Toni's
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
  // Confirmed with Brent, 14 Nov 2026 — each row is the person's contract.
  'erin@technomed.com.au': {
    items: ['ordinary', 'overtime_1_5', 'overtime_double', 'toil_accrued'],
    reviewed: true,
    note: 'Permanent part-time, 24h a week on days that change. TOIL or overtime if she wishes; time and a half for the odd Saturday. Approves her own timesheet.'
  },
  'toni@technomed.com.au': {
    // Ordinary hours split between admin and scientific as the work needs —
    // mostly about 90% admin, ad hoc. TOIL banks in whichever she chooses;
    // `toil_accrued` stays as the fallback for an org with one TOIL rate.
    items: ['ordinary_toni_admin', 'ordinary_toni_scientific', 'overtime_double',
      'toil_toni_admin', 'toil_toni_scientific', 'toil_accrued'],
    reviewed: true,
    note: 'Permanent part-time, 16.5h a week (Mon, Wed, Thu). Admin and scientific hours ad hoc; TOIL in either.'
  },
  'ben@technomed.com.au': {
    items: ['ordinary', 'overtime_double', 'toil_accrued', 'call_in', 'on_call'],
    reviewed: true,
    note: 'Full time, 76h a fortnight. Extra hours: TOIL, or double time with Erin\'s approval. On-call roster and call-ins.'
  },
  'aimee@technomed.com.au': {
    items: ['ordinary', 'overtime_double', 'toil_accrued', 'call_in', 'on_call'],
    reviewed: true,
    note: 'Full time, 76h a fortnight. Extra hours: TOIL, or double time with Erin\'s approval. On-call roster and call-ins.'
  },
  'mat@technomed.com.au': {
    items: ['ordinary', 'overtime_double', 'toil_accrued', 'call_in', 'on_call'],
    reviewed: true,
    note: 'Full time, 76h a fortnight (director of a division by title only). Extra hours: TOIL, or double time with Erin\'s approval. On-call roster and call-ins.'
  },
  'april@technomed.com.au': {
    items: ['ordinary', 'call_in', 'on_call'],
    reviewed: true,
    note: 'Casual: enters her hours (loading in her Xero rate). On-call roster and call-ins.'
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
