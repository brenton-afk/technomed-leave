// ─── What a usage line must say before it goes (Brent, 9 Nov 2026) ───────────
// "The portal should have picked up the missing size of the rods before he
// sent it." Cloherty: the rods went to Signus as "Diplomat curved rods · 105"
// with no product code, so Signus could not resupply them from the sheet. A
// distributor resupplies by code — a line without one, or a rod or screw
// without its size, is not finished.
//
// Shared by the scan (api/_usageCase.js, which flags the line for review) and
// by Amend (src/pages/scan/AmendUsage.jsx and api/usage/agent.js, which will
// not send a correction with a gap unless the rep says so).

const textOf = item => [item?.productName, item?.description].filter(Boolean).join(' ')
const isRod = item => /\brods?\b/i.test(textOf(item))
// A set screw or a locking cap is not sized like a pedicle screw.
const isSizedScrew = item => /\bscrews?\b/i.test(textOf(item)) && !/\bset\s*screw|locking\s*(cap|screw\s*plate)|cap\b/i.test(textOf(item))

/** A length in mm written anywhere on the line: "105", "105mm", "5.5 x 105". */
export function lengthOf(item) {
  const all = [item?.size, item?.description, item?.productName].filter(Boolean).join(' ')
  const m = all.match(/(?:x\s*)?(\d{2,3})(?:\s*mm)?\b/gi) || []
  const lengths = m.map(s => Number(s.replace(/[^\d]/g, ''))).filter(n => n >= 20 && n <= 600)
  return lengths.length ? lengths[lengths.length - 1] : null
}

/**
 * Signus Diplomat titanium rods: AB0955-00{length} curved, AB0855-00{length}
 * straight — the codes on every Signus sales report. Only offered, never
 * filled in by itself: the rep taps to use it.
 */
export function suggestedCode(item) {
  if (item?.referenceCode) return ''
  const words = textOf(item)
  if (!isRod(item) || !/diplomat|signus/i.test(`${words} ${item?.distributor || ''} ${item?.distributorKey || ''}`)) return ''
  const length = lengthOf(item)
  if (!length) return ''
  const shape = /curv|lordo|bent/i.test(words) ? 'AB0955' : /straight/i.test(words) ? 'AB0855' : ''
  return shape ? `${shape}-${String(length).padStart(5, '0')}` : ''
}

/** What is missing from a line, in words for the rep. Empty when it is complete. */
export function itemGaps(item) {
  if (!item || item.excluded) return []
  const gaps = []
  if (!String(item.referenceCode || '').trim()) gaps.push('no product code')
  if (isRod(item) && !lengthOf(item)) gaps.push('rod length missing')
  if (isSizedScrew(item) && !String(item.referenceCode || '').trim() && !String(item.size || '').trim()) gaps.push('screw size missing')
  return gaps
}
