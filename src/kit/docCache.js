// ─── Documents kept on the phone (Brent, 12 Nov 2026: "We can't be waiting 5
// minutes for something to load … We have to have a fast app.") ────────────
// A surgical technique is 4–9 MB. The first time it is opened it comes down
// from Dropbox once, with a progress bar; after that it is kept here and opens
// at once, even with no signal. It is kept against the Dropbox file's `rev`,
// which changes whenever the file does, so a newer version in Dropbox is
// fetched again and the old copy dropped — never shown as current.
//
// Browser Cache Storage (the same place the service worker keeps the app),
// with a small index in localStorage for the most-recently-opened order, so
// the store is trimmed to MAX_DOCS and MAX_BYTES. Everything is wrapped: a
// private window, or a phone that refuses storage, simply downloads each time.

const STORE = 'tm-docs-v1'
const INDEX = 'tm_docs_index'
export const MAX_DOCS = 40
export const MAX_BYTES = 400 * 1024 * 1024

const keyUrl = (path, rev) => `/__docs/${encodeURIComponent(String(path || '').toLowerCase())}?rev=${encodeURIComponent(rev || '')}`

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX) || '[]') || [] } catch { return [] }
}
function writeIndex(list) {
  try { localStorage.setItem(INDEX, JSON.stringify(list)) } catch { /* storage refused */ }
}

/** Which kept copies to drop: oldest first, past the count or the size. Pure. */
export function toEvict(list, { maxDocs = MAX_DOCS, maxBytes = MAX_BYTES } = {}) {
  const newestFirst = [...list].sort((a, b) => (b.at || 0) - (a.at || 0))
  const keep = []
  let bytes = 0
  for (const e of newestFirst) {
    if (keep.length < maxDocs && bytes + (e.size || 0) <= maxBytes) { keep.push(e); bytes += e.size || 0 } else break
  }
  const kept = new Set(keep.map(e => e.key))
  return list.filter(e => !kept.has(e.key))
}

async function open() {
  if (typeof caches === 'undefined') return null
  try { return await caches.open(STORE) } catch { return null }
}

/** Whether this version of the file is kept here — without reading it. */
export async function hasDoc(path, rev) {
  if (!path || !rev) return false
  const store = await open()
  if (!store) return false
  try { return Boolean(await store.match(keyUrl(path, rev))) } catch { return false }
}

/** The kept copy of this version of the file, or null. */
export async function cachedDoc(path, rev) {
  if (!path || !rev) return null
  const store = await open()
  if (!store) return null
  try {
    const hit = await store.match(keyUrl(path, rev))
    if (!hit) return null
    const buffer = await hit.arrayBuffer()
    const list = readIndex().map(e => (e.key === keyUrl(path, rev) ? { ...e, at: Date.now() } : e))
    writeIndex(list)
    return buffer
  } catch { return null }
}

/** Keeps this version, drops any older version of the same file, trims the store. */
export async function keepDoc(path, rev, buffer, type = 'application/octet-stream') {
  if (!path || !rev || !buffer) return
  const store = await open()
  if (!store) return
  const key = keyUrl(path, rev)
  const prefix = keyUrl(path, '').replace(/rev=$/, 'rev=')
  try {
    await store.put(key, new Response(buffer, { headers: { 'Content-Type': type } }))
    let list = readIndex().filter(e => e.key !== key)
    for (const old of list.filter(e => e.key.startsWith(prefix))) await store.delete(old.key).catch(() => {})
    list = list.filter(e => !e.key.startsWith(prefix))
    list.push({ key, size: buffer.byteLength || 0, at: Date.now() })
    const drop = toEvict(list)
    for (const e of drop) await store.delete(e.key).catch(() => {})
    writeIndex(list.filter(e => !drop.some(d => d.key === e.key)))
  } catch { /* storage full or refused: it simply downloads next time */ }
}

/**
 * Downloads a file with progress, `onProgress(received, total)`. Reads the body
 * as a stream where the browser offers one, so the bar moves on a slow line.
 */
export async function downloadWithProgress(url, onProgress = () => {}) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('The document could not be fetched')
  const total = Number(res.headers.get('content-length')) || 0
  if (!res.body?.getReader) {
    const buffer = await res.arrayBuffer()
    onProgress(buffer.byteLength, total || buffer.byteLength)
    return buffer
  }
  const reader = res.body.getReader()
  const parts = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    received += value.byteLength
    onProgress(received, total)
  }
  const out = new Uint8Array(received)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.byteLength }
  return out.buffer
}

/** A link that opens the file in the Dropbox app (on a phone) or dropbox.com. Pure. */
export function dropboxAppLink(path, team = 'TECHNOMED') {
  if (!path) return ''
  const clean = String(path).startsWith('/') ? path : `/${path}`
  return `https://www.dropbox.com/preview/${encodeURIComponent(team)}${clean.split('/').map(encodeURIComponent).join('/')}?role=work`
}
