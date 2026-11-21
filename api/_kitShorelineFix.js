// ─── Shoreline, as the trays are on the shelf now (Brent, 21 Nov 2026) ──────
// "Shoreline is the main one that needs work. The photos don't match … you
// still have trials separate from instruments, but everything has been merged
// into one instrument tray with a DNO tray as back up."
//
// Calvary (Gerardo Lacapra, 29 Oct 2026): the two Trials trays left
// circulation, their contents went into Shoreline Inst 1 and Inst 2, a new
// Shoreline Extras 1 was made, and the Plate & Screw trays were renamed
// "Shoreline Plate & Screw 1 / 2". Its earlier photos were close-ups of the old
// trials and inserters, from an older agreement — they go with those trays.
//
// RHH (Mat's updated agreement, 20 Nov 2026, which Kirsty confirmed matches the
// trays and their photos): Shoreline Instruments holds the trials, Shoreline
// Instruments Extras DNO is the back-up, and the variable drill guide is one,
// not two.
//
// Every tray taken off is kept in kits:list:deleted:{kit}, as Delete this tray
// does, so nothing is lost. Lines keep anything else they carry (a repair).

const TRIALS_OR_INSERTION = /\btrials?\b|\binsertion\b/i
const PLATE = /plate/i
const STERILE = /sterile|interbod/i

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

/**
 * The new tray list for one Shoreline set. Pure.
 * `target` are the trays the set must have now, in order; each is
 * { name, lines, photo?, keepIfFilled?, match? }: an existing tray matched by
 * name (or `match`) keeps its own lines when `keepIfFilled`, else is replaced.
 * Trays named trials or insertion go; anything else on the list is kept.
 * Returns { trays, removed, photoNeeded: [names] }.
 */
export function plannedShoreline(current, target) {
  const before = current?.trays || []
  const used = new Set()
  const trays = []
  const photoNeeded = []
  for (const t of target) {
    const i = before.findIndex((b, n) => !used.has(n) && (sameName(b.name, t.name) || (t.match && t.match.test(b.name))))
    const was = i >= 0 ? before[i] : null
    if (i >= 0) used.add(i)
    if (was && t.keepIfFilled && (was.lines || []).length) {
      const photo = was.photo || null
      trays.push({ ...was, name: t.name, ...(photo ? { photo } : {}) })
      if (!photo && t.photo) photoNeeded.push(t.name)
    } else {
      trays.push({ name: t.name, file: t.file || '', lines: t.lines.map(l => ({ ...l })) })
      if (t.photo) photoNeeded.push(t.name)
    }
  }
  const removed = []
  before.forEach((b, n) => {
    if (used.has(n)) return
    if (TRIALS_OR_INSERTION.test(b.name)) removed.push(b)
    else trays.push(b)
  })
  return { trays, removed, photoNeeded }
}

/** The RHH Instruments tray from the agreement, with one variable drill guide. */
export function rhhInstrumentLines(lines) {
  return lines.map(l => (/86-0020$/.test(l.code) && /drill guide/i.test(l.description) ? { ...l, qty: 1 } : l))
}

const safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

