// ─── A kit's documents (Brent, 11 Nov 2026) ──────────────────────────────────
// "Adding tray lists and consignment agreements from file should be seamless
// and each kit tile should have its tray list easily accessible as well as the
// consignment agreements … share the consignment agreement or tray list from
// the kit room page with a simple share button."
//
// Each kit keeps a list of its documents in Redis (`kits:docs:{id}`) — name,
// kind, where it is in Dropbox, who added it and when. The files themselves are
// in Dropbox under /Kit Room/{kit}/{Consignment Agreements | Documents}/, never
// overwritten (`keep`), and opened only through a temporary link fetched per
// tap, for a path this list holds. Removing a document takes it off the kit;
// the file stays in Dropbox, so a slip loses nothing.

import { randomUUID } from 'node:crypto'
import { redis, redisSetBody } from './_redis.js'
import { needsAgreement } from '../src/kit/agreements.js'
import { ensureFolder, uploadFile, temporaryLink, dropboxConfigured, listFilesUnder } from './_dropbox.js'

const DOCS = id => `kits:docs:${id}`
export const DOC_KINDS = {
  consignment: { label: 'Consignment agreement', folder: 'Consignment Agreements' },
  traylist: { label: 'Tray list', folder: 'Tray Lists' },
  other: { label: 'Document', folder: 'Documents' }
}
export const KIT_ROOT = '/Kit Room'
const MAX_DOCS = 60

