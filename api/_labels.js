// ─── Label Studio storage (Brent, 25 Nov 2026) ────────────────────────────
// Implant product labels, kept in the portal instead of Vistaprint. One place
// for all of them:
//   labels:<id>       a label (src/labels/model.js), with version / who / when
//   labels:index      the set of label ids
//   labels:logos      every logo: { k: { k, name, w, h, url, type } } — the
//                     pictures themselves in Vercel Blob (labels/logos/…)
//   labels:deleted    the last 50 labels taken off, whole, so one can be put back
//   labels:seeded     set once the Vistaprint export has been loaded
//   labels:fit-v1     set once imported labels seeded before fit-to-box had it
//   labels:prev:<id>  the label as it was before "Tidy all labels", so it can be put back
// Seeded once from api/_labelSeed.js on the first list (under a lock). Reads
// are one SMEMBERS, one MGET and one GET — the Upstash allowance is small.

import { randomUUID, randomBytes } from 'node:crypto'
import { redis as realRedis, redisSetBody as realSetBody } from './_redis.js'
import { sanitiseLabel } from '../src/labels/model.js'

const KEY = id => `labels:${id}`
const parse = raw => { try { return raw ? JSON.parse(raw) : null } catch { return null } }
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

async function realPut(path, buf, contentType) {
  const { put } = await import('@vercel/blob')
  const blob = await put(path, buf, { access: 'public', contentType, addRandomSuffix: true })
  return blob.url
}

