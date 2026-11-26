// ─── A usage line against the distributor's price list (Brent, 18 Nov 2026) ──
// "… to cross check when usages are sent." Each scanned line's product code is
// looked up in the price lists the portal keeps (api/_priceStore.js):
//
//   listed            on its distributor's list — the rebate code and range come
//                     from the list (the rebate code fills a blank one);
//   other-distributor on another distributor's list only — the line is
//                     probably going to the wrong company, so it goes to review;
//   not-listed        on no list — likely a misread code; said, with the
//                     nearest code on that distributor's list if one is a
//                     single character away. Not stopped: lists are not
//                     complete (Boost, some KT ranges).
//   no-list           the distributor has no list in the portal — nothing said.
//
// Never a price: this is shown to reps. Pure, so the server and tests share it.

export const DISTRIBUTOR_LISTS = {
  signus: ['signus'],
  e4: ['e4'],
  globus: ['globus'],
  device: ['device'],
  kt: ['kt-private', 'kt-rhh'],
  dtbv: ['kt-private']
}
const LABELS = {
  signus: 'Signus', e4: 'E4 Surgical', globus: 'Globus Medical', device: 'Device Technologies', kt: 'KT Medical', dtbv: 'KT Medical'
}

export const codeKey = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Code → every list line carrying it. */
export function indexPriceBook(book) {
  const index = new Map()
  for (const [list, rows] of Object.entries(book?.lists || {})) {
    for (const r of rows || []) {
      const k = codeKey(r.code)
      if (!k) continue
      if (!index.has(k)) index.set(k, [])
      index.get(k).push({ list, row: r })
    }
  }
  return index
}

const distributorOfList = list => Object.keys(DISTRIBUTOR_LISTS).find(d => d !== 'dtbv' && DISTRIBUTOR_LISTS[d].includes(list))

/** One character changed, added or dropped. */
function oneApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

// ─── A misread code is put right from the list (Brent, 27 Nov 2026) ─────────
// "We can't have the portal having incorrect codes … I don't want the staff to
// have to override the incorrect codes. The codes should just be right." Ben's
// Rowley usage: the rod sticker read AB0805-00-150 — the list has AB0855-00150
// — so the resupply of AB0855-00150 matched nothing. A code not on its
// distributor's list is replaced by the one list code it can only have been:
//   - the same letters and digits in another layout (hyphens, spaces);
//   - one character changed, added or dropped;
//   - the read code is the start of it (a suffix like "R/R" missed);
// and only when exactly one list code fits — two candidates, nothing changes
// and the line says "check the code" as before. A listed code is written as
// the list writes it. The code as read is kept on the line (`codeAsRead`).
export function listedCodeFor(code, dist, book, index = indexPriceBook(book), { hospital = '' } = {}) {
  const k = codeKey(code)
  if (!k || !book) return null
  const d = dist === 'device_boost' ? 'device' : dist
  const lists = (DISTRIBUTOR_LISTS[d] || []).filter(l => (book.lists?.[l] || []).length)
  if (!lists.length) return null
  const rank = l => ((hospital === 'RHH') === (l === 'kt-rhh') ? 0 : 1)
  const exact = (index.get(k) || []).filter(h => lists.includes(h.list)).sort((a, b) => rank(a.list) - rank(b.list))
  if (exact.length) return { code: exact[0].row.code, how: 'exact' }
  const found = new Map()
  for (const l of lists) {
    for (const r of book.lists[l]) {
      const rk = codeKey(r.code)
      if (!rk) continue
      if (oneApart(k, rk) || (k.length >= 6 && rk.startsWith(k) && rk.length - k.length <= 3)) found.set(rk, r.code)
    }
  }
  if (found.size !== 1) return null
  return { code: [...found.values()][0], how: 'corrected' }
}

/**
 * The check for one usage line.
 * @param item  { referenceCode, distributorKey }
 * @param book  { lists } from loadPriceBook
 * @param index from indexPriceBook(book)
 * @param hospital 'RHH' | 'CLV' — KT prices differ, so its RHH list is preferred at the RHH
 */
export function priceCheckItem(item, book, index, { hospital = '' } = {}) {
  const code = String(item?.referenceCode || '').trim()
  const k = codeKey(code)
  const dist = item?.distributorKey && item.distributorKey !== 'null' ? (item.distributorKey === 'device_boost' ? 'device' : item.distributorKey) : ''
  if (!k) return { status: 'no-code' }
  const lists = DISTRIBUTOR_LISTS[dist] || []
  const held = lists.filter(l => (book?.lists?.[l] || []).length)
  const hits = index.get(k) || []
  // KT: the RHH list at the RHH, the private list everywhere else.
  const rank = h => ((hospital === 'RHH') === (h.list === 'kt-rhh') ? 0 : 1)
  const ours = hits.filter(h => lists.includes(h.list)).sort((a, b) => rank(a) - rank(b))
  if (ours.length) {
    const r = ours[0].row
    return { status: 'listed', code, list: ours[0].list, rebate: r.rebate && !/no rebate/i.test(r.rebate) ? r.rebate : '', range: r.range, description: r.description }
  }
  if (hits.length) {
    const other = distributorOfList(hits[0].list)
    if (other && other !== dist) return { status: 'other-distributor', code, distributorKey: other, distributor: LABELS[other], range: hits[0].row.range }
  }
  if (!held.length) return { status: 'no-list', code }
  let near = ''
  for (const l of held) {
    for (const r of book.lists[l]) {
      if (oneApart(k, codeKey(r.code))) { near = r.code; break }
    }
    if (near) break
  }
  return { status: 'not-listed', code, distributor: LABELS[dist] || '', ...(near ? { near } : {}) }
}

