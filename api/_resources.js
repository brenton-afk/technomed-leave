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
import { listFilesUnder, uploadFile } from './_dropbox.js'
import { INVENTORY } from '../src/clinicalPlan/inventory.js'
import { kitSystemName } from '../src/kit/systems.js'

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
// Kept until it is rebuilt (Brent, 18 Nov 2026: "The resources page takes
// AGES to load" — at 30 minutes the next person after it lapsed waited while
// every distributor folder was read). Rebuilt overnight (job=nightly), by
// "Look in Dropbox again", and one distributor at a time whenever someone
// opens Choose a file or uploads one, so a new file still shows at once.
const CATALOGUE_TTL = 8 * 24 * 3600
const PICKS = 'resources:picks'
const DOC_FILE = /\.(pdf|docx?|xlsx?|pptx?|csv|txt)$/i

/** What kind of reference a file is, from its name. Pure. */
export function slotOf(name = '') {
  const n = String(name).toLowerCase()
  if (/(^|[^a-z])artg([^a-z]|$)/.test(n)) return 'artg'
  if (/rebate|prosthes[ie]s\s*list|prescribed\s*list|(^|[^a-z])pl\s*codes?|billing\s*codes?|charge\s*sheet/.test(n)) return 'rebate'
  if (/surgical[\s_-]*tech(nique)?|op(erative)?[\s_-]*technique|technique[\s_-]*guide|surgical[\s_-]*(guide|protocol)|(^|[^a-z])stg([^a-z]|$)/.test(n)) return 'technique'
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

/** One distributor's reference files, its folders read side by side. */
async function readDistributor(distributor, list) {
  const roots = DISTRIBUTOR_FOLDERS[distributor] || []
  const found = await Promise.all(roots.map(root => list(root).catch(() => [])))
  const out = []
  for (const files of found) {
    for (const f of files) {
      const slot = DOC_FILE.test(f.name) ? slotOf(f.name) : ''
      if (slot) out.push({ name: f.name, path: f.path, modified: f.modified || null, rev: f.rev || '', slot, distributor })
    }
  }
  return out
}

async function storeCatalogue(out) {
  await redisSetBody(CATALOGUE, JSON.stringify(out)).catch(() => {})
  await redis('expire', CATALOGUE, String(CATALOGUE_TTL)).catch(() => {})
}

/**
 * The reference files of every folder above, classified. The stored copy
 * unless `fresh`; `distributor` with `fresh` rereads that distributor only and
 * keeps everyone else's as stored.
 */
export async function resourceCatalogue({ fresh = false, distributor = '', list = listFilesUnder } = {}) {
  let stored = null
  if (!fresh || distributor) {
    const raw = await redis('get', CATALOGUE).catch(() => null)
    try { stored = raw ? JSON.parse(raw) : null } catch { stored = null }
    if (stored && !fresh) return stored
  }
  if (fresh && distributor && stored && DISTRIBUTOR_FOLDERS[distributor]) {
    const theirs = await readDistributor(distributor, list)
    const out = [...stored.filter(f => f.distributor !== distributor), ...theirs]
    await storeCatalogue(out)
    return out
  }
  const all = await Promise.all(Object.keys(DISTRIBUTOR_FOLDERS).map(d => readDistributor(d, list)))
  const out = all.flat()
  await storeCatalogue(out)
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
    const trays = kits.filter(k => (k.system === s.system || k.system === kitSystemName(s.system)) && k.trayCount > 0).map(k => ({ id: k.id, name: k.name, trays: k.trayCount }))
    return { system: s.system, distributor: s.distributor, distributorName: DISTRIBUTOR_NAMES[s.distributor] || s.distributor, slots, trays }
  })
}

/** Every file of one kind for a distributor, for "choose another". Pure. */
export function filesFor(catalogue, distributor, slot) {
  return catalogue.filter(f => f.distributor === distributor && f.slot === slot).sort(rank).map(f => ({ name: f.name, path: f.path }))
}

// ─── Upload a file into a slot (Aimee, 17 Nov 2026) ──────────────────────────
// "Trying to add the ARTGs and it doesn't allow you to upload a document."
// The file is filed in the distributor's own Dropbox folder — beside that
// system's other references where there are any, else in a folder named for
// the system — never over a file (keep), named so the portal reads it as that
// slot and that system, then chosen for the slot for everyone.
const SLOT_WORD = { artg: 'ARTG', technique: 'Surgical Technique', rebate: 'Rebate Codes' }
export const UPLOAD_TYPES = /\.(pdf|docx?|xlsx?|pptx?|csv|txt)$/i

