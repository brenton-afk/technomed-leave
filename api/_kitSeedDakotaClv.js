// ─── The Calvary Dakota set, as it is on the shelf (Brent, 21 Nov 2026) ─────
// "The Dakota tray photos you have are from the loan kits." The set had been
// filled from the 2023 consignment agreement, whose pictures are E4's
// catalogue photos and whose trays (Instrument 1, Trials 2, Instrument 3 …)
// are no longer how Calvary packs it. Brent chose to rebuild it from the E4
// stocktake of the Calvary consignment (September 2026), and Calvary CSSD's own
// check sheets say how the shelf is packed:
//   - DAKOTA INST (CSSD, 13 May 2025, with the second Adson hook): every
//     instrument, the three drills and all nine lordosis trials in one tray;
//   - the implants as the stocktake counts them — screws, 14×12 and 16×14
//     cages, 18×15 cages;
//   - the two bed arms (the second consigned 11 Sep 2026, CSSD TT31924);
//   - two cervical retractors: the TM ACDF one (stocktake) and Ibbett 2
//     (CSSD TT31967, 14 Sep 2026).
// Quantities are what each tray should hold (the stocktake's "E4 Out",
// Calvary's CSSD quantity), not what was counted on the day. Basket liners and
// tray tags are left out; "optional" items not on Calvary's shelf (the
// angled driver 71-IN-0400, the depth tool, the Braun base) are left out.
// No prices.

const I = (code, description, qty = 1) => ({ code, description, qty, kind: 'instrument' })
const P = (code, description, qty) => ({ code, description, qty, kind: 'implant' })

export const DAKOTA_CLV_FILE = 'E4 stocktake, Calvary consignment (Sep 2026) and Calvary CSSD check sheets'