/** Every line of a case, checked; the rebate code filled from the list where blank. */
export function priceCheckCase(items = [], book, { hospital = '' } = {}) {
  if (!book) return items
  const index = indexPriceBook(book)
  return items.map(it0 => {
    if (it0.excluded) return it0
    const it = withListedCode(it0, book, index, { hospital })
    const check = priceCheckItem(it, book, index, { hospital })
    if (it.codeAsRead && check.status === 'listed') check.correctedFrom = it.codeAsRead
    const next = { ...it, priceCheck: check }
    if (check.status === 'listed' && check.rebate && !String(it.rebateCode || '').trim()) next.rebateCode = check.rebate
    if (check.status === 'other-distributor') {
      const why = `code is on ${check.distributor}'s price list`
      next.manualReview = true
      next.resolved = false
      next.reviewReasons = [...new Set([...(it.reviewReasons || []), why])]
    }
    return next
  })
}

/** The line with its code as the list writes it, or put right from the list. */
export function withListedCode(it, book, index = indexPriceBook(book), { hospital = '' } = {}) {
  const fix = listedCodeFor(it?.referenceCode, it?.distributorKey, book, index, { hospital })
  if (!fix || fix.code === it.referenceCode) return it
  if (fix.how === 'exact') return { ...it, referenceCode: fix.code }
  return { ...it, referenceCode: fix.code, codeAsRead: it.codeAsRead || it.referenceCode }
}

/** A saved case's items with their codes as the list has them — for matching. */
export function withListedCodes(record, book, { hospital = '' } = {}) {
  if (!book || !record) return record
  const index = indexPriceBook(book)
  return { ...record, items: (record.items || []).map(it => (it.excluded ? it : withListedCode(it, book, index, { hospital: hospital || record.hospital }))) }
}

/** The one line the review shows under an item, while its code is the one checked. */
export function priceCheckLine(item) {
  const c = item?.priceCheck
  if (!c || codeKey(c.code) !== codeKey(item.referenceCode)) return null
  if (c.status === 'listed' && c.correctedFrom) return { tone: 'ok', text: `Code put right from the price list (read as ${c.correctedFrom})${c.range ? ` · ${c.range}` : ''}${c.rebate ? ` · ${c.rebate}` : ''}` }
  if (c.status === 'listed') return { tone: 'ok', text: `On the price list${c.range ? ` · ${c.range}` : ''}${c.rebate ? ` · ${c.rebate}` : ''}` }
  if (c.status === 'other-distributor') return { tone: 'warn', text: `This code is on ${c.distributor}'s price list, not this distributor's.`, move: c.distributorKey, moveLabel: `Send to ${c.distributor}` }
  if (c.status === 'not-listed') return { tone: 'warn', text: `Not on ${c.distributor || 'the distributor'}'s price list — check the code.`, near: c.near }
  return null
}

// ─── A resupply paper against the price lists (Brent, 19 Nov 2026) ───────────
// "The resupply scanner must use the list also." Every line of a docket or
// packing slip is checked the same way as a usage line. Two things more:
//   - a paper whose distributor was not recognised takes the one most of its
//     codes are listed under (`infer`, only on the first read — a person who
//     cleared the choice is not overruled);
//   - when most checked lines sit on one other distributor's list, the paper
//     is probably from them: `listSuggests` says so for the screen to offer.
// Advisory, never a stop, and never a price.

export function priceCheckResupply(resupply, book, { hospital = '', infer = false, nameOf = k => LABELS[k] || k } = {}) {
  if (!book || !resupply) return resupply
  const index = indexPriceBook(book)
  let { distributorKey } = resupply
  let distributor = resupply.distributor
  const tally = keys => {
    const n = {}
    for (const k of keys) if (k) n[k] = (n[k] || 0) + 1
    const [best, count] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] || []
    return best && count * 2 > keys.length ? best : ''
  }
  if (infer && !distributorKey) {
    const owners = resupply.lines.map(l => {
      const hits = index.get(codeKey(l.referenceCode)) || []
      const owners = [...new Set(hits.map(h => distributorOfList(h.list)).filter(Boolean))]
      return owners.length === 1 ? owners[0] : ''
    }).filter(Boolean)
    const found = tally(owners)
    if (found) { distributorKey = found; distributor = nameOf(found) }
  }
  const lines = resupply.lines.map(l0 => {
    const l = withListedCode({ ...l0, distributorKey }, book, index, { hospital })
    const { distributorKey: _d, ...line } = l
    const check = priceCheckItem({ referenceCode: line.referenceCode, distributorKey }, book, index, { hospital })
    if (line.codeAsRead && check.status === 'listed') check.correctedFrom = line.codeAsRead
    return { ...line, priceCheck: check }
  })
  const checked = lines.filter(l => ['listed', 'other-distributor', 'not-listed'].includes(l.priceCheck.status))
  const elsewhere = tally(checked.map(l => (l.priceCheck.status === 'other-distributor' ? l.priceCheck.distributorKey : '')))
  return {
    ...resupply,
    distributorKey,
    distributor,
    ...(distributorKey !== resupply.distributorKey ? { distributorFromList: true } : {}),
    lines,
    listSuggests: elsewhere && checked.length ? { distributorKey: elsewhere, distributor: nameOf(elsewhere) } : null
  }
}
