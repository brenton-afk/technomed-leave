// ─── Rebate codes under each system in Resources (Brent, 21 Nov 2026) ───────
// "When I uploaded all the rebate codes and prices the other day, can you pull
// those out and add them to the resources under each system." The lines are
// Toni's price list workbook as the portal already keeps it (api/_priceStore.js);
// here each line is given to the system it belongs to, by the workbook's own
// Product range column (Diplomat, Mariner MIS, RELINE Open …). Pure.
//
// Prices stay admins only, as the price store has always been: everyone
// signed in sees the product code, description and rebate (PL) code; an admin
// also sees the price. Nothing here goes in an email.

import { LISTS } from './_priceStore.js'

const r = s => String(s || '').toLowerCase()
// System → which lines are its own, by the line's range (and, for Global BMD,
// which holds both the PLIF and the Catenary ALIF, its description).
export const RANGE_RULES = [
  ['Diplomat', l => /^diplomat/.test(r(l.range))],
  ['Ascot', l => /^ascot/.test(r(l.range))],
  ['Athlet', l => /^athlet/.test(r(l.range))],
  ['MOBIS', l => /^mobis/.test(r(l.range))],
  ['CYLOX', l => /^cylox/.test(r(l.range))],
  ['Catenary ALIF', l => /^global bmd|catenary/.test(r(l.range)) && /\balif\b|catenary/.test(r(`${l.description} ${l.type} ${l.range}`))],
  ['Global BMD PLIF', l => /^global bmd/.test(r(l.range)) && !/\balif\b|catenary/.test(r(`${l.description} ${l.type}`))],
  ['Dakota', l => /^dakota/.test(r(l.range))],
  ['Reform Cervical', l => /^reform/.test(r(l.range))],
  ['Lonestar', l => /^lonestar/.test(r(l.range))],
  ['Orthofix Firebird', l => /^firebird/.test(r(l.range))],
  ['Forza XP', l => /^forza/.test(r(l.range))],
  ['Mariner Outrigger', l => /^mariner outrigger/.test(r(l.range))],
  ['Mariner', l => /^mariner(?! outrigger)/.test(r(l.range))],
  ['Shoreline', l => /^shoreline/.test(r(l.range))],
  ['Northstar', l => /^northstar/.test(r(l.range))],
  ['REline', l => /^reline/.test(r(l.range))],
  ['Nuvasive', l => /^x-?core/.test(r(l.range))],
  ['Globus', l => /^(fortify|acp)\b/.test(r(l.range))]
]
const ruleFor = system => (RANGE_RULES.find(([s]) => s.toLowerCase() === r(system)) || [])[1]

/**
 * One system's lines, list by list (KT has a private-hospital and an RHH list).
 * `withPrices` adds each line's price; leave it off for anyone not an admin.
 */
export function codesForSystem(book, system, { withPrices = false } = {}) {
  const rule = ruleFor(system)
  if (!book || !rule) return { lists: [], readAt: book?.meta?.readAt || '', file: book?.meta?.file || '' }
  const lists = []
  for (const l of LISTS) {
    const lines = (book.lists[l.key] || []).filter(rule).map(x => ({
      code: x.code, description: x.description, range: x.range, type: x.type, rebate: x.rebate,
      ...(withPrices ? { price: x.price, setting: x.setting } : {})
    }))
    if (lines.length) lists.push({ key: l.key, label: l.label, ...(l.hospital ? { hospital: l.hospital } : {}), lines })
  }
  return { lists, readAt: book.meta?.readAt || '', file: book.meta?.file || '' }
}

/** How many lines each system has (the most of any one list), for the cards. */
export function codeCounts(book, systems = []) {
  const out = {}
  for (const system of systems) {
    const rule = ruleFor(system)
    if (!book || !rule) continue
    const n = Math.max(0, ...LISTS.map(l => (book.lists[l.key] || []).filter(rule).length))
    if (n) out[system] = n
  }
  return out
}
