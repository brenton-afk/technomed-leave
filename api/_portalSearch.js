// ─── Search the whole portal (Brent, 6 Nov 2026) ─────────────────────────────
// "Ditch the ask-the-portal button and make the search hourglass at the top
// super powerful so it can search literally anything in the portal."
//
// The calendar half (cases and tasks) stays in action=search. This is the
// rest: what the portal itself holds — usage scans (case, product, code, lot or
// graft number), resupplies, kits and where they are, every tray list line,
// surgeon preference cards, and the bookings Inbox. Pure: the route gathers the
// data, this matches it, so the rules can be tested without Redis.
//
// Every word typed must appear somewhere in the thing found ("diplomat calvary"
// finds the Diplomat kit at Calvary, not every Diplomat and everything at
// Calvary). Nothing here returns more than a surname of a patient, which is all
// the records hold.

const PER_GROUP = 8

const norm = v => String(v ?? '').toLowerCase().replace(/\*\*/g, '')

/** The words of a query, each at least one character. */
export function queryWords(q) {
  return norm(q).split(/[\s,]+/).map(w => w.trim()).filter(Boolean)
}

/** True when every word of the query is somewhere in the haystack. */
export function matchesAll(words, ...fields) {
  const hay = fields.map(norm).join(' \u0001 ')
  return words.length > 0 && words.every(w => hay.includes(w))
}

/** A code or lot compared on letters and digits only: "AB-0321 12" finds "AB032112". */
const squash = v => norm(v).replace(/[^a-z0-9]/g, '')
function codeHit(words, value) {
  const s = squash(value)
  const q = squash(words.join(''))
  return q.length >= 4 && s.includes(q)
}

const placeName = { office: 'TM office', CLV: 'Calvary', RHH: 'RHH' }