export const DAKOTA_CLV_TRAYS = [
  {
    name: 'Dakota Inst', photo: 'inst',
    lines: [
      I('71-IN-0010', 'Straight awl'),
      I('71-IN-0020', 'Angled awl'),
      I('71-IN-0720', 'Implant inserter', 2),
      I('71-IN-0030', 'Drill guide'),
      I('71-IN-0407', 'Counter torque handle assembly'),
      I('71-IN-0407A', 'Counter torque handle, implant holder'),
      I('71-IN-0410', 'Angled screwdriver assembly'),
      I('71-IN-0415', 'Short angled screwdriver assembly (T8)'),
      I('37-IN-0050', 'Implant insertion tamp'),
      I('10.598', 'Adson hook, tapered', 2),
      I('37-IN-0084', 'Mallet'),
      I('37-IN-0084A', 'Mallet head, white acrylic'),
      I('55-CH-0001', 'Modular in-line spin-cap handle', 2),
      I('55-CH-0002', 'Modular in-line ratchet handle', 2),
      I('37-IN-0060', 'Self-retaining screwdriver 180mm (T8)', 2),
      I('37-IN-0060S', 'Self-retaining screwdriver 150mm (T8)', 2),
      I('71-SP-0212', 'Bone drill 12mm'),
      I('71-SP-0214', 'Bone drill 14mm'),
      I('71-SP-0215', 'Bone drill 15mm'),
      I('71-TN-7406', 'Lordosis trial 14 x 12 - 5/6mm'),
      I('71-TN-7408', 'Lordosis trial 14 x 12 - 7/8mm'),
      I('71-TN-7410', 'Lordosis trial 14 x 12 - 9/10mm'),
      I('71-TN-7606', 'Lordosis trial 16 x 14 - 5/6mm'),
      I('71-TN-7608', 'Lordosis trial 16 x 14 - 7/8mm'),
      I('71-TN-7610', 'Lordosis trial 16 x 14 - 9/10mm'),
      I('71-TN-7806', 'Lordosis trial 18 x 15 - 6/7mm (7°)'),
      I('71-TN-7808', 'Lordosis trial 18 x 15 - 8/9mm (7°)'),
      I('71-TN-7810', 'Lordosis trial 18 x 15 - 10/11mm (7°)')
    ]
  },
  {
    name: 'Dakota Screws', photo: 'screws',
    lines: [
      P('71-DV-3512', '3.5 x 12mm self-drilling, self-tapping screw', 6),
      P('71-DV-3514', '3.5 x 14mm self-drilling, self-tapping screw', 6),
      P('71-DV-3515', '3.5 x 15mm self-drilling, self-tapping screw', 6),
      P('71-DV-3517', '3.5 x 17mm self-drilling, self-tapping screw', 6),
      P('71-DV-4012', '4.0 x 12mm self-drilling, self-tapping screw', 6),
      P('71-DV-4014', '4.0 x 14mm self-drilling, self-tapping screw', 6),
      P('71-DV-4015', '4.0 x 15mm self-drilling, self-tapping screw', 6),
      P('71-DV-4017', '4.0 x 17mm self-drilling, self-tapping screw', 6),
      P('71-TV-4012', '4.0 x 12mm blunt tip, self-tapping screw', 6),
      P('71-TV-4014', '4.0 x 14mm blunt tip, self-tapping screw', 6),
      P('71-TV-4015', '4.0 x 15mm blunt tip, self-tapping screw', 6),
      P('71-TV-4017', '4.0 x 17mm blunt tip, self-tapping screw', 6)
    ]
  },
  {
    name: 'Dakota Cages 14x12 and 16x14', photo: 'cages',
    lines: [
      P('71-AL-4206', '14 x 12 x 6mm (7°) interbody assembly', 3),
      P('71-AL-4207', '14 x 12 x 7mm (7°) interbody assembly', 3),
      P('71-AL-4208', '14 x 12 x 8mm (7°) interbody assembly', 3),
      P('71-AL-4209', '14 x 12 x 9mm (7°) interbody assembly', 2),
      P('71-AL-4210', '14 x 12 x 10mm (7°) interbody assembly', 1),
      P('71-AL-6406', '16 x 14 x 6mm (7°) interbody assembly', 2),
      P('71-AL-6407', '16 x 14 x 7mm (7°) interbody assembly', 4),
      P('71-AL-6408', '16 x 14 x 8mm (7°) interbody assembly', 3),
      P('71-AL-6409', '16 x 14 x 9mm (7°) interbody assembly', 2),
      P('71-AL-6410', '16 x 14 x 10mm (7°) interbody assembly', 1)
    ]
  },
  {
    name: 'Dakota Cages 18x15', photo: 'cages18',
    lines: [
      P('71-AL-8506', '18 x 15 x 6mm (7°) interbody assembly', 3),
      P('71-AL-8507', '18 x 15 x 7mm (7°) interbody assembly', 3),
      P('71-AL-8508', '18 x 15 x 8mm (7°) interbody assembly', 3),
      P('71-AL-8509', '18 x 15 x 9mm (7°) interbody assembly', 1),
      P('71-AL-8510', '18 x 15 x 10mm (7°) interbody assembly', 1),
      I('E4-1146', '6/7mm trial', 2)
    ]
  },
  {
    name: 'Dakota Bed Arm 1', photo: 'bedarm',
    lines: [
      I('ML-0060', 'Articulating angled clamp arm (retractor arm)'),
      I('ML-0060A', 'Clamp arm rack key'),
      I('ML-0021', 'Rotating table clamp'),
      I('ML-0021A', 'Clamp T-bar screw')
    ]
  },
  {
    name: 'Dakota Bed Arm 2', photo: 'bedarm',
    lines: [
      I('ML-0060', 'Articulating angled clamp arm (retractor arm)'),
      I('ML-0060A', 'Clamp arm rack key'),
      I('ML-0021', 'Rotating table clamp'),
      I('ML-0021A', 'Clamp T-bar screw')
    ]
  },
  {
    name: 'Dakota Cervical Retractor (TM ACDF)', photo: 'retractor_tm',
    lines: [
      I('CS-0108', 'TeDan transverse retractor base'),
      I('LS-0451', 'T-handle blade adjuster key (purple)'),
      I('BW010R', 'Blade handle, blue', 2),
      I('BG-35-II', 'Blunt retractor blade 35mm', 2),
      I('BG-40-II', 'Blunt retractor blade 40mm', 2),
      I('BG-45-II', 'Blunt retractor blade 45mm', 2),
      I('BG-50-II', 'Blunt retractor blade 50mm', 2),
      I('BG-55-II', 'Blunt retractor blade 55mm', 2),
      I('BG-60-II', 'Blunt retractor blade 60mm', 2),
      I('BG-65-II', 'Blunt retractor blade 65mm', 2)
    ]
  },
  {
    name: 'Dakota Cervical Retractor Ibbett 2', photo: 'retractor_ibbett',
    lines: [
      I('BW010R', 'Blade handle, blue', 2),
      I('LS-0451', 'T-handle blade adjuster key'),
      I('CS-0108A', 'TeDan transverse retractor side arm with pivot'),
      I('CS-0108', 'TeDan transverse retractor with pivoting arm'),
      I('BG-35-II', 'Blunt retractor blade 35mm', 2),
      I('BG-40-II', 'Blunt retractor blade 40mm', 2),
      I('BG-45-II', 'Blunt retractor blade 45mm', 2),
      I('BG-50-II', 'Blunt retractor blade 50mm', 2),
      I('BG-55-II', 'Blunt retractor blade 55mm', 2),
      I('BG-60-II', 'Blunt retractor blade 60mm', 2),
      I('BG-65-II', 'Blunt retractor blade 65mm', 2)
    ]
  }
]

