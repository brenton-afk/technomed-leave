// ─── Resources: each system's reference documents (Brent, 12 Nov 2026) ───────
// "The items I want in there are the ARTG certificates, the full surgical
// techniques, the rebate codes and prices and a tray list." Chosen layout: by
// system, systems we carry only. The documents already live in Dropbox under
// /Distributors/{distributor}/{system}/…, named every which way, so they are
// found by name and linked where they are — never copied, so the portal always
// opens the current file. A person can pick a different file for a slot, or
// say there is none; that choice is shared (resources:picks). The tray list is
// the Kit room's own, from the kits of that system.
//
// Only the folders below are read or opened. Never the usage tree.

import { redis, redisSetBody } from './_redis.js'
import { listFilesUnder } from './_dropbox.js'
import { INVENTORY } from '../src/clinicalPlan/inventory.js'

export const DISTRIBUTOR_FOLDERS = {
  signus: ['/Distributors/Signus'],
  device: ['/Distributors/Device Technologies'],
  e4: ['/Distributors/E4 Surgical'],
  kt: ['/Distributors/KT Medical'],
  globus: ['/Distributors/Nuvasive'],
  technomed: ['/Distributors/Technomed Products', '/Admin/Legal & Contracts/TGA', '/Projects & Development/Instrument Production']
}
export const DISTRIBUTOR_NAMES = { signus: 'Signus', device: 'Device Technologies', e4: 'E4 Surgical', kt: 'KT Medical', globus: 'Globus / NuVasive', technomed: 'TechnoMed' }
export const SLOTS = ['artg', 'technique', 'rebate']

const CATALOGUE = 'resources:catalogue'
const CATALOGUE_TTL = 6 * 3600
const PICKS = 'resources:picks'
const DOC_FILE = /\.(pdf|docx?|xlsx?|pptx?|csv|txt)$/i

/** What kind of reference a file is, from its name. Pure. */
export function slotOf(name = '') {
  const n = String(name).toLowerCase()
  if (/(^|[^a-z])artg([^a-z]|$)/.test(n)) return 'artg'
  if (/rebate|prosthes[ie]s\s*list|prescribed\s*list|(^|[^a-z])pl\s*codes?|billing\s*codes?|charge\s*sheet/.test(n)) return 'rebate'
  if (/surgical\s*technique|op(erative)?\s*technique|technique\s*guide|surgical\s*(guide|protocol)|(^|[^a-z])stg([^a-z]|$)/.test(n)) return 'technique'
  return ''
}

/** The systems on the tab: what the portal carries, competitors left out. */
export function carriedSystems(inventory = INVENTORY) {
  return inventory.filter(i => !i.competitor && i.distributor && DISTRIBUTOR_FOLDERS[i.distributor])
    .map(i => ({ system: i.system, distributor: i.distributor }))
}

const GENERIC = new Set(['tm', 'technomed', 'system', 'systems', 'the', 'and', 'kit', 'set', 'spine', 'mis', 'open'])
const wordsOf = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !GENERIC.has(w))
const wordAt = (text, w) => {
  const m = new RegExp(`(^|[^a-z0-9])${w}`, 'g')
  let at = -1, r
  while ((r = m.exec(text))) at = r.index
  return at
}

/**
 * Which of a distributor's systems a file belongs to: all of a system's words
 * in its path, then the most of them, then the one named deepest (a file in Nuvasive/Reline is
 * REline's). Several systems tied on both get it. Pure.
 */
export function systemsForFile(path, systems) {
  const text = String(path || '').toLowerCase()
  let best = [], top = -1
  for (const s of systems) {
    const ws = wordsOf(s.system)
    const spots = ws.map(w => wordAt(text, w)).filter(i => i >= 0)
    if (!spots.length) continue
    // Every word of a system named beats some of a longer one's (a Mariner
    // MIS technique is Mariner's, not Mariner Outrigger's).
    const score = (spots.length === ws.length ? 1e6 : 0) + spots.length * 10000 + Math.max(...spots)
    if (score > top) { top = score; best = [s.system] } else if (score === top) best.push(s.system)
  }
  return best
}

