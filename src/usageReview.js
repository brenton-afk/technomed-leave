// ─── Sorting the extracted rows for the review screen ────────────────────────
// Four lists out of one, and the distinctions are load-bearing enough to be
// worth testing on their own rather than living inside a render.
//
// `manualReview` is the only flag with consequences: the server holds those rows
// back from every distributor email. `resolved` is presentation — it remembers
// that a row *was* flagged, so ticking it off does not make it jump to a
// different section of the page.
//
// That jump was the bug. Resolving cleared the flag, the row left "Needs review"
// for "Extracted items" further down, and the next flagged row slid up into the
// gap. Almost nothing changed on screen, so the tap read as not having landed and
// the new row read as the old one — with the count above it never moving either.

export function partitionItems(items = []) {
  // Ever-flagged rows, in their original order, resolved or not.
  const inReview = items.filter(it => (it.manualReview || it.resolved) && !it.excluded)

  return {
    inReview,
    // What is left to do. This is the number on screen.
    outstanding: inReview.filter(it => it.manualReview),
    // Rows that were never flagged at all.
    clean: items.filter(it => !it.manualReview && !it.resolved && !it.excluded),
    excluded: items.filter(it => it.excluded),
    // What will be emailed. A resolved row belongs here — that is the entire
    // point of resolving it — so this cannot be the same list as `clean`.
    sendable: items.filter(it => !it.manualReview && !it.excluded)
  }
}