function usageResults(words, usage = []) {
  const out = []
  for (const r of usage) {
    if (!r || r.removed) continue
    const items = r.items || []
    const caseHit = matchesAll(words, r.folderName, r.patientSurname, r.surgeonSurname, r.hospital, r.procedure, r.repName)
    const itemHit = items.find(i => matchesAll(words,
      i.productName, i.description, i.referenceCode, i.lotNumber, i.size, i.distributorKey)
      || codeHit(words, i.referenceCode) || codeHit(words, i.lotNumber))
    if (!caseHit && !itemHit) continue
    out.push({
      type: 'usage', id: r.id, date: r.date || String(r.createdAt || '').slice(0, 10),
      title: r.folderName || [r.patientSurname, r.surgeonSurname].filter(Boolean).join(' / '),
      detail: itemHit
        ? [itemHit.productName || itemHit.description, itemHit.referenceCode && `Code ${itemHit.referenceCode}`,
          itemHit.lotNumber && `Lot ${itemHit.lotNumber}`].filter(Boolean).join(' · ')
        : `${items.length} item${items.length === 1 ? '' : 's'}${r.repName ? ` · ${r.repName}` : ''}`
    })
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

function resupplyResults(words, resupplies = []) {
  const out = []
  for (const e of resupplies) {
    if (!e) continue
    const line = (e.lines || []).find(l => matchesAll(words, l.referenceCode, l.description, l.lotNumber)
      || codeHit(words, l.referenceCode) || codeHit(words, l.lotNumber))
    if (!line && !matchesAll(words, e.distributor, e.documentNumber, e.filed)) continue
    out.push({
      type: 'resupply', id: e.id, usageId: e.usageId || null, date: e.documentDate || String(e.at || '').slice(0, 10),
      title: [e.distributor, e.documentNumber && `#${e.documentNumber}`].filter(Boolean).join(' '),
      detail: line
        ? [line.description, line.referenceCode && `Code ${line.referenceCode}`, line.lotNumber && `Lot ${line.lotNumber}`].filter(Boolean).join(' · ')
        : e.filed || 'Resupply'
    })
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

function kitResults(words, kits = [], trayLists = {}) {
  const kitsFound = []
  const lines = []
  for (const k of kits) {
    const at = placeName[k.at] || k.at || ''
    const home = placeName[k.home] || k.home || ''
    if (matchesAll(words, k.name, k.system, k.distributor, at, home, k.kind, ...(k.trays || []))) {
      kitsFound.push({
        type: 'kit', id: k.id, title: k.name,
        detail: [at && `At ${at}`, k.away ? `(home ${home})` : '', k.kind].filter(Boolean).join(' · ')
      })
    }
    const list = trayLists[k.id]
    for (const tray of list?.trays || []) {
      for (const l of tray.lines || []) {
        // Every word somewhere in the line, its tray or its kit — and at least
        // one in the line itself, so "diplomat" alone is the kit, not its 300
        // lines, while "diplomat 45mm" finds the 45mm lines of Diplomat.
        const own = norm(`${l.code} ${l.description}`)
        if ((matchesAll(words, l.code, l.description, k.name, k.system, tray.name) && words.some(w => own.includes(w)))
          || codeHit(words, l.code)) {
          lines.push({
            type: 'trayline', id: `${k.id}:${tray.name}:${l.code || l.description}`, kitId: k.id,
            title: l.description || l.code,
            detail: [l.code && `Code ${l.code}`, `${k.name} · ${tray.name}`, l.qty != null && `Qty ${l.qty}`].filter(Boolean).join(' · ')
          })
        }
      }
    }
  }
  return { kitsFound, lines }
}

function preferenceResults(words, prefs) {
  const out = []
  for (const s of prefs?.surgeons || []) {
    for (const card of s.systems || []) {
      const lines = (card.items || []).map(norm)
      const alert = [card.alert?.title, card.alert?.text]
      if (!matchesAll(words, s.name, card.name, card.subtitle, card.tag, ...lines, ...alert)) continue
      const hit = (card.items || []).find(i => words.some(w => norm(i).includes(w)))
      out.push({
        type: 'pref', id: `${s.id}:${card.name}`, title: `${s.name} · ${card.name}`,
        detail: hit ? String(hit).replace(/\*\*/g, '') : (card.subtitle || 'Preference card')
      })
    }
  }
  return out
}

function inboxResults(words, queue = []) {
  return queue
    .filter(c => c && c.status === 'pending')
    .filter(c => matchesAll(words, c.patient, c.surgeon, c.procedure, c.kit, c.hospital, c.subject))
    .map(c => ({
      type: 'inbox', id: c.id, date: c.date || '',
      title: [c.patient || 'Name to come', c.surgeon].filter(Boolean).join(' / '),
      detail: ['Waiting in the Inbox', c.procedure, c.hospital].filter(Boolean).join(' · ')
    }))
}

/**
 * Everything the portal holds that matches, in groups, each capped. Order of
 * groups is the order they are shown in.
 */
export function searchPortal(q, sources = {}) {
  const words = queryWords(q)
  if (!words.length || words.join('').length < 2) return []
  const { kitsFound, lines } = kitResults(words, sources.kits, sources.trayLists)
  const groups = [
    { key: 'inbox', label: 'Inbox — waiting to be booked', items: inboxResults(words, sources.inbox) },
    { key: 'usage', label: 'Usage scans', items: usageResults(words, sources.usage) },
    { key: 'resupply', label: 'Resupplies', items: resupplyResults(words, sources.resupplies) },
    { key: 'kit', label: 'Kits', items: kitsFound },
    { key: 'trayline', label: 'Tray lists', items: lines },
    { key: 'pref', label: 'Preference cards', items: preferenceResults(words, sources.prefs) }
  ]
  return groups
    .filter(g => g.items.length)
    .map(g => ({ ...g, more: g.items.length > PER_GROUP, items: g.items.slice(0, PER_GROUP) }))
}
