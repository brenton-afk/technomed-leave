// ─── Couriers for a tray move (Brent, 20 Nov 2026) ───────────────────────────
// "Build in a call courier button when you confirm the kit move … Jet courier
// as an option … the three Smartways contractors … move the kit, send the
// email, and then have the option to call the courier." Pure, shared by the
// server (which keeps the list in Redis, editable by admins and the clinical
// team) and the move sheet (which calls a number with tel:).
//
// Jet and the Smartways office are from the office's freight document (April
// 2026): Jet for around Hobart, Smartways for Launceston and beyond and for
// anything urgent. The three Smartways contractors' mobiles are Brent's (same
// day).
// No account password is ever kept here — the list is shown to every
// signed-in phone.

export const DEFAULT_COURIERS = [
  { id: 'jet', name: 'Jet Couriers', phone: '03 6228 1900', note: 'Around Hobart · account "Tech"' },
  { id: 'smartways', name: 'Smartways (office)', phone: '02 9808 2750', note: 'Launceston and beyond, urgent · branch "Technomed"' },
  { id: 'smartways-chetan', name: 'Chetan (Smartways)', phone: '0452 601 993', note: '' },
  { id: 'smartways-clayton', name: 'Clayton (Smartways)', phone: '0431 635 575', note: '' },
  { id: 'smartways-stefan', name: 'Stefan (Smartways)', phone: '0474 448 488', note: '' }
]

/**
 * A list saved before the contractors' numbers were known: the placeholder
 * row goes, and a contractor row still without a number takes the default.
 * A number someone typed is never changed.
 */
export function withKnownNumbers(list) {
  if (!Array.isArray(list)) return DEFAULT_COURIERS
  const byId = new Map(DEFAULT_COURIERS.map(c => [c.id, c]))
  const out = list.filter(c => c.id !== 'smartways-3' || c.phone)
    .map(c => (!c.phone && byId.get(c.id)?.phone ? { ...c, phone: byId.get(c.id).phone } : c))
  if (!out.some(c => c.id === 'smartways-chetan')) {
    const at = out.findIndex(c => c.id === 'smartways-clayton')
    out.splice(at < 0 ? out.length : at, 0, byId.get('smartways-chetan'))
  }
  return out
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** A phone number as dialled: digits and a leading +, nothing else. */
export function dialable(phone) {
  const s = String(phone || '').trim()
  const digits = s.replace(/[^\d]/g, '')
  if (digits.length < 6 || digits.length > 15) return ''
  return (s.startsWith('+') ? '+' : '') + digits
}

/** A saved list, cleaned: names kept, numbers checked, at most 12. */
export function cleanCouriers(list) {
  if (!Array.isArray(list)) throw new Error('No courier list')
  const out = []
  for (const c of list.slice(0, 12)) {
    const name = clip(c?.name, 40)
    if (!name) continue
    const phone = clip(c?.phone, 24)
    if (phone && !dialable(phone)) throw new Error(`"${phone}" is not a phone number (${name})`)
    if (/password/i.test(`${c?.note || ''}`)) throw new Error('Keep passwords out of the courier list — every phone can see it')
    const id = clip(c?.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '') || `c-${out.length + 1}-${Date.now().toString(36)}`
    out.push({ id, name, phone, note: clip(c?.note, 80) })
  }
  return out
}

/** What to read out to the courier: the move in a few words. */
export function bookingWords({ kitName, trays = [], from, to, date, places = {} }) {
  const what = trays.length ? `${kitName}: ${trays.join(', ')}` : kitName
  return [
    `Collect from ${places[from] || from}, deliver to ${places[to] || to}${date ? ` (${date})` : ''}.`,
    `${what} — ${trays.length || 1} ${trays.length > 1 ? 'items' : 'item'}.`
  ].join(' ')
}