/**
 * The new list for the Calvary set: these trays, in this order, replacing the
 * old ones (which are returned to be kept as deleted). A line under repair on
 * an old tray of the same name keeps its repair mark. Pure.
 */
export function plannedDakotaClv(current, trays = DAKOTA_CLV_TRAYS) {
  const before = current?.trays || []
  const next = trays.map(t => {
    const was = before.find(b => String(b.name).toLowerCase() === t.name.toLowerCase())
    const lines = t.lines.map(l => {
      const r = was?.lines?.find(x => x.repair && x.code === l.code)
      return r ? { ...l, repair: r.repair } : { ...l }
    })
    return { name: t.name, file: DAKOTA_CLV_FILE, lines }
  })
  const removed = before.filter(b => !trays.some(t => t.name.toLowerCase() === String(b.name).toLowerCase()))
  return { trays: next, removed }
}

const safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

export async function runDakotaClv(deps = {}) {
  const { redis, redisSetBody } = deps.redisMod || await import('./_redis.js')
  const { getDefs, getTrayList, addHistory } = deps.kits || await import('./_kits.js')
  const upload = deps.upload || (await import('./_dropbox.js')).uploadFile
  const { PHOTOS } = deps.photos || await import('./_kitSeedDakotaClvPhotos.js')
  const by = 'Claude (Calvary Dakota — E4 stocktake and CSSD sheets)'
  const defs = await getDefs()
  const kit = defs.find(k => String(k.system || '').toLowerCase() === 'dakota' && k.home === 'CLV' && k.kind !== 'floating')
  if (!kit) return null
  const current = await getTrayList(kit.id)
  const plan = plannedDakotaClv(current)
  // Photos one at a time, three tries each (Dropbox refuses several writes at once).
  for (const t of DAKOTA_CLV_TRAYS) {
    const data = PHOTOS[t.photo]
    if (!data) continue
    const path = `/Tray Lists/Tray Photos/Dakota Calvary/${safe(t.name)}.jpg`
    for (let a = 0; a < 3; a += 1) {
      try {
        await upload(path, Buffer.from(data, 'base64'))
        plan.trays = plan.trays.map(x => (x.name === t.name ? { ...x, photo: path } : x))
        break
      } catch { await new Promise(r => setTimeout(r, process.env.VITEST ? 0 : 1500 * (a + 1))) }
    }
  }
  await redisSetBody(`kits:list:${kit.id}`, JSON.stringify({ ...(current || {}), trays: plan.trays,
    source: { file: DAKOTA_CLV_FILE, hospital: 'CLV', by, at: new Date().toISOString() } }))
  for (const t of plan.removed) {
    await redis('lpush', `kits:list:deleted:${kit.id}`, JSON.stringify({ ...t, deletedBy: by, deletedAt: new Date().toISOString() })).catch(() => {})
  }
  const nowDefs = await getDefs()
  await redisSetBody('kits:defs', JSON.stringify(nowDefs.map(k => (k.id === kit.id ? { ...k, trays: plan.trays.map(t => t.name) } : k))))
  await addHistory({ kind: 'edit', kitId: kit.id, kitName: kit.name, by,
    text: `Calvary Dakota rebuilt as on the shelf: ${plan.trays.map(t => t.name).join(', ')}`
      + (plan.removed.length ? ` · taken off (kept): ${plan.removed.map(t => t.name).join(', ')}` : '') })
  return { kitId: kit.id, trays: plan.trays.map(t => t.name), removed: plan.removed.map(t => t.name) }
}
