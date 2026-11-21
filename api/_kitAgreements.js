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
import { getDefs, getTrayList, saveTrayList, saveKitDef } from './_kits.js'
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

/** Files each photo, three at a time, three tries each. Returns key → path. */
async function filePhotos(jobs, photos, upload) {
  const out = {}
  const one = async ({ key, path }) => {
    const data = photos[key]
    if (!data) return
    for (let i = 0; i < 3; i += 1) {
      try { await upload(path, Buffer.from(data, 'base64')); out[key] = path; return } catch {
        await new Promise(r => setTimeout(r, process.env.VITEST ? 0 : 1200 * (i + 1)))
      }
    }
  }
  for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3).map(one))
  return out
}

const safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

export async function fillFromAgreement(docSlug, byName, deps = {}) {
  const a = AGREEMENTS.find(x => x.doc === docSlug)
  if (!a) throw Object.assign(new Error('No such agreement'), { status: 404 })
  const done = await doneMap()
  if (done[docSlug]) return { ...done[docSlug], already: true }
  const upload = deps.upload || (await import('./_dropbox.js')).uploadFile
  const by = BY(byName)

  // The sets of this system at this hospital; made if there are none.
  let defs = await getDefs()
  let sets = defs.filter(k => sameSystem(k.system, a.kit) && k.home === a.hospital).sort(byIdNatural)
  const wanted = Math.max(1, ...a.trays.map(t => t.set || 1))
  if (!sets.length) {
    for (let n = 1; n <= wanted; n += 1) {
      await saveKitDef({
        name: wanted > 1 ? `${a.kit} ${n}` : a.kit, system: a.kit, distributor: a.distributor || '',
        kind: /^TM\b/.test(a.kit) ? 'technomed' : 'consignment', home: a.hospital, trays: []
      }, by)
    }
    defs = await getDefs()
    sets = defs.filter(k => sameSystem(k.system, a.kit) && k.home === a.hospital).sort(byIdNatural)
  }

  const photos = await photosFor(a.doc)
  const results = []
  for (const [i, kit] of sets.entries()) {
    const n = i + 1
    // Set n's trays; a document listing fewer sets than the shelf holds fills the first.
    const trays = a.trays.filter(t => (t.set || 1) === n || (n === 1 && (t.set || 1) > sets.length))
    const result = { kitId: kit.id, kitName: kit.name, added: 0, skipped: 0, attached: false }
    if (trays.length) {
      const current = await getTrayList(kit.id)
      const plan = planForSet(current, trays, a.kit)
      result.skipped = plan.skipped
      if (plan.add.length) {
        const jobs = plan.add.filter(t => t.photo).map(t => ({
          key: t.photo, path: `/Tray Lists/Tray Photos/${safe(kit.name)}/${safe(t.name)}.jpg`
        }))
        const filed = await filePhotos(jobs, photos, upload)
        const file = a.agreement?.name || a.doc
        await saveTrayList(kit.id, {
          trays: plan.add.map(t => ({ name: t.name, file, lines: t.lines, ...(filed[t.photo] ? { photo: filed[t.photo] } : {}) })),
          source: { file, hospital: a.hospital },
          mode: plan.mode
        }, by)
        result.added = plan.add.length
        result.photos = Object.keys(filed).length
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