const yearOf = f => Math.max(0, ...(`${f.path}`.match(/20\d\d/g) || []).map(Number))
const rank = (a, b) => (yearOf(b) - yearOf(a)) || (Number(/\.pdf$/i.test(b.name)) - Number(/\.pdf$/i.test(a.name)))
  || String(b.modified || '').localeCompare(String(a.modified || '')) || a.path.localeCompare(b.path)

/** The reference files of every folder above, classified, cached six hours. */
export async function resourceCatalogue({ fresh = false, list = listFilesUnder } = {}) {
  if (!fresh) {
    const raw = await redis('get', CATALOGUE).catch(() => null)
    try { if (raw) return JSON.parse(raw) } catch { /* rebuild */ }
  }
  const out = []
  for (const [distributor, roots] of Object.entries(DISTRIBUTOR_FOLDERS)) {
    for (const root of roots) {
      for (const f of await list(root).catch(() => [])) {
        const slot = DOC_FILE.test(f.name) ? slotOf(f.name) : ''
        if (slot) out.push({ name: f.name, path: f.path, modified: f.modified || null, rev: f.rev || '', slot, distributor })
      }
    }
  }
  await redisSetBody(CATALOGUE, JSON.stringify(out)).catch(() => {})
  await redis('expire', CATALOGUE, String(CATALOGUE_TTL)).catch(() => {})
  return out
}

/** Whether a path is one the tab may open or a person may pick. Pure. */
export function openablePath(path, catalogue = []) {
  const p = String(path || '')
  if (!p.startsWith('/') || p.includes('..')) return false
  return catalogue.some(f => f.path === p)
}

export async function getPicks() {
  try { return JSON.parse(await redis('get', PICKS) || '{}') || {} } catch { return {} }
}

/** Sets one slot of one system: a path, 'none', or null to go back to the portal's choice. */
export async function setPick(system, slot, path, catalogue) {
  if (!carriedSystems().some(s => s.system === system)) throw Object.assign(new Error('Unknown system'), { status: 400 })
  if (!SLOTS.includes(slot)) throw Object.assign(new Error('Unknown kind of document'), { status: 400 })
  if (path && path !== 'none' && !openablePath(path, catalogue)) throw Object.assign(new Error('That file is not one of the reference folders'), { status: 400 })
  const picks = await getPicks()
  const forSystem = { ...(picks[system] || {}) }
  if (path) forSystem[slot] = path; else delete forSystem[slot]
  picks[system] = forSystem
  await redisSetBody(PICKS, JSON.stringify(picks))
  return picks
}

/**
 * The tab: one entry per system, with its file for each slot (a person's pick,
 * else the newest match), the other candidates, and the kits whose tray lists
 * it can open. Pure.
 */
export function resourcesBySystem({ catalogue = [], picks = {}, kits = [], systems = carriedSystems() } = {}) {
  const byDist = {}
  for (const s of systems) (byDist[s.distributor] ||= []).push(s)
  const files = {}
  for (const f of catalogue) {
    for (const sys of systemsForFile(f.path, byDist[f.distributor] || [])) {
      ((files[sys] ||= {})[f.slot] ||= []).push(f)
    }
  }
  return systems.map(s => {
    const slots = {}
    for (const slot of SLOTS) {
      const found = [...(files[s.system]?.[slot] || [])].sort(rank)
      const pick = picks[s.system]?.[slot]
      const chosen = pick === 'none' ? null : (pick && catalogue.find(f => f.path === pick)) || found[0] || null
      slots[slot] = {
        file: chosen ? { name: chosen.name, path: chosen.path, rev: chosen.rev || '' } : null,
        picked: Boolean(pick), none: pick === 'none',
        others: found.filter(f => f.path !== chosen?.path).slice(0, 12).map(f => ({ name: f.name, path: f.path }))
      }
    }
    const trays = kits.filter(k => k.system === s.system && k.trayCount > 0).map(k => ({ id: k.id, name: k.name, trays: k.trayCount }))
    return { system: s.system, distributor: s.distributor, distributorName: DISTRIBUTOR_NAMES[s.distributor] || s.distributor, slots, trays }
  })
}

/** Every file of one kind for a distributor, for "choose another". Pure. */
export function filesFor(catalogue, distributor, slot) {
  return catalogue.filter(f => f.distributor === distributor && f.slot === slot).sort(rank).map(f => ({ name: f.name, path: f.path }))
}
