// ─── Distributor routing for surgeon usage ────────────────────────────────────
// Which distributor a line item belongs to, who gets emailed about it, and what
// never belongs on a usage sheet at all. This is the module to edit when a
// distributor changes contacts or TechnoMed picks up a new system.

export const DISTRIBUTORS = {
  signus: {
    name: 'Signus',
    to: ['j.hanson@signus.com.au', 'a.polites@signus.com.au']
  },
  device: {
    name: 'Device Technologies',
    to: ['dl_spine_marketing@device.com.au', 'ortho@device.com.au']
  },
  device_boost: {
    name: 'Device Technologies Boost Allograft',
    to: ['boost@device.com.au', 'dl_spine_marketing@device.com.au', 'ortho@device.com.au']
  },
  e4: {
    name: 'E4 Surgical',
    to: ['admin@e4surgical.com', 'eland@e4surgical.com']
  },
  kt: {
    name: 'KT Medical',
    to: ['kt@ktmedical.com.au', 'ben@ktmedical.com.au']
  },
  globus: {
    name: 'Nuvasive/Globus',
    to: ['customeraccounts@globusmedical.com', 'jlagoon@globusmedical.com', 'cmkenzie@globusmedical.com']
  },
  dtbv: {
    name: 'Donor Tissue Bank of Victoria',
    to: ['dtbv.utilisation@vifm.org', 'kt@ktmedical.com.au', 'ben@ktmedical.com.au']
  }
}

// CC'd on every usage email. The sender is removed at send time so nobody is
// CC'd on their own message.
export const CLINICAL_TEAM_CC = [
  'brenton@technomed.com.au',
  'ben@technomed.com.au',
  'aimee@technomed.com.au',
  'mat@technomed.com.au',
  'admin@technomed.com.au'
]

// Haemostatic agents and other peripherals are recorded by the hospital on the
// same form but are never TechnoMed implants — they must not reach a sheet.
const EXCLUDED_PRODUCT_PATTERNS = [
  /flo\s*seal/i,
  /surgicel/i,
  /spongistan/i,
  /gelfoam/i,
  /tisseel/i,
  /arista/i,
  /bone\s*wax/i,
  /haemostat|hemostat/i
]

// Ordered most-specific-first: BOOST must beat the generic Device match, and
// the allograft rules must beat a bare "global" hit.
const DISTRIBUTOR_RULES = [
  { key: 'device_boost', pattern: /\bboost\b/i },
  { key: 'dtbv', pattern: /\bcbm\b|donor\s*tissue|\bdtbv\b|allograft/i },
  { key: 'signus', pattern: /signus|diplomat|athlet|ascot|mobis/i },
  { key: 'device', pattern: /mariner|shoreline|device\s*tech/i },
  { key: 'e4', pattern: /dakota|reform|e4\s*global|\be4\b|\bbmd\b|global\s*biomedica/i },
  { key: 'kt', pattern: /kt\s*medical|\bktm\b/i },
  { key: 'globus', pattern: /nuvasive|globus/i }
]

export function isExcludedProduct(...fields) {
  const haystack = fields.filter(Boolean).join(' ')
  return EXCLUDED_PRODUCT_PATTERNS.some(p => p.test(haystack))
}

// Resolves a line item to a distributor key from its product text. Returns null
// when nothing matches, which sends the item to manual review rather than
// guessing a distributor and emailing the wrong company.
export function detectDistributor(...fields) {
  const haystack = fields.filter(Boolean).join(' ')
  if (!haystack.trim()) return null
  for (const rule of DISTRIBUTOR_RULES) {
    if (rule.pattern.test(haystack)) return rule.key
  }
  return null
}

export function distributorName(key) {
  return DISTRIBUTORS[key]?.name || 'Unidentified'
}

// CC list for one sender: the clinical team minus the sender themselves.
export function ccFor(senderEmail) {
  const sender = (senderEmail || '').toLowerCase().trim()
  return CLINICAL_TEAM_CC.filter(e => e.toLowerCase() !== sender)
}

// Groups items by distributor so one email goes to each company with only
// their own products. Items that are excluded, unresolved, or still awaiting
// manual review are held back — they must never be emailed out.
export function groupByDistributor(items) {
  const groups = new Map()
  for (const item of items) {
    if (item.excluded) continue
    if (item.manualReview) continue
    if (!item.distributorKey || !DISTRIBUTORS[item.distributorKey]) continue
    if (!groups.has(item.distributorKey)) groups.set(item.distributorKey, [])
    groups.get(item.distributorKey).push(item)
  }
  return groups
}
