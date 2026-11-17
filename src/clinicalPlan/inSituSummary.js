import { findSystems } from './systems.js'

// ─── What is in situ, in one sentence (Brent, 17 Nov 2026) ───────────────────
// "It just places an In situ? marking on the booking. That's not helpful. We
// need it to hunt through Dropbox to find previous usages, read those usages
// and tell us in one sentence what is in situ. If the usage can't be found in
// Dropbox, it needs to say, no usage in Dropbox. Rep needs to confirm and that
// alert needs to be sent to the team leader that is on shift one week before
// the case."
//
// Pure, shared by the server (api/_inSitu.js) and tests. A match is on the
// surname alone — all the portal keeps — so the sentence says what the earlier
// usage held and the rep confirms it is the same patient.

// What stays in a patient, by the words on a usage line. First match wins.
// Set screws, caps and tulips are part of a screw; grafts and haemostats are
// absorbed — none is "in situ" in the sense the team leader is asking.
const KINDS = [
  ['skip', /\b(set\s*screw|locking\s*cap|cap\b|nut\b|tulip|graft|allograft|boost|ultrafib|dbm|cbm|putty|floseal|surgicel|gelfoam|k-?wire|guide\s*wire|drills?\b|tap\b|needle)/i],
  ['cross link', /\bcross\s*-?\s*(link|connector)|\bcrosslink|\btransverse\s+connector/i],
  ['connector', /\bconnector|\bdomino|\boffset/i],
  ['rod', /\brods?\b/i],
  ['plate', /\bplates?\b/i],
  ['cage', /\bcages?\b|\binterbody|\bspacer|\bpeek\b|\bTLIF\b|\bPLIF\b|\bALIF\b/i],
  ['hook', /\bhooks?\b/i],
  ['disc replacement', /\b(disc|disk)\s+(replacement|prosthesis|arthroplasty)|\bmobi-?c\b|\bprestige\b|\bbaguera\b/i],
  ['screw', /\bscrews?\b/i]
]
const MAKER_ONLY = /^(e4|signus|kt|device|globus|nuvasive)$/i
const HOSPITALS = { CLV: 'Calvary', RHH: 'RHH' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const lineText = it => [it?.productName, it?.description].filter(Boolean).join(' ')

/** What kind of implant a usage line is, or null for one that is not left in. */
export function implantKind(item) {
  const t = lineText(item)
  const hit = KINDS.find(([, re]) => re.test(t))
  if (!hit || hit[0] === 'skip') return null
  return hit[0]
}

/** The systems a usage used, a maker's bare name only when nothing more specific. */
export function systemsOf(items = []) {
  return [...new Set(items.flatMap(i => {
    const found = findSystems(String(i?.productName || ''))
    const specific = found.filter(f => !MAKER_ONLY.test(f.matched))
    return (specific.length ? specific : found).map(f => f.name)
  }))]
}

/** "12 Mar 2025" from YYYY-MM-DD. */
export function shortDay(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : (word.endsWith('s') ? 'es' : 's')}`

/** "Diplomat — 6 screws, 2 rods, 1 cross link". */
export function implantsLine(items = []) {
  const used = items.filter(i => i && !i.excluded)
  const counts = new Map()
  for (const it of used) {
    const kind = implantKind(it)
    if (!kind) continue
    const q = Number(it.quantity) > 0 ? Number(it.quantity) : 1
    counts.set(kind, (counts.get(kind) || 0) + q)
  }
  const order = ['screw', 'rod', 'cross link', 'connector', 'hook', 'plate', 'cage', 'disc replacement']
  const parts = order.filter(k => counts.has(k)).map(k => plural(counts.get(k), k))
  // The systems of what stays in — a graft's maker is not a construct.
  const systems = systemsOf(used.filter(implantKind)).filter(s => !/^(Brainlab|AIRO|Curve)/i.test(s))
  return [systems.join(' + '), parts.join(', ')].filter(Boolean).join(' — ')
}

/**
 * Earlier portal usages under this surname, before the case, newest first.
 * Removed (duplicate) records are left out.
 */
export function priorUsages(records = [], { patient, before }) {
  const surname = String(patient || '').trim().toLowerCase()
  if (!surname) return []
  return records
    .filter(r => r && !r.removed)
    .filter(r => String(r.patientSurname || '').trim().toLowerCase() === surname)
    .filter(r => !before || (r.date && r.date < before))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

/** Where and when, for the end of a sentence: "Thani, Calvary, 12 Mar 2025". */
function whereWhen({ surgeon, hospital, date }) {
  return [surgeon, HOSPITALS[hospital] || hospital, shortDay(date)].filter(Boolean).join(', ')
}

/**
 * The one sentence. `portal` are earlier usage records, `dropbox` earlier case
 * folders read by readFiledCase; `dropboxChecked` whether Dropbox was searched.
 */
export function inSituAnswer({ portal = [], dropbox = [], dropboxChecked = false }) {
  if (portal.length) {
    const last = portal[0]
    const what = implantsLine(last.items || []) || 'items not readable from the usage'
    const more = portal.length + dropbox.length - 1
    return {
      status: 'found',
      sentence: `Last usage (${whereWhen({ surgeon: last.surgeonSurname, hospital: last.hospital, date: last.date })}): ${what}.`
        + (more > 0 ? ` ${plural(more, 'other earlier usage')} under this surname.` : ''),
      source: { from: 'portal', id: last.id, folderName: last.folderName, date: last.date }
    }
  }
  if (dropbox.length) {
    const last = dropbox[0]
    const what = (last.systems || []).join(' + ')
    const more = dropbox.length - 1
    return {
      status: 'found',
      sentence: `Last usage in Dropbox (${whereWhen(last)})${what ? `: ${what}` : ''} — from the folder name; open it to check the detail.`
        + (more > 0 ? ` ${plural(more, 'other earlier usage')} under this surname.` : ''),
      source: { from: 'dropbox', filedAs: last.filedAs, date: last.date }
    }
  }
  return dropboxChecked
    ? { status: 'none', sentence: 'No usage in Dropbox.' }
    : { status: 'not-checked', sentence: 'No usage in the portal. Dropbox not searched yet — the usage folders are locked until the redaction is finished.' }
}

/** What the rep's confirmation reads as. */
export const CONFIRM_ANSWERS = {
  same: 'Same patient — confirmed',
  'not-this-patient': 'Not this patient',
  'none-confirmed': 'Checked — nothing found'
}
