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

/** What is stored, or the seed — without additions, so nothing here can loop. */
async function storedPreferences() {
  try {
    const raw = await redis('get', CURRENT)
    if (raw) return JSON.parse(raw)
  } catch { /* fall back to the seed */ }
  return { version: 0, updatedAt: '', updatedBy: 'Aimee (card of 28 Oct 2026)', data: SEED }
}

export async function getPreferences() {
  return applyAdditions(await storedPreferences())
}

// ─── Cards added from a conversation, once each ──────────────────────────────
// Brent, 7 Nov 2026, before a pelvic case: "Save as a card under the other
// orthopaedics cards". The live cards are in Redis, not here, so a card is
// added the first time the cards are read after it ships: into the group
// whose name says orthopaedics (made if there is none), as an ordinary new
// version — so it can be edited, and the version before it restored, like any
// other change. The id is recorded in `data.added`, so it is never added twice.
export const CARD_ADDITIONS = [
  {
    id: 'synthes-pelvic-recon-35-2026-11-07',
    group: /ortho/i,
    groupName: 'Orthopaedics',
    card: {
      name: 'Synthes Pelvic Recon (3.5 mm)',
      subtitle: 'Pelvic / acetabular ORIF · DePuy Synthes',
      tag: 'Pelvis',
      colour: '#2B6CB0',
      items: [
        '**Plates:** 3.5 mm reconstruction plates, straight and curved — notched, bend and twist in 3 planes',
        '**LCP recon plates** if in the set — take locking or standard screws',
        'Contour the **malleable template** first, then bend the plate to match',
        'Bend with **bending irons / pliers** (twist) and the **bending press** (in-plane) — between holes, never through one',
        '**3.5 cortex:** drill **2.5 mm**, tap 3.5 mm, 2.5/3.5 drill guide',
        '**3.5 cortex as a lag:** **3.5 mm** glide hole (near cortex), then **2.5 mm** thread hole through the insert sleeve',
        '**4.0 cancellous:** drill **2.5 mm**, tap 4.0 (often not needed in pelvic bone)',
        '**3.5 locking (LCP only):** drill **2.8 mm** through the **threaded** locking guide, self-tapping',
        'Long pelvic screws: 3.5 cortex to ~**110 mm** — have the **long 2.5 mm bits** (180/230 mm), long depth gauge and long driver shaft',
        'Measure every hole — columns run long',
        'SI / column screws: **7.3 cannulated** — 2.8 guide wire, **5.0 mm** cannulated drill; **6.5 cannulated** — 2.8 wire, **4.5 mm** drill',
        'Reduction: pointed (Weber), **Farabeuf**, **Jungbluth**, ball-spike pushers, long/angled clamps (Matta set if available)',
        'K-wires 1.6 / 2.0 for provisional fixation',
        'Navigated (AIRO / Curve): confirm which drill guide arrays they want before draping'
      ],
      alert: {
        title: 'Check before the case',
        text: 'Long 3.5 cortex screws and long 2.5 mm bits are what usually run short in pelvis — count them against the tray list.'
      }
    }
  }
]

/** The cards with any additions not yet made, made — and saved as a version. */
export async function applyAdditions(current, additions = CARD_ADDITIONS) {
  // Off for the tests of editing itself, which count versions from the seed.
  if (process.env.PREF_ADDITIONS === 'off' && additions === CARD_ADDITIONS) return current
  const done = new Set(current.data?.added || [])
  const todo = additions.filter(a => !done.has(a.id))
  if (!todo.length) return current
  const data = JSON.parse(JSON.stringify(current.data))
  data.surgeons = data.surgeons || []
  for (const a of todo) {
    let group = data.surgeons.find(g => a.group.test(String(g.name || '')) || a.group.test(String(g.id || '')))
    if (!group) {
      group = { id: a.groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: a.groupName, systems: [] }
      data.surgeons.push(group)
    }
    group.systems = group.systems || []
    if (!group.systems.some(c => c.name === a.card.name)) group.systems.push(cleanCard(a.card))
  }
  data.added = [...done, ...todo.map(a => a.id)]
  try {
    if (current.version === 0) await redisSetBody('prefs:v:0', JSON.stringify(current.data))
    return await store({ version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: 'Brent (via Claude)', data },
      `Added ${todo.map(a => a.card.name).join(', ')}`, 'Brent (via Claude)')
  } catch {
    // Somebody else saved at the same moment: show what they saved; the
    // addition is made on the next read.
    return current
  }
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
  // Two saves made against the same version both passed the check above and
  // both wrote version n+1 — the second silently replacing the first. Each
  // version number can now be taken once; the loser is told to reload.
  if (await redis('set', `prefs:claim:${version}`, String(by || ''), 'NX', 'EX', '604800') !== 'OK') {
    throw new Stale(await storedPreferences())
  }
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
