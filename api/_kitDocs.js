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
import { ensureFolder, uploadFile, temporaryLink, dropboxConfigured } from './_dropbox.js'

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
  const { url } = await temporaryLink(doc.path)
  return { url, name: doc.name }
}
