import { redis, redisSetBody } from './_redis.js'
import SEED from '../src/preferences/seed.js'
import { getStaffByEmail } from '../src/staffConfig.js'

// ─── Surgeon preference cards, edited in the portal (Task 18) ────────────────
// "Allow surgeon preference cards to be edited in the portal and update for
// everyone straight away" — with who changed what, and a way back.
//
// The cards were a fixed page rebuilt from Aimee's export. They are data now:
// each surgeon, each system, a list of lines with **bold** marked in plain
// text. Seeded once from her 28 October card (src/preferences/seed.json, made
// by scripts/extract-preferences.py); from then on Redis holds them.
//
// Every save is a new version with a full snapshot, so any earlier one can be
// restored — and restoring is itself a new version, so nothing is ever lost.
// A save made against an older version than the current one is refused: two
// people editing the same card should not silently overwrite each other.

const CURRENT = 'prefs:current'
const HISTORY = 'prefs:history'
const KEEP = 200

/** Who may edit: the clinical team (Aimee, Ben, Mat, Brent) and admins. */
export function canEditPreferences(email) {
  const staff = getStaffByEmail(email)
  return Boolean(staff && (staff.isClinicalTeam || staff.isAdmin))
}

export async function getPreferences() {
  try {
    const raw = await redis('get', CURRENT)
    if (raw) return JSON.parse(raw)
  } catch { /* fall back to the seed */ }
  return { version: 0, updatedAt: '', updatedBy: 'Aimee (card of 28 Oct 2026)', data: SEED }
}

const HEX = /^#[0-9a-f]{3,8}$/i

/** A card as typed, checked and trimmed. Throws a sentence for the screen. */
export function cleanCard(card) {
  const name = String(card?.name || '').trim().slice(0, 80)
  if (!name) throw new Error('A system needs a name')
  const items = (Array.isArray(card.items) ? card.items : String(card.items || '').split('\n'))
    .map(l => String(l).trim()).filter(Boolean)
  if (items.length > 40) throw new Error('That is more than 40 lines on one card')
  if (items.some(l => l.length > 300)) throw new Error('One line is longer than 300 characters')
  const alertTitle = String(card.alert?.title || '').trim().slice(0, 120)
  const alertText = String(card.alert?.text || '').trim().slice(0, 400)
  return {
    name,
    subtitle: String(card.subtitle || '').trim().slice(0, 120),
    colour: HEX.test(String(card.colour || '')) ? card.colour : '#8C8F98',
    tag: String(card.tag || '').trim().slice(0, 40),
    items,
    alert: alertTitle || alertText ? { title: alertTitle, text: alertText } : null
  }
}

async function store(next, summary, by) {
  const version = next.version
  await redisSetBody(`prefs:v:${version}`, JSON.stringify(next.data))
  await redisSetBody(CURRENT, JSON.stringify(next))
  await redis('lpush', HISTORY, JSON.stringify({ version, at: next.updatedAt, by, summary }))
  await redis('ltrim', HISTORY, '0', String(KEEP - 1))
  return next
}

class Stale extends Error {
  constructor(current) {
    super(`${current.updatedBy || 'Somebody'} changed the cards while you were editing. Your change was not saved — reload and make it again.`)
    this.code = 'stale'
  }
}

/**
 * One card changed, added (index null) or removed (card null).
 */
export async function editCard({ baseVersion, surgeonId, index, card }, by) {
  const current = await getPreferences()
  if (Number(baseVersion) !== Number(current.version)) throw new Stale(current)
  const data = JSON.parse(JSON.stringify(current.data))
  const surgeon = data.surgeons.find(s => s.id === surgeonId)
  if (!surgeon) throw new Error('No such surgeon')
  let summary
  if (card === null) {
    const gone = surgeon.systems[index]
    if (!gone) throw new Error('No such card')
    surgeon.systems.splice(index, 1)
    summary = `Removed ${surgeon.name} · ${gone.name}`
  } else {
    const clean = cleanCard(card)
    if (index === null || index === undefined) {
      surgeon.systems.push(clean)
      summary = `Added ${surgeon.name} · ${clean.name}`
    } else {
      if (!surgeon.systems[index]) throw new Error('No such card')
      surgeon.systems[index] = clean
      summary = `Edited ${surgeon.name} · ${clean.name}`
    }
  }
  if (current.version === 0) {
    // Keep the seed as version 0 in the history, so the first edit can be undone.
    await redisSetBody('prefs:v:0', JSON.stringify(current.data))
  }
  return store({ version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: by, data }, summary, by)
}

export async function preferenceHistory() {
  const rows = await redis('lrange', HISTORY, '0', String(KEEP - 1)) || []
  return rows.map(r => { try { return JSON.parse(r) } catch { return null } }).filter(Boolean)
}

/** Puts an earlier version back, as a new version. */
export async function restoreVersion(version, by) {
  const current = await getPreferences()
  const raw = Number(version) === 0
    ? (await redis('get', 'prefs:v:0')) || JSON.stringify(SEED)
    : await redis('get', `prefs:v:${Number(version)}`)
  if (!raw) throw new Error('That version is no longer kept')
  return store({ version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: by,
    data: JSON.parse(raw) }, `Restored version ${version}`, by)
}
