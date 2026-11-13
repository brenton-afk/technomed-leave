// ─── The Boost tracking form, split off a usage scan (Brent, 13 Nov 2026) ────
// "The allograft form for Boost should only be automatically emailed to the
// Boost tracking email and our admin email (it's for tracking only) — it should
// not go to the other Device accounts. The chargeable item form with the Boost
// sticker is then split between the usual distributors and goes to ortho@
// Device etc for restocking purposes."
//
// A rep photographs both forms in one scan. Each page is read on its own and
// says whether it is Device's Boost allograft / patient tracking form. Those
// pages:
//   - never go in the scan attached to any distributor's usage email, so
//     Device's restocking desk sees only the chargeable items form;
//   - go automatically, when the usage is sent, to boost@ (cc admin@) alone,
//     marked tracking only (BOOST_TRACKING in _distributors.js);
//   - do not add their graft to the usage when the chargeable form already
//     carries a Boost sticker — the same graft listed twice is two restocks.
// Pure; used by api/usage/agent.js.

const BOOSTY = /\bboost\b/i
const isBoostItem = item => BOOSTY.test([item?.productName, item?.description, item?.distributor].filter(Boolean).join(' '))

/** Page numbers (1-based, as the reader gives them) → valid 0-based indices. */
export function cleanBoostPages(value, pageCount) {
  if (!Array.isArray(value)) return []
  const out = new Set()
  for (const v of value) {
    const n = Number(v)
    if (Number.isInteger(n) && n >= 0 && n < pageCount) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

/** Whether one reading (one page, read alone) says it is the tracking form. */
const saysTracking = reading => Array.isArray(reading?.boostTrackingPages) && reading.boostTrackingPages.map(Number).includes(1)

/**
 * Page-by-page readings → which pages are the tracking form, and the readings
 * with a tracking page's graft left out when another page has a Boost item.
 */
export function splitBoostReadings(readings) {
  const boostPages = readings.map((r, i) => (saysTracking(r) ? i : -1)).filter(i => i >= 0)
  if (!boostPages.length) return { readings, boostPages }
  const boostElsewhere = readings.some((r, i) => !boostPages.includes(i)
    && (Array.isArray(r?.items) ? r.items : []).some(isBoostItem))
  const kept = readings.map((r, i) => (boostPages.includes(i) && boostElsewhere
    ? { ...r, items: (r?.items || []).filter(it => !isBoostItem(it)) }
    : r))
  return { readings: kept, boostPages }
}

/** One reading of every page at once: its 1-based page numbers → indices. */
export function boostPagesFromWhole(extracted, pageCount) {
  return cleanBoostPages((extracted?.boostTrackingPages || []).map(n => Number(n) - 1), pageCount)
}

/** The pages for the distributors and the pages for the Boost team. */
export function splitPages(pages, boostPages = []) {
  const set = new Set(boostPages)
  return {
    usagePages: pages.filter((_, i) => !set.has(i)),
    trackingPages: pages.filter((_, i) => set.has(i))
  }
}