const safe = v => String(v || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

export async function listKitDocs(kitId) {
  const raw = await redis('get', DOCS(kitId))
  try { return raw ? JSON.parse(raw) : [] } catch { return [] }
}

/** How many documents each kit has, in one read. */
export async function docCounts(kitIds = []) {
  if (!kitIds.length) return {}
  const raws = await redis('mget', ...kitIds.map(DOCS)) || []
  const out = {}
  kitIds.forEach((id, i) => {
    let list = []
    try { list = raws[i] ? JSON.parse(raws[i]) : [] } catch { list = [] }
    out[id] = {
      docs: list.length,
      consignment: list.filter(d => d.kind === 'consignment').length
    }
  })
  return out
}

/** Files one document into Dropbox under the kit, and lists it. */
export async function keepKitDoc(kit, { buffer, filename, kind = 'other' }, by) {
  if (!dropboxConfigured()) throw Object.assign(new Error('Dropbox is not connected, so documents cannot be kept yet'), { status: 400 })
  if (!buffer?.length) throw Object.assign(new Error('No file came through'), { status: 400 })
  const k = DOC_KINDS[kind] ? kind : 'other'
  const list = await listKitDocs(kit.id)
  if (list.length >= MAX_DOCS) throw Object.assign(new Error(`A kit holds at most ${MAX_DOCS} documents — remove one first`), { status: 400 })
  const name = safe(filename) || 'Document'
  const folder = `${KIT_ROOT}/${safe(kit.name) || kit.id}/${DOC_KINDS[k].folder}`
  await ensureFolder(folder)
  const saved = await uploadFile(`${folder}/${name}`, buffer, { keep: true })
  const doc = {
    id: randomUUID(), kind: k, name: saved?.name || name,
    path: saved?.path_display || `${folder}/${name}`,
    size: buffer.length, by: by || '', at: new Date().toISOString()
  }
  await redisSetBody(DOCS(kit.id), JSON.stringify([doc, ...list]))
  return doc
}

export async function removeKitDoc(kitId, docId) {
  const list = await listKitDocs(kitId)
  const doc = list.find(d => d.id === docId)
  if (!doc) throw Object.assign(new Error('That document is no longer on this kit'), { status: 404 })
  await redisSetBody(DOCS(kitId), JSON.stringify(list.filter(d => d.id !== docId)))
  return doc
}

/** Changes a document's kind (filed under the wrong heading). */
export async function setKitDocKind(kitId, docId, kind) {
  const list = await listKitDocs(kitId)
  if (!DOC_KINDS[kind]) throw Object.assign(new Error('Unknown kind'), { status: 400 })
  const next = list.map(d => (d.id === docId ? { ...d, kind } : d))
  await redisSetBody(DOCS(kitId), JSON.stringify(next))
  return next.find(d => d.id === docId)
}

/**
 * A temporary link to one of the kit's documents — only a path this kit's list
 * holds, so the route cannot be pointed at any other file in Dropbox.
 */
export async function kitDocLink(kitId, docId) {
  const doc = (await listKitDocs(kitId)).find(d => d.id === docId)
  if (!doc) throw Object.assign(new Error('That document is no longer on this kit'), { status: 404 })
  const { url, rev, size } = await temporaryLink(doc.path)
  return { url, name: doc.name, path: doc.path, rev, size }
}

// ─── Add from Dropbox (Brent, 11 Nov 2026: "Build option 2") ─────────────────
// A file already in Dropbox is attached to a kit by its path — no copy, so the
// kit always opens the current version. Only these folders are offered or
// accepted: the consignment agreements, the tray lists and the kit room's own.
// Never anything else in the account, and never the usage tree.

export const LINK_ROOTS = ['/Admin/Consignment Agreements', '/Tray Lists', '/Kit Room']
const CATALOGUE = 'kits:dbx:catalogue'
const CATALOGUE_TTL = 900

export function linkablePath(path) {
  const p = String(path || '')
  if (!p.startsWith('/') || p.includes('..') || p.includes('\\')) return false
  const lower = p.toLowerCase()
  return LINK_ROOTS.some(r => lower.startsWith(`${r.toLowerCase()}/`))
}

export function kindForPath(path) {
  const lower = String(path || '').toLowerCase()
  if (lower.startsWith('/admin/consignment agreements/') || lower.includes('/consignment agreements/')) return 'consignment'
  if (lower.startsWith('/tray lists/') || lower.includes('/tray lists/')) return 'traylist'
  return 'other'
}

const DOC_FILE = /\.(pdf|docx?|xlsx?|jpe?g|png|webp|heic|txt|csv)$/i

/** Every attachable file in those folders, cached for a quarter of an hour. */
export async function dropboxCatalogue({ fresh = false, list = listFilesUnder } = {}) {
  if (!fresh) {
    const raw = await redis('get', CATALOGUE)
    try { if (raw) return JSON.parse(raw) } catch { /* rebuild */ }
  }
  const all = []
  for (const root of LINK_ROOTS) {
    // A photo filed by the tray lists is not a document anyone attaches.
    for (const f of await list(root)) {
      if (!DOC_FILE.test(f.name) || /\/tray photos\//i.test(f.path)) continue
      all.push({ name: f.name, path: f.path, size: f.size || 0, modified: f.modified || null, kind: kindForPath(f.path) })
    }
  }
  await redis('set', CATALOGUE, JSON.stringify(all), 'EX', String(CATALOGUE_TTL))
  return all
}

const GENERIC = new Set(['kit', 'kits', 'set', 'sets', 'loan', 'tm', 'technomed', 'consignment', 'tray', 'trays', 'rhh', 'clv',
  'calvary', 'royal', 'hobart', 'lenah', 'valley', 'office', 'warehouse', 'and', 'the', 'of', 'system', 'instruments', 'implants',
  'spine', 'mis', 'open', 'set', 'agreement', 'agreements'])
const words = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !GENERIC.has(w))
const HOSPITAL_WORDS = { CLV: ['clv', 'calvary', 'lenah'], RHH: ['rhh', 'royal hobart'], HPH: ['hph', 'hobart private'] }

/**
 * Files that look like this kit's: its system named in the file's name or
 * folder, the hospital it lives at named too, a different hospital counting
 * against it, newer ahead of older.
 */
export function suggestFor(kit, catalogue = [], { kind = 'consignment', taken = [] } = {}) {
  const sys = [...new Set([...words(kit.system), ...words(kit.name)])]
  if (!sys.length) return []
  const home = HOSPITAL_WORDS[kit.home] || []
  const others = Object.entries(HOSPITAL_WORDS).filter(([k]) => k !== kit.home).flatMap(([, v]) => v)
  const has = (text, w) => new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(text)
  const scored = catalogue
    .filter(f => f.kind === kind && !taken.includes(f.path))
    .map(f => {
      const text = f.path.toLowerCase()
      const sysHits = sys.filter(w => has(text, w)).length
      if (!sysHits) return null
      let score = sysHits * 3
      if (home.some(w => text.includes(w))) score += 2
      if (others.some(w => text.includes(w)) && !home.some(w => text.includes(w))) score -= 4
      const name = f.name.toLowerCase()
      // The agreement itself over a consigned-item list filed beside it; a
      // signed copy, and a PDF, over the Word draft of the same thing.
      if (/consign\w* agreement/.test(name)) score += 1
      if (/signed/.test(name)) score += 0.5
      if (/\.pdf$/.test(name)) score += 0.25
      const year = Math.max(0, ...(text.match(/20\d\d/g) || []).map(Number))
      return { ...f, score, year, homeMatch: home.some(w => text.includes(w)) }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.year - a.year || String(b.modified || '').localeCompare(String(a.modified || '')))
  // The same agreement as a PDF and as a Word file is one document, not two
  // candidates competing — the better-scored copy (the PDF) stands for both.
  // By name: the team keeps the PDFs in a "PDF format" folder beside the Word files.
  const base = f => f.name.toLowerCase().replace(/\.(pdf|docx?)$/, '').replace(/\s+/g, ' ').trim()
  const seen = new Set()
  return scored.filter(f => (seen.has(base(f)) ? false : seen.add(base(f)))).slice(0, 8)
}

/** Any attachable file whose name or folder holds every word typed. */
export function searchCatalogue(catalogue = [], q = '') {
  const ws = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!ws.length) return []
  return catalogue.filter(f => ws.every(w => f.path.toLowerCase().includes(w))).slice(0, 40)
}

/** Attaches a Dropbox file to a kit by its path. Checked, never trusted. */
export async function linkKitDoc(kit, { path, kind }, by, { open = temporaryLink } = {}) {
  if (!linkablePath(path)) throw Object.assign(new Error('Only files in the consignment agreement, tray list or kit room folders can be attached'), { status: 400 })
  const list = await listKitDocs(kit.id)
  const already = list.find(d => d.path.toLowerCase() === String(path).toLowerCase())
  if (already) return already
  if (list.length >= MAX_DOCS) throw Object.assign(new Error(`A kit holds at most ${MAX_DOCS} documents — remove one first`), { status: 400 })
  // It has to be there: opening it is the check.
  const { name } = await open(path)
  const doc = {
    id: randomUUID(), kind: DOC_KINDS[kind] ? kind : kindForPath(path), name: name || path.split('/').pop(),
    path, size: 0, linked: true, by: by || '', at: new Date().toISOString()
  }
  await redisSetBody(DOCS(kit.id), JSON.stringify([doc, ...list]))
  return doc
}

/**
 * For the "attach agreements to every kit" pass: a kit gets a file only when
 * one suggestion clearly leads (its hospital named, nothing close behind);
 * anything less is listed for a person to choose. Kits that already have an
 * agreement are left alone.
 */
export function proposeAgreements(kits = [], catalogue = [], docsByKit = {}) {
  const sure = []
  const unsure = []
  for (const kit of kits) {
    // A TM loan kit has no agreement to find.
    if (!needsAgreement(kit)) continue
    if ((docsByKit[kit.id] || []).some(d => d.kind === 'consignment')) continue
    const options = suggestFor(kit, catalogue, { taken: (docsByKit[kit.id] || []).map(d => d.path) })
    if (!options.length) continue
    const [top, next] = options
    // Clearly ahead: its hospital named, and a whole point clear of the next
    // (or level on points and a newer year) — never a coin toss.
    const clear = top.homeMatch && (!next || top.score >= next.score + 1 || (top.score > next.score - 1 && top.year > next.year))
    if (clear) sure.push({ kitId: kit.id, kitName: kit.name, path: top.path, name: top.name })
    else unsure.push({ kitId: kit.id, kitName: kit.name, options: options.slice(0, 4).map(o => ({ path: o.path, name: o.name })) })
  }
  return { sure, unsure }
}
