// ─── The order the pages go in ───────────────────────────────────────────────
// Not presentation. The pages are sent to be read in this order and merged
// into one PDF in this order, and a usage form reads as a sequence: the
// patient label and the date are on page one, the overflow stickers on page
// two. A form scanned out of order, with no way to say so, meant scanning the
// whole thing again.
//
// Its own module because the component that uses it cannot be exercised in a
// test — turning a photograph into a page needs createImageBitmap and a canvas,
// and jsdom has neither. The arithmetic of moving an item is the part that can
// actually be wrong, so it lives where it can be checked.

/**
 * A copy of `pages` with one moved `by` places.
 *
 * Returns the original list unchanged for a move that cannot happen — an id
 * that is not there, the first page earlier, the last page later. Unchanged
 * rather than throwing: the arrows are disabled at the ends, so reaching here
 * means something is already out of step, and dropping a page on the floor
 * would be a worse answer than doing nothing.
 */
export function reorder(pages, id, by) {
  const list = Array.isArray(pages) ? pages : []
  const at = list.findIndex(p => p?.id === id)
  const to = at + by
  if (at < 0 || to < 0 || to >= list.length || by === 0) return list

  const next = list.slice()
  next.splice(to, 0, next.splice(at, 1)[0])
  return next
}
