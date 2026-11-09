// ─── What a usage line must say before it goes (Brent, 9 Nov 2026) ───────────
// "The portal should have picked up the missing size of the rods before he
// sent it." Cloherty: the rods went to Signus as "Diplomat curved rods · 105"
// with no product code, so Signus could not resupply them from the sheet. A
// distributor resupplies by code — a line without one, or a rod or screw
// without its size, is not finished.
//
// Shared by the scan (api/_usageCase.js, which flags the line for review) and
// by Amend (src/pages/scan/AmendUsage.jsx and api/usage/agent.js, which will
// not send a correction with a gap unless the rep says so).

const textOf = item => [item?.productName, item?.description].filter(Boolean).join(' ')

// ─── The rules, one row per kind of item (Brent, 9 Nov 2026) ─────────────────
// "We need to build a list of rules to check when usages are sent … there is
// no size per se for a tulip, so I don't want the usage stopped for these."
//
// Every line wants a product code: that is how a distributor resupplies. A
// missing code puts the line in review, but it can always go — "Resolve
// without a code". Only the kinds marked `size` are *stopped* for a missing
// size, and only when there is no code either, because a code already says
// the size (AB0321-65050 is a 6.5 × 50 screw). First match wins, so the
// specific rows come before the general ones — "Ped Scr w/o tulip" is a screw,
// not a tulip, and a set screw is not a pedicle screw.
export const LINE_RULES = [
  { kind: 'Pedicle screw without its tulip', match: /w\/?o\s*(tlp|tul)|without\s*(a\s*)?tulip/i, size: 'screw size' },
  { kind: 'Set screw, locking cap, nut or closure', match: /set\s*screw|locking\s*cap|\bnut\b|\bcap\b|closure|blocker/i, size: null },
  { kind: 'Tulip or screw head', match: /tulip|screw\s*head|\bhead\b/i, size: null },
  { kind: 'Cross connector or cross link', match: /cross\s*-?\s*(link|connector)|transverse\s*connector/i, size: null },
  { kind: 'K-wire or guide wire', match: /k-?\s*wire|guide\s*wire|nitinol/i, size: null },
  { kind: 'Bone graft, allograft or substitute', match: /graft|allograft|\bdbm\b|boost|\bcbm\b|putty|chips|granules/i, size: null },
  { kind: 'Pedicle, lateral mass or bone screw', match: /screws?\b|\bscr\b/i, size: 'screw size' },
  { kind: 'Rod', match: /\brods?\b/i, size: 'rod length' },
  { kind: 'Plate', match: /plate/i, size: 'plate size' },
  { kind: 'Cage, interbody, spacer or corpectomy body', match: /cage|interbody|spacer|\b(plif|tlif|alif)\b.*implant|end\s*body|main\s*body/i, size: 'cage size' }
]

/** The rule a line falls under, or null — anything else needs a code only. */
export function ruleFor(item) {
  const words = textOf(item)
  return LINE_RULES.find(r => r.match.test(words)) || null
}

const hasCode = item => Boolean(String(item?.referenceCode || '').trim())
const hasSize = item => Boolean(String(item?.size || '').trim()) || /\d/.test(String(item?.description || '').replace(/\b[A-Z]{2,}\d+[-\w]*/g, ''))

const isRod = item => ruleFor(item)?.kind === 'Rod'

/** A length in mm written anywhere on the line: "105", "105mm", "5.5 x 105". */
export function lengthOf(item) {
  const all = [item?.size, item?.description, item?.productName].filter(Boolean).join(' ')
  const m = all.match(/(?:x\s*)?(\d{2,3})(?:\s*mm)?\b/gi) || []
  const lengths = m.map(s => Number(s.replace(/[^\d]/g, ''))).filter(n => n >= 20 && n <= 600)
  return lengths.length ? lengths[lengths.length - 1] : null
}

/**
 * Signus Diplomat titanium rods: AB0955-00{length} curved, AB0855-00{length}
 * straight — the codes on every Signus sales report. Only offered, never
 * filled in by itself: the rep taps to use it.
 */
export function suggestedCode(item) {
  if (item?.referenceCode) return ''
  const words = textOf(item)
  if (!isRod(item) || !/diplomat|signus/i.test(`${words} ${item?.distributor || ''} ${item?.distributorKey || ''}`)) return ''
  const length = lengthOf(item)
  if (!length) return ''
  const shape = /curv|lordo|bent/i.test(words) ? 'AB0955' : /straight/i.test(words) ? 'AB0855' : ''
  return shape ? `${shape}-${String(length).padStart(5, '0')}` : ''
}

/** What is missing from a line, in words for the rep. Empty when it is complete. */
export function itemGaps(item) {
  if (!item || item.excluded) return []
  const gaps = []
  if (!hasCode(item)) gaps.push('no product code')
  const rule = ruleFor(item)
  if (rule?.size && !hasCode(item)) {
    const sized = rule.kind === 'Rod' ? Boolean(lengthOf(item)) : hasSize(item)
    if (!sized) gaps.push(`${rule.size} missing`)
  }
  return gaps
}
