// ─── The kit room filled from the consignment agreements ─────────────────────
// Brent, 21 Nov 2026: "I'm ok for the unsigned copies to be used to populate
// the kit room" — trays, photos and the agreement, signed where we have it,
// else the latest draft. Each agreement's Appendix was read into
// _kitAgreementData.js (no prices). An admin or the clinical team runs it from
// Kit room → ⚙ → Fill from consignment agreements, one agreement per request
// (a Vercel function has a time limit and some agreements carry 30+ photos).
//
// Nothing a person has filled in is replaced: a set with no filled trays takes
// the agreement's trays (its empty placeholders go); a set with some filled
// trays only gains the agreement's trays it does not already have. The
// agreement is attached to each set that has none. Each agreement runs once.

import { redis, redisSetBody } from './_redis.js'
import { getDefs, getTrayList, saveTrayList, saveKitDef, addHistory } from './_kits.js'
import { listKitDocs, linkKitDoc } from './_kitDocs.js'
import { AGREEMENTS, PHOTO_LOADERS } from './_kitAgreementData.js'

const DONE = 'kits:agreements:done'
const BY = name => `${name} (from the consignment agreements)`

const words = s => String(s || '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Same tray under two names? Kit words aside, the words agree, and where both
 * names carry numbers ("Pedicle Screws 1-5" / "2-5") the numbers agree too.
 */
export function sameTray(a, b, kit = '') {
  const drop = new Set([...words(kit), 'tray', 'the', 'and', 'set', 'tm', 'technomed'])
  const split = s => {
    const ws = words(s).filter(w => !drop.has(w))
    return { w: new Set(ws.filter(x => !/^\d+$/.test(x))), n: ws.filter(x => /^\d+$/.test(x)).join('-') }
  }
  const A = split(a)
  const B = split(b)
  if (!A.w.size || !B.w.size) return false
  if (A.n && B.n && A.n !== B.n) return false
  const both = [...A.w].filter(w => B.w.has(w)).length
  return both / Math.min(A.w.size, B.w.size) >= 0.6 && both / Math.max(A.w.size, B.w.size) >= 0.5
}

const sameSystem = (a, b) => words(a).join(' ') === words(b).join(' ')
const byIdNatural = (x, y) => x.id.localeCompare(y.id, 'en', { numeric: true })

/**
 * What to do with one set: which of the agreement's trays to add, and whether
 * they replace the list (nothing filled yet) or join it. Pure.
 */
export function planForSet(current, trays, kit) {
  const filled = (current?.trays || []).filter(t => (t.lines || []).length)
  const add = trays.filter(t => !filled.some(f => sameTray(f.name, t.name, kit)))
  return { add, skipped: trays.length - add.length, mode: filled.length ? 'add' : 'replace' }
}

async function doneMap() {
  try { return JSON.parse((await redis('get', DONE)) || '{}') } catch { return {} }
}

export async function agreementStatus() {
  const done = await doneMap()
  return AGREEMENTS.map(a => ({
    doc: a.doc, kit: a.kit, hospital: a.hospital, trays: a.trays.length,
    file: a.agreement?.name || '', done: done[a.doc] || null
  }))
}

async function photosFor(doc) {
  const load = PHOTO_LOADERS[doc]
  if (!load) return {}
  try { return (await load()).PHOTOS || {} } catch { return {} }
}

/**
 * Files each photo one at a time, three tries each — Dropbox refuses several
 * writes at once (too_many_write_operations), which is how the first fill lost
 * its photos without a word. Returns key → path, and the keys that missed.
 */
async function filePhotos(jobs, photos, upload) {
  const out = {}
  const missed = []
  for (const { key, path } of jobs) {
    const data = photos[key]
    if (!data) { missed.push(key); continue }
    let ok = false
    for (let i = 0; i < 3 && !ok; i += 1) {
      try { await upload(path, Buffer.from(data, 'base64')); out[key] = path; ok = true } catch (err) {
        if (i === 2) console.error('agreement photo not filed', path, err?.message)
        else await new Promise(r => setTimeout(r, process.env.VITEST ? 0 : 1500 * (i + 1)))
      }
    }
    if (!ok) missed.push(key)
  }
  return { filed: out, missed }
}

const safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
const photoPath = (kit, tray) => `/Tray Lists/Tray Photos/${safe(kit.name)}/${safe(tray.name)}.jpg`

/** The sets of this agreement's system at its hospital, in order. */
const setsFor = (defs, a) => defs.filter(k => sameSystem(k.system, a.kit) && k.home === a.hospital).sort(byIdNatural)
/** Set n's trays; a document listing fewer sets than the shelf holds fills the first. */
const traysForSet = (a, n, count) => a.trays.filter(t => (t.set || 1) === n || (n === 1 && (t.set || 1) > count))

export async function fillFromAgreement(docSlug, byName, deps = {}) {
  const a = AGREEMENTS.find(x => x.doc === docSlug)
  if (!a) throw Object.assign(new Error('No such agreement'), { status: 404 })
  const done = await doneMap()
  if (done[docSlug]) return { ...done[docSlug], already: true }
  const upload = deps.upload || (await import('./_dropbox.js')).uploadFile
  const by = BY(byName)

  // The sets of this system at this hospital; made if there are none.
  let defs = await getDefs()
  let sets = setsFor(defs, a)
  const wanted = Math.max(1, ...a.trays.map(t => t.set || 1))
  if (!sets.length) {
    for (let n = 1; n <= wanted; n += 1) {
      await saveKitDef({
        name: wanted > 1 ? `${a.kit} ${n}` : a.kit, system: a.kit, distributor: a.distributor || '',
        kind: /^TM\b/.test(a.kit) ? 'technomed' : 'consignment', home: a.hospital, trays: []
      }, by)
    }
    defs = await getDefs()
    sets = setsFor(defs, a)
  }

  const photos = await photosFor(a.doc)
  if (!Object.keys(photos).length && a.trays.some(t => t.photo)) console.error('agreement photos not loaded', a.doc)
  const results = []
  for (const [i, kit] of sets.entries()) {
    const n = i + 1
    const trays = traysForSet(a, n, sets.length)
    const result = { kitId: kit.id, kitName: kit.name, added: 0, skipped: 0, attached: false }
    if (trays.length) {
      const current = await getTrayList(kit.id)
      const plan = planForSet(current, trays, a.kit)
      result.skipped = plan.skipped
      if (plan.add.length) {
        const jobs = plan.add.filter(t => t.photo).map(t => ({ key: t.photo, path: photoPath(kit, t) }))
        const { filed, missed } = await filePhotos(jobs, photos, upload)
        const file = a.agreement?.name || a.doc
        await saveTrayList(kit.id, {
          trays: plan.add.map(t => ({ name: t.name, file, lines: t.lines, ...(filed[t.photo] ? { photo: filed[t.photo] } : {}) })),
          source: { file, hospital: a.hospital },
          mode: plan.mode
        }, by)
        result.added = plan.add.length
        result.photos = Object.keys(filed).length
        result.photosMissed = missed.length
      }
    }
    // The agreement, where the set has none yet.
    if (a.agreement?.path) {
      try {
        const docs = await (deps.listDocs || listKitDocs)(kit.id)
        if (!docs.some(d => d.kind === 'consignment')) {
          await (deps.link || linkKitDoc)(kit, { path: a.agreement.path, kind: 'consignment' }, by)
          result.attached = true
        }
      } catch (err) { result.attachError = err.message }
    }
    results.push(result)
  }
  const record = { at: new Date().toISOString(), by: byName, results }
  await redisSetBody(DONE, JSON.stringify({ ...(await doneMap()), [docSlug]: record }))
  return record
}

// A code as the hospital and the agreement both print it: "2SEA-86-0020",
// "SEA-86-0020" and "86-0020" are one instrument.
const codeKey = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^2?SEA/, '')

