// ─── Commission rules (Brent, 15 Nov 2026) ────────────────────────────────────
// Seeded from the monthly workbooks in Dropbox (/Admin/Accounts/Finances/
// Commissions — Mat, Jeremy and Toni, September 2026 "rates as per August 2026
// table"). Brent edits the rates in the portal; these are only the defaults.
//
// A ROW is one source of commission: which Xero invoice lines it is (by the
// contact and the line's words), TechnoMed's own rate (shown, not used), and
// what a person's rate is applied to — `tm`, TechnoMed's commission (the
// invoice line's amount), or `sales`, the sales figure the line states.
// Rows are tried in order, so the specific come before the general.
// `expected` rows are invoiced every month; one with nothing is said.

export const ROWS = [
  { id: 'signus', expected: true, label: 'Signus Australia', contact: 'signus australia', tmRate: 0.30 },
  { id: 'device_mariner', expected: true, label: 'Device Technologies Implants (Mariner, Northstar, Reef TO)', contact: 'device technologies', words: 'mariner|northstar|reef', tmRate: 0.25 },
  { id: 'device_shoreline', expected: true, label: 'Device Technologies Implants (Shoreline, Icotec)', contact: 'device technologies', words: 'shoreline|icotec', tmRate: 0.225 },
  { id: 'boost_ultrafibres', label: 'Boost Ultrafibres', contact: 'device technologies', words: 'ultra ?fib', tmRate: 0.12 },
  { id: 'boost', expected: true, label: 'Boost Allograft (Spine)', contact: 'device technologies', words: 'boost', tmRate: 0.12 },
  { id: 'nuvasive', expected: true, label: 'Nuvasive', contact: 'globus|nuvasive', tmRate: 0.27 },
  { id: 'e4', expected: true, label: 'E4 Surgical', contact: 'e4 surgical', tmRate: 0.30 },
  { id: 'evomed_capital', label: 'Evomed Capital', contact: 'evomed', words: 'capital', tmRate: 0.07 },
  { id: 'evomed', expected: true, label: 'Evomed', contact: 'evomed', tmRate: 0.154 },
  { id: 'kt_dtbv_jpw', label: 'KT Medical (DTBV Sales) JPW Our implants', contact: 'kt medical', words: 'dtbv.*jpw|jpw.*dtbv', tmRate: 0.10 },
  { id: 'kt_dtbv_all', expected: true, label: 'KT Medical (DTBV Sales) All Surgeons', contact: 'kt medical', words: 'dtbv', tmRate: 0.20 },
  { id: 'kt_crosslinks', label: 'KT Medical Implants (Cross Links/Connectors)', contact: 'kt medical', words: 'cross ?link|connector', tmRate: 0.25 },
  { id: 'kt_support', expected: true, label: 'KT Medical (Clinical Support)', contact: 'kt medical', tmRate: 0.25 },
  { id: 'novus', expected: true, label: 'Novus Surgical (Xperience)', contact: 'novus', tmRate: 0.20 },
  { id: 'jj_capital', label: 'Johnson and Johnson (Capital)', contact: 'depuy|johnson', words: 'capital|power tool|consumable', tmRate: 0.10 },
  { id: 'matortho', label: 'Mat Ortho (RECERF)', contact: 'mat ?ortho', tmRate: 0.20 },
  // Not a commission invoice: TechnoMed's own sales of these Lateral Medical
  // products to Calvary Lenah Valley, on invoices dated in the sales month.
  { id: 'lateral', expected: true, label: 'Lateral Medical', contact: 'calvary lenah valley', items: 'jackson spinal kit|shoulder stabilisation kit|beach chair', tmRate: 0.20, ownSales: true }
]

const SPINE = ['signus', 'device_mariner', 'device_shoreline', 'boost', 'nuvasive', 'e4', 'kt_support', 'kt_crosslinks', 'kt_dtbv_all', 'kt_dtbv_jpw']

/** Each person: which rows pay them, at what rate, on what, into which Xero pay item. */
export const PEOPLE = [
  {
    email: 'mat@technomed.com.au', name: 'Mat Usher', folder: 'Mat Commissions', file: 'Mat Commissions',
    rates: [
      ...SPINE.map(row => ({ row, rate: 0.015, base: 'tm', payItem: 'Commissions Spine' })),
      { row: 'evomed', rate: 0.10, base: 'sales', payItem: 'Commissions Evomed' },
      { row: 'evomed_capital', rate: 0.03, base: 'sales', payItem: 'Commissions Evomed' },
      { row: 'novus', rate: 0.15, base: 'tm', payItem: 'Commission Novus Surgical' },
      { row: 'lateral', rate: 0.01, base: 'sales', payItem: 'Commissions Lateral Medical' }
    ]
  },
  {
    email: 'jeremy@technomed.com.au', name: 'Jeremy Sharpen', folder: 'Jeremy Commissions', file: 'Jeremy Commissions',
    // J&J trauma (and its target) is not here: that agency is ending
    // (Brent, 15 Nov 2026).
    rates: [
      { row: 'jj_capital', rate: 0.30, base: 'tm', payItem: 'Commissions J&J Capital' },
      { row: 'boost_ultrafibres', rate: 0.10, base: 'tm', payItem: 'Commissions Boost Ultrafibres' },
      { row: 'matortho', rate: 0.30, base: 'tm', payItem: 'Commissions Mat Ortho' }
    ]
  },
  {
    email: 'toni@technomed.com.au', name: 'Toni Hoppitt', folder: 'Toni Commissions', file: 'Toni Commissions',
    rates: [{ row: 'novus', rate: 0.15, base: 'tm', payItem: 'Commission Novus Surgical' }]
  }
]

/** Plain rules — the shape stored in Redis and edited on the screen. */
export const DEFAULT_RULES = { version: 1, rows: ROWS, people: PEOPLE }
