// ─── Loan stock must be marked LOAN on the usage (Brent, 13 Nov 2026) ────────
// "If a kit is booked as distributor loan in the portal, the portal should
// flag if the rep has forgotten to put loan stamps on the usage sheet, or if
// it says consignment on the usage the portal should flag with the rep that it
// should be marked as loan." The Munro case went to Device marked consignment
// when it came from Device's loan set, which reads as "restock our shelf".
//
// The booking's kit line says which systems are a Distributor Loan
// ("Mariner (Distributor Loan) / Shoreline (Consignment)"). The form reader
// says, per sticker, what is written or stamped against it (`stockMarking`:
// loan | consignment | ''). A line from a loan system that is not marked LOAN
// is flagged; the rep stamps the form and confirms before it can be sent.
// Shared by the review screen and the save. Pure.

import { parseKitSupplies } from './clinicalPlan/kitSupply.js'
import { inventoryFor } from './clinicalPlan/inventory.js'

const textOf = it => [it?.productName, it?.description].filter(Boolean).join(' ')

/** The systems the booking has as a distributor loan, and the rest. */
function bookedSupplies(kit) {
  const entries = parseKitSupplies(kit).filter(e => !e.navigation)
  const loans = []
  const others = []
  for (const e of entries) {
    const inv = inventoryFor(e.system)
    if (!inv) continue
    ;(e.supply === 'Distributor Loan' ? loans : others).push(inv)
  }
  return { loans, others }
}

/** What is stamped or written against a line, as read: 'loan', 'consignment' or ''. */
export function markingOf(item) {
  const m = String(item?.stockMarking || '').toLowerCase()
  if (/loan/.test(m)) return 'loan'
  if (/consign|\bcons\b/.test(m)) return 'consignment'
  return ''
}

/**
 * Lines that came from a distributor's loan set but are not marked LOAN,
 * grouped by system and by what is wrong. Empty when the booking has no
 * distributor loan, or nothing is wrong.
 */
export function loanStampFlags(items = [], kit = '') {
  const { loans, others } = bookedSupplies(kit)
  if (!loans.length) return []
  const groups = new Map()
  for (const item of items) {
    if (!item || item.excluded || item.distributorKey === 'device_boost') continue
    const inv = inventoryFor(textOf(item))
    let loan = inv && loans.includes(inv) ? inv : null
    if (!inv) {
      // A line naming no system: the loan system of its distributor, when the
      // booking has only that one system from them.
      const same = loans.filter(l => l.distributor && l.distributor === item.distributorKey)
      if (same.length === 1 && !others.some(o => o.distributor === item.distributorKey)) loan = same[0]
    }
    if (!loan) continue
    const mark = markingOf(item)
    if (mark === 'loan') continue
    const problem = mark === 'consignment' ? 'consignment' : 'no-stamp'
    const key = `${loan.system}|${problem}`
    if (!groups.has(key)) groups.set(key, { system: loan.system, problem, itemIds: [] })
    groups.get(key).itemIds.push(item.id)
  }
  return [...groups.values()].map(g => ({
    ...g,
    count: g.itemIds.length,
    message: g.problem === 'consignment'
      ? `${g.system} was booked as a distributor loan, but the form says consignment for ${g.itemIds.length === 1 ? '1 item' : `${g.itemIds.length} items`}. Cross it out and mark ${g.itemIds.length === 1 ? 'it' : 'them'} LOAN.`
      : `${g.system} was booked as a distributor loan, but ${g.itemIds.length === 1 ? '1 item has' : `${g.itemIds.length} items have`} no LOAN stamp. Stamp ${g.itemIds.length === 1 ? 'it' : 'them'} LOAN on the form.`
  }))
}
