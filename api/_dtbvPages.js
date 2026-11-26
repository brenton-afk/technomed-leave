// ─── The DTBV allograft form, split off a usage scan (Brent, 26 Nov 2026) ────
// "With the DTBV allograft tracking form, we want a similar set up to the boost
// emails. We want the staff to be able to scan all items on the usage. We want
// the DTBV allograft form to go to Ben Reynolds, allograft@ and DTBV
// utilisation@ plus technomed admin … automatically … when the scan is done.
// Just to those email addresses please."
//
// The Donor Tissue Bank of Victoria's allograft usage record (the AUR, for CBM
// and DBM grafts supplied through KT Medical) carries the patient's full
// details — DTBV need them for TGA records. So its pages:
//   - never go in the scan attached to any other distributor's usage email;
//   - go, with the DTBV items' usage sheet, in the one DTBV email, to exactly
//     DISTRIBUTORS.dtbv.to and its own cc (admin@) — no clinical team copy;
//   - are filed beside the usage as {folder}_DTBV_Allograft_Form.pdf;
//   - do not add their graft to the usage when another page already carries
//     the same kind of graft's sticker — the same graft listed twice is two
//     restocks.
// Pure; used by api/usage/agent.js. Shaped like api/_boostPages.js.

const DTBVY = /\bcbm\b|\bdbm\b|donor\s*tissue|\bdtbv\b|\bvifm\b|(cortical|cancellous)\s+bone\s+matrix|demineral/i
const BOOSTY = /\bboost\b/i
export const isDtbvItem = item => {
  if (item?.distributorKey) return item.distributorKey === 'dtbv'
  const words = [item?.productName, item?.description, item?.distributor].filter(Boolean).join(' ')
  return DTBVY.test(words) && !BOOSTY.test(words)
}

/** Whether one reading (one page, read alone) says it is the DTBV form. */
const saysDtbv = reading => /dtbv/i.test(String(reading?.pageType || ''))
  || (Array.isArray(reading?.dtbvAllograftPages) && reading.dtbvAllograftPages.map(Number).includes(1))

// A page whose every item is a DTBV graft and that is not the hospital's own
// form, in a scan of several pages — the form, even when the reader did not
// say so (Brent, 26 Nov 2026: the form went to every distributor).
const looksDtbv = (reading, pageCount) => pageCount > 1
  && !/^(usage|boost)/i.test(String(reading?.pageType || ''))
  && Array.isArray(reading?.items) && reading.items.length > 0
  && reading.items.every(isDtbvItem)

/**
 * Page-by-page readings → which pages are the DTBV form, and the readings with
 * a form page's graft left out when another page has a DTBV item.
 */
export function splitDtbvReadings(readings) {
  const dtbvPages = readings.map((r, i) => (saysDtbv(r) || looksDtbv(r, readings.length) ? i : -1)).filter(i => i >= 0)
  if (!dtbvPages.length) return { readings, dtbvPages }
  const elsewhere = readings.some((r, i) => !dtbvPages.includes(i)
    && (Array.isArray(r?.items) ? r.items : []).some(isDtbvItem))
  const kept = readings.map((r, i) => (dtbvPages.includes(i) && elsewhere
    ? { ...r, items: (r?.items || []).filter(it => !isDtbvItem(it)) }
    : r))
  return { readings: kept, dtbvPages }
}

/** One reading of every page at once: its 1-based page numbers → indices. */
export function dtbvPagesFromWhole(extracted, pageCount) {
  const out = new Set()
  for (const n of Array.isArray(extracted?.dtbvAllograftPages) ? extracted.dtbvAllograftPages : []) {
    const i = Number(n) - 1
    if (Number.isInteger(i) && i >= 0 && i < pageCount) out.add(i)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * The pages for everybody, the Boost tracking pages and the DTBV form pages.
 * A page claimed by both forms counts as the DTBV form (the stricter one).
 */
export function splitFormPages(pages, { boostPages = [], dtbvPages = [] } = {}) {
  const dtbv = new Set(dtbvPages)
  const boost = new Set(boostPages.filter(i => !dtbv.has(i)))
  return {
    usagePages: pages.filter((_, i) => !dtbv.has(i) && !boost.has(i)),
    trackingPages: pages.filter((_, i) => boost.has(i)),
    dtbvPages: pages.filter((_, i) => dtbv.has(i))
  }
}

export const DTBV_FORM_FILE = folderName => `${folderName}_DTBV_Allograft_Form.pdf`
