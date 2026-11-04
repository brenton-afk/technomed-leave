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


// ─── The registrar text, simplified (Brent, 4 Nov 2026) ──────────────────────
// "The text to the registrar at the end of the case needs to be really basic.
// At the moment it includes lot numbers, reference codes etc." Now:
//
//   Patient: Rowley
//   Consultant: Mr Fowler
//   System: Signus Diplomat
//   T12 Left: 6.5 x 45mm
//   …one line per side per level, from the booking…
//   Rods: 150mm straight Ti
//   Cross connector: Yes
//   Bone graft: Boost DBM Allograft (Australian Biotechnologies)
//   Cages: 10 x 26mm
//
// No codes, no lot numbers, no date or hospital. The levels come from the
// booking's procedure ("T12-L2 fixation" → T12, L1, L2); the rep fills in each
// screw, and a level left blank is left out of the text.

const SPINE = [
  ...Array.from({ length: 7 }, (_, i) => `C${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `T${i + 1}`),
  ...Array.from({ length: 5 }, (_, i) => `L${i + 1}`),
  'S1'
]

/** The vertebral levels a procedure spans, in order: "L4/5" → L4, L5. */
export function levelsFrom(procedure) {
  const text = String(procedure || '')
  const found = new Set()
  const range = /\b([CTLS])(\d{1,2})\s*(?:[-\u2013/]|to)\s*([CTLS])?(\d{1,2})\b/gi
  let m
  while ((m = range.exec(text))) {
    const a = SPINE.indexOf(`${m[1].toUpperCase()}${Number(m[2])}`)
    const b = SPINE.indexOf(`${(m[3] || m[1]).toUpperCase()}${Number(m[4])}`)
    if (a < 0 || b < 0) continue
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) found.add(SPINE[i])
  }
  if (!found.size) {
    for (const one of text.matchAll(/\b([CTLS])(\d{1,2})\b/gi)) {
      const level = `${one[1].toUpperCase()}${Number(one[2])}`
      if (SPINE.includes(level)) found.add(level)
    }
  }
  return SPINE.filter(l => found.has(l))
}

const BRANDS = { signus: 'Signus', kt: 'Orthofix', device: 'SeaSpine', e4: 'E4' }
// Titles the team has used; anything else is the surname alone, to be edited.
const SURGEON_TITLES = { fowler: 'Mr' }

const name = item => String(item.productName || item.description || '').trim()
const sized = item => [name(item), String(item.size || '').trim()].filter(Boolean).join(' ')
const has = (items, test) => items.filter(i => test.test(`${name(i)} ${i.description || ''}`))

/**
 * What the form starts with: the patient and surgeon off the record, the
 * levels off the booking, and the rods, graft, cages and cross connector off
 * the scanned items — sizes only, never a code.
 */
export function registrarDraft(record = {}, items = [], booking = null, { systemsInKit, inventoryFor } = {}) {
  const used = (items || []).filter(i => i && !i.excluded && !i.manualReview)
  const surgeon = String(record.surgeonSurname || record.surgeonName || '').trim()
  const title = SURGEON_TITLES[surgeon.toLowerCase()]
  const kitSystems = systemsInKit ? systemsInKit(booking?.kit || '') : []
  const system = kitSystems
    .map(s => [BRANDS[inventoryFor?.(s)?.distributor], s].filter(Boolean).join(' '))
    .join(' + ')
  const procedure = booking?.procedure || record.procedure || ''
  return {
    patient: String(record.patientSurname || ''),
    consultant: [title, surgeon].filter(Boolean).join(' '),
    system,
    levels: levelsFrom(procedure),
    screws: {},
    rods: has(used, /\brods?\b/i).map(sized).join(', '),
    crossConnector: has(used, /cross|transverse connector/i).length > 0,
    graft: has(used, /allograft|\bdbm\b|boost|bone graft|graft/i)
      .map(i => [name(i), i.manufacturer || i.distributor ? `(${i.manufacturer || i.distributor})` : ''].filter(Boolean).join(' '))
      .join(', '),
    cages: has(used, /cage|interbody|spacer/i).map(sized).join(', ')
  }
}

/** The text itself, from the form as it stands. Empty lines are left out. */
export function registrarMessage(d = {}) {
  const lines = [
    d.patient && `Patient: ${d.patient}`,
    d.consultant && `Consultant: ${d.consultant}`,
    d.system && `System: ${d.system}`
  ]
  for (const level of d.levels || []) {
    for (const side of ['Left', 'Right']) {
      const v = String(d.screws?.[`${level} ${side}`] || '').trim()
      if (v) lines.push(`${level} ${side}: ${v}`)
    }
  }
  lines.push(
    d.rods && `Rods: ${d.rods}`,
    d.crossConnector ? 'Cross connector: Yes' : null,
    d.graft && `Bone graft: ${d.graft}`,
    d.cages && `Cages: ${d.cages}`
  )
  return lines.filter(Boolean).join('\n')
}