/** Where an uploaded reference goes, and under what name. Pure. */
export function uploadPathFor({ system, slot, filename, catalogue = [], systems = carriedSystems() }) {
  const sys = systems.find(s => s.system === system)
  if (!sys) throw Object.assign(new Error('Unknown system'), { status: 400 })
  if (!SLOTS.includes(slot)) throw Object.assign(new Error('Unknown kind of document'), { status: 400 })
  const base = String(filename || '').split(/[\\/]/).pop().replace(/[:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
  if (!UPLOAD_TYPES.test(base)) throw Object.assign(new Error('Upload a PDF, Word, Excel, PowerPoint or text file'), { status: 400 })
  const ofDist = systems.filter(s => s.distributor === sys.distributor)
  const theirs = catalogue.filter(f => f.distributor === sys.distributor && systemsForFile(f.path, ofDist).includes(system))
  // The shallowest of the system's folders: its own, not a rebate-codes corner of it.
  const folders = theirs.map(f => f.path.split('/').slice(0, -1).join('/'))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  const folder = folders.length
    ? folders[0]
    : `${DISTRIBUTOR_FOLDERS[sys.distributor][0]}/${system.replace(/[:*?"<>|/\\]+/g, ' ').trim()}`
  const sysWords = wordsOf(system)
  const namesSystem = sysWords.every(w => wordAt(`${folder}/${base}`.toLowerCase(), w) >= 0)
  const name = slotOf(base) === slot && namesSystem ? base : `${system} ${SLOT_WORD[slot]} - ${base}`
  return { path: `${folder}/${name}`, distributor: sys.distributor }
}

// ─── ARTG certificates sent by Brent (23 Nov 2026) ──────────────────────────
// "Please see ARTG certificates. Please update the portal with these." Each is
// done once (`resources:applied`): the Global BMD lumbar cage certificate is
// already in E4's Dropbox folder and is chosen for Catenary ALIF and Global
// BMD PLIF (an older 2022 summary sat beside the PLIF cage); Reform's was not
// in Dropbox at all, so it is filed in E4's folder beside Reform's other
// references, the way an upload would be, and chosen for Reform Cervical.
export const RESOURCE_ADDITIONS = [
  { id: 'artg-gb-lumbar-2026-11-23', slot: 'artg', distributor: 'e4',
    systems: ['Catenary ALIF', 'Global BMD PLIF'],
    existing: 'ARTG 323520 (GB lumbar cage including Standalone).pdf' },
  { id: 'artg-reform-2026-11-23', slot: 'artg', distributor: 'e4',
    systems: ['Reform Cervical'],
    filename: 'Reform Cervical ARTG 287906 - POCT and Slim HP.pdf',
    load: () => import('./_resourceSeedReformArtg.js').then(m => m.REFORM_ARTG) }
]
const APPLIED = 'resources:applied'
const nameOf = p => String(p || '').split('/').pop().toLowerCase()

/** Runs the additions not yet done. Never throws; a failed one is tried again next time. */
export async function applyResourceAdditions({ additions = RESOURCE_ADDITIONS, upload = uploadFile, list = listFilesUnder } = {}) {
  let applied = []
  try { applied = JSON.parse(await redis('get', APPLIED) || '[]') } catch { applied = [] }
  const due = additions.filter(a => !applied.includes(a.id))
  if (!due.length) return []
  if (await redis('set', `${APPLIED}:lock`, '1', 'NX', 'EX', '60') !== 'OK') return []
  const done = []
  try {
    for (const a of due) {
      try {
        let catalogue = await resourceCatalogue({ fresh: true, distributor: a.distributor, list })
        const want = nameOf(a.existing || a.filename)
        let file = catalogue.find(f => f.distributor === a.distributor && nameOf(f.path) === want)
        if (!file && a.load) {
          const { path } = uploadPathFor({ system: a.systems[0], slot: a.slot, filename: a.filename, catalogue })
          await upload(path, Buffer.from(await a.load(), 'base64'), { keep: true })
          catalogue = await resourceCatalogue({ fresh: true, distributor: a.distributor, list })
          file = catalogue.find(f => f.path.toLowerCase() === path.toLowerCase())
        }
        if (!file) continue
        for (const system of a.systems) await setPick(system, a.slot, file.path, catalogue)
        applied.push(a.id); done.push(a.id)
        await redisSetBody(APPLIED, JSON.stringify(applied))
      } catch (err) { console.error('resource addition failed', a.id, err?.message) }
    }
  } finally { await redis('del', `${APPLIED}:lock`).catch(() => {}) }
  return done
}