export async function runShorelineFix(deps = {}) {
  const { redis, redisSetBody } = deps.redisMod || await import('./_redis.js')
  const { getDefs, getTrayList, addHistory } = deps.kits || await import('./_kits.js')
  const upload = deps.upload || (await import('./_dropbox.js')).uploadFile
  const { AGREEMENTS, PHOTO_LOADERS } = deps.data || await import('./_kitAgreementData.js')
  const { SHORELINE_CLV_TRAYS, SHORELINE_CLV_FILE } = deps.seed || await import('./_kitSeedShorelineClv.js')
  const by = 'Claude (Shoreline trays as they are now)'

  const clvDoc = AGREEMENTS.find(a => a.doc === 'clv-shoreline')
  const rhhDoc = AGREEMENTS.find(a => a.doc === 'rhh-shoreline')
  const photosOf = async doc => { try { return (await PHOTO_LOADERS[doc]()).PHOTOS || {} } catch { return {} } }
  const clvPhotos = await photosOf('clv-shoreline')
  const rhhPhotos = await photosOf('rhh-shoreline')

  const defs = await getDefs()
  const sets = home => defs.filter(k => String(k.system || '').toLowerCase() === 'shoreline' && k.home === home && k.kind !== 'floating')
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))

  const plateFrom = n => clvDoc?.trays.find(t => PLATE.test(t.name) && (t.set || 1) === n) || clvDoc?.trays.find(t => PLATE.test(t.name))
  const clvTarget = n => {
    const seedTray = name => SHORELINE_CLV_TRAYS.find(t => t.name === name)
    const plate = plateFrom(n)
    const list = [
      { ...seedTray(`Shoreline Inst ${n}`), file: SHORELINE_CLV_FILE },
      // The plate caddy photo is the same tray at both sets.
      { name: `Shoreline Plate & Screw ${n}`, lines: plate?.lines || [], keepIfFilled: true, match: PLATE,
        file: clvDoc?.agreement?.name || '', photo: 'p5_1.jpg', photos: clvPhotos }
    ]
    if (n === 1) list.push({ ...seedTray('Shoreline Extras 1'), file: SHORELINE_CLV_FILE })
    return list.filter(t => t.name && t.lines.length)
  }
  const rhhTarget = () => {
    const tray = name => rhhDoc?.trays.find(t => t.name === name)
    const inst = tray('Shoreline Instruments')
    const dno = tray('Shoreline Instruments Extras DNO')
    const plate = tray('Shoreline Plate & Screw')
    const file = rhhDoc?.agreement?.name || ''
    return [
      inst && { name: inst.name, lines: rhhInstrumentLines(inst.lines), match: /^shoreline inst(ruments)?$|^shoreline inst\b(?!.*(extra|dno))/i, file, photo: inst.photo, photos: rhhPhotos },
      dno && { name: dno.name, lines: dno.lines, match: /extra|dno/i, file, photo: dno.photo, photos: rhhPhotos },
      plate && { name: plate.name, lines: plate.lines, keepIfFilled: true, match: PLATE, file, photo: plate.photo, photos: rhhPhotos }
    ].filter(Boolean)
  }

  const done = []
  for (const [home, targetFor] of [['CLV', clvTarget], ['RHH', () => rhhTarget()]]) {
    for (const [i, kit] of sets(home).entries()) {
      const n = i + 1
      if (home === 'CLV' && n > 2) continue
      const target = targetFor(n)
      if (!target.length) continue
      const current = await getTrayList(kit.id)
      const plan = plannedShoreline(current, target)
      // Photos, one at a time (Dropbox refuses several writes at once).
      for (const name of plan.photoNeeded) {
        const t = target.find(x => x.name === name)
        const data = t?.photos?.[t.photo]
        if (!data) continue
        const path = `/Tray Lists/Tray Photos/${safe(kit.name)}/${safe(name)}.jpg`
        for (let a = 0; a < 3; a += 1) {
          try {
            await upload(path, Buffer.from(data, 'base64'))
            plan.trays = plan.trays.map(x => (x.name === name ? { ...x, photo: path } : x))
            break
          } catch { await new Promise(r => setTimeout(r, process.env.VITEST ? 0 : 1500 * (a + 1))) }
        }
      }
      // Sterile implants stay at the end, as on the shelf.
      plan.trays = [...plan.trays.filter(t => !STERILE.test(t.name)), ...plan.trays.filter(t => STERILE.test(t.name))]
      const key = `kits:list:${kit.id}`
      await redisSetBody(key, JSON.stringify({ ...(current || {}), trays: plan.trays,
        source: { ...(current?.source || {}), by, at: new Date().toISOString() } }))
      for (const t of plan.removed) {
        await redis('lpush', `kits:list:deleted:${kit.id}`, JSON.stringify({ ...t, deletedBy: by, deletedAt: new Date().toISOString() })).catch(() => {})
      }
      const nowDefs = await getDefs()
      await redisSetBody('kits:defs', JSON.stringify(nowDefs.map(k => (k.id === kit.id ? { ...k, trays: plan.trays.map(t => t.name) } : k))))
      await addHistory({ kind: 'edit', kitId: kit.id, kitName: kit.name, by,
        text: `Shoreline trays brought up to date: ${plan.trays.map(t => t.name).join(', ')}`
          + (plan.removed.length ? ` · taken off (kept): ${plan.removed.map(t => t.name).join(', ')}` : '') })
      done.push({ kitId: kit.id, trays: plan.trays.map(t => t.name), removed: plan.removed.map(t => t.name) })
    }
  }
  return done
}