/** Swappable for tests: { redis, setBody, put(path, buf, type) → url }. */
export function labelStore(deps = {}) {
  const redis = deps.redis || realRedis
  const setBody = deps.setBody || realSetBody
  const put = deps.put || realPut
  const now = () => (deps.now ? deps.now() : new Date().toISOString())

  async function readLogos() {
    const logos = parse(await redis('get', 'labels:logos')) || {}
    // A logo Blob could not take at seeding is kept inline and served as data.
    const inline = Object.values(logos).filter(l => !l.url)
    if (inline.length) {
      const raws = await redis('mget', ...inline.map(l => `labels:logodata:${l.k}`)) || []
      inline.forEach((l, i) => { logos[l.k] = { ...l, url: raws[i] || '' } })
    }
    return logos
  }

  /** Loads the Vistaprint export once. Returns true while another request is doing it. */
  async function ensureSeeded() {
    const [seeded, fitted] = await redis('mget', 'labels:seeded', 'labels:fit-v1') || []
    if (seeded) {
      if (!fitted) await fitImported()
      return false
    }
    if (await redis('set', 'labels:seeding', '1', 'NX', 'EX', '120') !== 'OK') return true
    try {
      const { SEED_LABELS, SEED_LOGOS } = deps.seed || await import('./_labelSeed.js')
      const { LOGO_DATA } = deps.seedLogos || await import('./_labelSeedLogos.js')
      const logos = parse(await redis('get', 'labels:logos')) || {}
      for (const logo of SEED_LOGOS) {
        if (logos[logo.k]) continue
        const dataUrl = LOGO_DATA[logo.k]
        const buf = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64')
        let url = ''
        try { url = await put(`labels/logos/${logo.k}.png`, buf, logo.type || 'image/png') } catch (err) {
          console.error(`label logo ${logo.k} not stored in Blob:`, err.message)
          await setBody(`labels:logodata:${logo.k}`, dataUrl)
        }
        logos[logo.k] = { ...logo, url, addedBy: 'Vistaprint import', addedAt: now() }
      }
      await setBody('labels:logos', JSON.stringify(logos))
      const at = now()
      for (let i = 0; i < SEED_LABELS.length; i += 10) {
        await Promise.all(SEED_LABELS.slice(i, i + 10).map(l => setBody(KEY(l.id), JSON.stringify({
          ...l, version: 1, createdAt: at, createdBy: 'Vistaprint import', updatedAt: at, updatedBy: 'Vistaprint import'
        }))))
      }
      if (SEED_LABELS.length) await redis('sadd', 'labels:index', ...SEED_LABELS.map(l => l.id))
      await redis('set', 'labels:seeded', at)
      await redis('set', 'labels:fit-v1', at)
      return false
    } finally {
      await redis('del', 'labels:seeding')
    }
  }

  /**
   * Labels seeded before fit-to-box (25 Nov 2026) get `fit: true` on their
   * text, as a fresh import would — only those nobody has saved since.
   */
  async function fitImported() {
    if (await redis('set', 'labels:fit-v1:lock', '1', 'NX', 'EX', '60') !== 'OK') return
    try {
      const ids = await redis('smembers', 'labels:index') || []
      for (let i = 0; i < ids.length; i += 100) {
        const raws = await redis('mget', ...ids.slice(i, i + 100).map(KEY)) || []
        for (const l of raws.map(parse).filter(Boolean)) {
          if (l.source !== 'vistaprint' || l.version !== 1) continue
          const items = (l.items || []).map(it => (it.t === 'txt' && !it.fit ? { ...it, fit: true } : it))
          await setBody(KEY(l.id), JSON.stringify({ ...l, items }))
        }
      }
      await redis('set', 'labels:fit-v1', now())
    } finally {
      await redis('del', 'labels:fit-v1:lock')
    }
  }

  async function getLabel(id) {
    return parse(await redis('get', KEY(String(id))))
  }

  async function listLabels() {
    const seeding = await ensureSeeded()
    const ids = await redis('smembers', 'labels:index') || []
    const labels = []
    for (let i = 0; i < ids.length; i += 100) {
      const raws = await redis('mget', ...ids.slice(i, i + 100).map(KEY)) || []
      labels.push(...raws.map(parse).filter(Boolean))
    }
    labels.sort((a, b) => String(a.name).localeCompare(String(b.name)))
    return { labels, logos: await readLogos(), seeding }
  }

  async function withLock(key, fn) {
    for (let i = 0; i < 20; i++) {
      if (await redis('set', key, '1', 'NX', 'EX', '10') === 'OK') {
        try { return await fn() } finally { await redis('del', key) }
      }
      await new Promise(r => setTimeout(r, deps.lockWait ?? 150))
    }
    throw new Error('Someone else is saving — try again in a moment')
  }

  async function logoKeys() {
    return new Set(Object.keys(parse(await redis('get', 'labels:logos')) || {}))
  }

  /** A new label (blank or a duplicate). */
  async function createLabel(input, by) {
    const clean = sanitiseLabel(input, { logoKeys: await logoKeys() })
    const at = now()
    const label = { id: randomUUID(), ...clean, version: 1, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by }
    await setBody(KEY(label.id), JSON.stringify(label))
    await redis('sadd', 'labels:index', label.id)
    return label
  }

  /**
   * Saves over a label only if nobody has saved it since the editor opened it:
   * `version` is the one the editor started from. Otherwise { conflict, current }.
   */
  async function saveLabel(id, input, version, by, { tidy = false } = {}) {
    const keys = await logoKeys()
    return withLock(`labels:lock:${id}`, async () => {
      const current = await getLabel(id)
      if (!current) return { missing: true }
      if (Number(version) !== Number(current.version)) return { conflict: true, current }
      const clean = sanitiseLabel(input, { logoKeys: keys })
      // Tidying keeps the label as it was (once — tidying twice keeps the original).
      if (tidy && !current.tidied) await setBody(`labels:prev:${id}`, JSON.stringify(current))
      const tidied = tidy ? (current.tidied || { at: now(), by, fromVersion: current.version }) : current.tidied
      const label = {
        ...clean, id: current.id, version: current.version + 1,
        createdAt: current.createdAt, createdBy: current.createdBy, updatedAt: now(), updatedBy: by,
        ...(current.source ? { source: current.source, vistaprintCreated: current.vistaprintCreated } : {}),
        ...(current.sourceId ? { sourceId: current.sourceId } : {}),
        ...(tidied ? { tidied } : {})
      }
      await setBody(KEY(id), JSON.stringify(label))
      return { label }
    })
  }

  /** Puts back the label as it was before it was tidied — a new version, nothing lost. */
  async function restoreLabel(id, by) {
    return withLock(`labels:lock:${id}`, async () => {
      const current = await getLabel(id)
      if (!current) return { missing: true }
      const before = parse(await redis('get', `labels:prev:${id}`))
      if (!before) return { nothing: true }
      const label = {
        ...sanitiseLabel(before), id: current.id, version: current.version + 1,
        createdAt: current.createdAt, createdBy: current.createdBy, updatedAt: now(), updatedBy: by,
        ...(current.source ? { source: current.source, vistaprintCreated: current.vistaprintCreated } : {})
      }
      await setBody(KEY(id), JSON.stringify(label))
      await redis('del', `labels:prev:${id}`)
      return { label }
    })
  }

  async function deleteLabel(id, by) {
    const current = await getLabel(id)
    if (!current) return { missing: true }
    await redis('lpush', 'labels:deleted', JSON.stringify({ ...current, deletedAt: now(), deletedBy: by }))
    await redis('ltrim', 'labels:deleted', '0', '49')
    await redis('srem', 'labels:index', id)
    await redis('del', KEY(id))
    return { ok: true }
  }

  /** A logo for everyone: PNG or JPEG, 2 MB at most, kept in Blob. */
  async function addLogo({ name, data }, by) {
    const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''))
    if (!m) return { error: 'Choose a PNG or JPEG picture' }
    const buf = Buffer.from(m[2], 'base64')
    if (buf.length > MAX_LOGO_BYTES) return { error: 'That picture is over 2 MB — make it smaller first' }
    const size = imageSize(buf)
    if (!size) return { error: 'That file is not a PNG or JPEG picture' }
    const type = size.type
    const label = String(name || 'Logo').replace(/\.[a-z0-9]+$/i, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Logo'
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'logo'
    const k = `${slug}-${randomBytes(3).toString('hex')}`
    const url = await put(`labels/logos/${k}.${type === 'image/png' ? 'png' : 'jpg'}`, buf, type)
    const logo = { k, name: label, w: size.w, h: size.h, type, url, addedBy: by, addedAt: now() }
    await withLock('labels:logos:lock', async () => {
      const logos = parse(await redis('get', 'labels:logos')) || {}
      logos[k] = logo
      await setBody('labels:logos', JSON.stringify(logos))
    })
    return { logo }
  }

  return { ensureSeeded, listLabels, getLabel, createLabel, saveLabel, restoreLabel, deleteLabel, addLogo, readLogos }
}

/** Width and height of a PNG or JPEG, from its bytes; null if it is neither. */
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(12) === 0x49484452) {
    return { type: 'image/png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'image/jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return null
}
