// ─── A case, as text to paste ─────────────────────────────────────────────────
// "Can we please add in another section within the 'full' view of a case in
// the portal, which acts like a 'summary' that can be copied/pasted elsewhere
// when required? Ideally, it would look similar to how the google calendar
// displays the details of the case in the 'description' field. Obviously it
// would need to stay up-to-date when any of the editable fields are modified."
//  — Toni, 4 Nov 2026, who was copying case details out of Google instead.
//
// One function for both places it is offered — the top of the booking and the
// Copy button on the week — so the two cannot word a case differently. Same
// labels and order as the booking's own description (labelledFields.js), with
// the day written out, because the text goes to people outside the app.

import { formatKitSupplies } from './kitSupply.js'
import { formatListPlace } from './listPlace.js'
import { weekdayName } from './week.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HOSPITALS = { CLV: 'Calvary', RHH: 'RHH' }

/** "Fri 13 Nov 2026", from the app's YYYY-MM-DD. */
export function summaryDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  if (!m) return ''
  return `${weekdayName(date).slice(0, 3)} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

const list = v => [].concat(v || []).map(x => String(x).trim()).filter(Boolean)

/**
 * The case as labelled lines, in order. A field with nothing in it is left
 * out rather than printed empty — "Kit:" with nothing after it reads as a
 * kit nobody has thought about.
 */
export function caseSummaryLines(c = {}) {
  const kit = c.kit || (c.supplies?.length ? formatKitSupplies(c.supplies) : '')
  const place = c.listPlace ? formatListPlace(c.listPlace) : ''
  const lines = [
    ['Patient', c.patient || (c.awaitingName ? 'Name to come' : '')],
    ['Date', summaryDate(c.date)],
    ['Hospital', HOSPITALS[c.hospital] || c.hospital || ''],
    ['Surgeon', c.surgeon || ''],
    ['Procedure', c.procedure || c.operation || ''],
    ['Kit', kit],
    ['List', place],
    ['Brainlab', list(c.navigation).join(' + ')],
    ['Planned reps', list(c.planned).join(', ')],
    ['Attended', list(c.reps || c.rep).join(', ')],
    ['Notes', String(c.notes || '').trim().replace(/\s*\n\s*/g, '; ')],
    ['Status', c.cancelled ? 'Cancelled' : '']
  ]
  return lines.filter(([, value]) => String(value).trim())
}

/** The same, as one block of plain text, one fact per line. */
export function caseSummaryText(c) {
  return caseSummaryLines(c).map(([label, value]) => `${label}: ${value}`).join('\n')
}

/** A subject line for Share: "Sample L4/5 PLIF – Gupta – Calvary Fri 13 Nov". */
export function caseSummaryTitle(c = {}) {
  const who = [c.patient, c.procedure || c.operation].filter(Boolean).join(' ')
  const where = [HOSPITALS[c.hospital] || c.hospital, summaryDate(c.date).replace(/ \d{4}$/, '')].filter(Boolean).join(' ')
  return [who, c.surgeon, where].filter(Boolean).join(' – ')
}

/**
 * Puts text on the clipboard. The async API first; a hidden textarea where it
 * is refused (older iOS, a page not focused). Resolves to whether it worked.
 */
export async function copyText(value) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch { /* fall through to the old way */ }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/**
 * The phone's own share sheet (Mail, WhatsApp, Messages) with the text filled
 * in; a copy where there is no share sheet. Resolves to 'shared', 'copied',
 * 'cancelled' or 'failed'.
 */
export async function shareText(title, value) {
  if (navigator?.share) {
    try {
      await navigator.share({ title, text: value })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
    }
  }
  return (await copyText(value)) ? 'copied' : 'failed'
}
