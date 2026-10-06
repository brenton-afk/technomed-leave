// ─── The text message that goes to the registrar ─────────────────────────────
// "When a usage is sent, a text message is generated with the usage to be able
// to forward to the registrars — or at least a draft generated that can then
// be sent."
//
// A draft, deliberately, and never a send. The app does not know which
// registrar was in the room, their number is not on the booking, and a usage
// text going to the wrong phone is a patient's surgery described to a stranger.
// So this writes the message and hands it to the phone's own messaging app,
// where somebody picks the person and reads it before it goes.
//
// ── What is in it ──
//
// The surname, the surgeon, the date, the hospital, and what went in. No first
// name, no UR number — the same rule as everywhere else in this app, and more
// obviously right here than anywhere: a text message is forwarded, screenshot
// and left open on benches.

/** 2026-10-06 → 6 Oct 2026. */
function readableDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
}

/** One implant, as somebody would read it out. */
function line(item) {
  const bits = [
    item.quantity && !/^x?1$/i.test(String(item.quantity).trim())
      ? String(item.quantity).trim().replace(/^x?/i, 'x') : null,
    item.productName || item.description,
    item.size,
    item.referenceCode ? `(${item.referenceCode})` : null
  ].filter(Boolean)
  return bits.join(' ')
}

/**
 * The message, as plain text.
 *
 * Grouped under the distributor, because that is how a registrar reads it and
 * how a query comes back — "whose cage was that" is the question this answers
 * before it is asked.
 *
 * Items held back for review are left out. They have not been checked, and a
 * text message is exactly the wrong place for a half-read sticker: it is the
 * copy that gets forwarded and quoted long after the sheet has been corrected.
 */
export function usageMessage(record, items = []) {
  if (!record) return ''

  const used = items.filter(i => i && !i.excluded && !i.manualReview)
  const header = [
    record.patientSurname,
    record.surgeonSurname || record.surgeonName,
    readableDate(record.date),
    record.hospital
  ].filter(Boolean).join(' · ')

  const byDistributor = new Map()
  for (const item of used) {
    const who = item.distributor || 'Other'
    if (!byDistributor.has(who)) byDistributor.set(who, [])
    byDistributor.get(who).push(line(item))
  }

  const body = [...byDistributor.entries()]
    .map(([who, lines]) => `${who}:\n${lines.map(l => `· ${l}`).join('\n')}`)
    .join('\n\n')

  const held = items.filter(i => i && !i.excluded && i.manualReview).length
  const footer = held
    ? `\n\n(${held} item${held === 1 ? '' : 's'} still being checked — not listed.)`
    : ''

  const parts = [
    record.procedure ? `${header}\n${record.procedure}` : header,
    body || 'No implants recorded.'
  ]
  return `${parts.join('\n\n')}${footer}`
}

/**
 * The same message as an sms: link, for handing to the phone.
 *
 * No number in it. The phone opens its own messaging app with the body filled
 * in and the recipient empty, so choosing who it goes to is a deliberate act
 * by somebody who knows which registrar was in the room.
 *
 * `?&body=` rather than `?body=`: iOS wants the ampersand after the question
 * mark when there is no recipient, and Android tolerates it. Without it, iOS
 * silently opens an empty message and the draft is gone.
 */
export function smsLink(text) {
  return `sms:?&body=${encodeURIComponent(String(text || ''))}`
}