/**
 * The agreement tray holding the same instruments as a tray named another way
 * (Brent, 21 Nov 2026: Aimee typed in the RHH Mariner lists by hand — the
 * names are hers, the codes are the same). At least half the codes of the
 * smaller tray in common, and the best such tray only. Pure.
 */
export function byCodes(tray, candidates) {
  const mine = new Set((tray.lines || []).map(l => codeKey(l.code)).filter(k => k.length >= 4))
  if (mine.size < 2) return null
  let best = null
  for (const c of candidates) {
    const theirs = new Set((c.lines || []).map(l => codeKey(l.code)).filter(k => k.length >= 4))
    if (theirs.size < 2) continue
    const both = [...mine].filter(k => theirs.has(k)).length
    const score = both / Math.min(mine.size, theirs.size)
    if (score >= 0.5 && (!best || score > best.score)) best = { c, score }
  }
  return best ? best.c : null
}

/**
 * Puts on the photos a fill missed (Brent, 21 Nov 2026: "I can't see any of
 * the new tray image additions"). For each set of the agreement, a tray with no
 * photo whose name is one of that set's agreement trays gets the agreement's
 * photo — whether the tray came from the fill or was there before. At most
 * `max` uploads a request (the function's time limit); `more` says to ask
 * again. The list is read again just before writing, so no edit is lost, and a
 * photo someone has put on meanwhile is kept.
 */
export async function addMissingPhotos(docSlug, byName, deps = {}) {
  const a = AGREEMENTS.find(x => x.doc === docSlug)
  if (!a) throw Object.assign(new Error('No such agreement'), { status: 404 })
  const max = deps.max || 8
  const upload = deps.upload || (await import('./_dropbox.js')).uploadFile
  const sets = setsFor(await getDefs(), a)
  const photos = await photosFor(a.doc)
  let budget = max
  let more = false
  let added = 0
  let missed = 0
  for (const [i, kit] of sets.entries()) {
    const own = traysForSet(a, i + 1, sets.length).filter(t => t.photo && photos[t.photo])
    if (!own.length) continue
    const list = await getTrayList(kit.id)
    const needs = (list?.trays || []).filter(t => !t.photo)
      .map(t => ({ tray: t, from: own.find(x => x.name === t.name) || own.find(x => sameTray(x.name, t.name, a.kit)) || byCodes(t, own) }))
      .filter(x => x.from)
    if (!needs.length) continue
    if (budget <= 0) { more = true; break }
    const batch = needs.slice(0, budget)
    if (needs.length > batch.length) more = true
    budget -= batch.length
    const jobs = batch.map(x => ({ key: x.tray.name, path: photoPath(kit, x.tray) }))
    const data = Object.fromEntries(batch.map(x => [x.tray.name, photos[x.from.photo]]))
    const { filed, missed: lost } = await filePhotos(jobs, data, upload)
    missed += lost.length
    if (!Object.keys(filed).length) continue
    const now = await getTrayList(kit.id)
    await redisSetBody(`kits:list:${kit.id}`, JSON.stringify({
      ...now, trays: now.trays.map(t => (!t.photo && filed[t.name] ? { ...t, photo: filed[t.name] } : t))
    }))
    added += Object.keys(filed).length
    await (deps.history || addHistory)({ kind: 'edit', kitId: kit.id, kitName: kit.name, by: BY(byName),
      text: `Tray photos added: ${Object.keys(filed).join(', ')}` })
  }
  return { doc: a.doc, added, missed, more }
}
