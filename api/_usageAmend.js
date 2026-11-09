// ─── Amending a usage that has already gone ──────────────────────────────────
// Aimee, 4 Nov 2026: "I had forgotten to add the crosslink to my usage … how
// we could make an amendment or update post sending? As it doesn't physically
// come out of my email so I can't reply or add a note." Brent: "Will build a
// backtrack edit function."
//
// The rep edits the items; the portal works out, per distributor, what was
// added, removed or changed, and sends a correction to those distributors only
// — "CORRECTION – replaces usage sent 4 Nov", saying exactly what changed,
// with the corrected sheet. The original stays on the record and in Dropbox.

import { DISTRIBUTORS } from './_distributors.js'
import { itemGaps, suggestedCode } from '../src/usageItemCheck.js'

/** The fields a rep may change on an item that was already sent. */
const EDITABLE = ['productName', 'description', 'size', 'quantity', 'referenceCode', 'lotNumber', 'excluded']

/**
 * The items after the rep's edits. Known items keep everything the scan read
 * and take only the editable fields; new ones go through the same
 * normalisation a scanned item does (`normalise`), so their distributor is
 * worked out the same way, unless the rep chose one from the list.
 */
export function amendItems(before = [], incoming = [], normalise) {
  const known = new Map(before.map(i => [i.id, i]))
  return incoming.map((raw, index) => {
    const was = raw?.id && known.get(raw.id)
    if (was) {
      const next = { ...was }
      for (const key of EDITABLE) if (key in raw) next[key] = raw[key]
      return next
    }
    const item = normalise(raw || {}, index)
    const chosen = raw?.distributorKey && DISTRIBUTORS[raw.distributorKey] ? raw.distributorKey : null
    return {
      ...item,
      id: `amend-${Date.now().toString(36)}-${index}`,
      distributorKey: chosen || item.distributorKey,
      // Typed by the rep, who is the person who would otherwise review it.
      manualReview: false,
      added: true
    }
  })
}

const counted = i => i && !i.excluded && !i.manualReview && i.distributorKey
const describe = i => [
  i.quantity && Number(i.quantity) !== 1 ? `${i.quantity} ×` : '1 ×',
  i.productName || i.description, i.size
].filter(Boolean).join(' ')
const sameItem = (a, b) => ['productName', 'description', 'size', 'quantity', 'referenceCode', 'lotNumber']
  .every(k => String(a[k] ?? '') === String(b[k] ?? ''))

/**
 * Per distributor, what changed: lines of plain words, no patient detail.
 * Only distributors with a change are returned — the others are not told.
 */
export function changesByDistributor(before = [], after = []) {
  const was = new Map(before.filter(counted).map(i => [i.id, i]))
  const now = new Map(after.filter(counted).map(i => [i.id, i]))
  const out = new Map()
  const note = (key, line) => {
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(line)
  }
  for (const [id, item] of now) {
    const old = was.get(id)
    if (!old) note(item.distributorKey, `Added: ${describe(item)}`)
    else if (old.distributorKey !== item.distributorKey) {
      note(old.distributorKey, `Removed: ${describe(old)}`)
      note(item.distributorKey, `Added: ${describe(item)}`)
    } else if (!sameItem(old, item)) note(item.distributorKey, `Changed: ${describe(old)} → ${describe(item)}`)
  }
  for (const [id, item] of was) if (!now.has(id)) note(item.distributorKey, `Removed: ${describe(item)}`)
  return [...out].map(([key, lines]) => ({ key, name: DISTRIBUTORS[key]?.name || key, lines }))
}

/**
 * Lines added or changed in this amendment that a distributor could not
 * resupply from (src/usageItemCheck.js). Lines the amendment did not touch are
 * not held against it — they went in the original usage.
 */
export function amendGaps(before = [], after = []) {
  const was = new Map(before.map(i => [i.id, i]))
  return after
    .filter(i => i && !i.excluded && i.distributorKey)
    .filter(i => { const old = was.get(i.id); return !old || !sameItem(old, i) })
    .map(i => ({ id: i.id, name: [i.productName || i.description, i.size].filter(Boolean).join(' '), gaps: itemGaps(i), suggestion: suggestedCode(i) }))
    .filter(g => g.gaps.length)
}
