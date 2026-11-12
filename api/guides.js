import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { requireSession } from './_auth.js'
import {
  getPreferences, editCard, preferenceHistory, restoreVersion, canEditPreferences
} from './_preferences.js'
import { firstNameFor, STAFF } from '../src/staffConfig.js'
import {
  listKits, kitHistory, prepareMove, confirmMove, returnKit, checkKit, getKitOrder, saveKitOrder, logKitEvent,
  saveKitDef, removeKitDef, getKitSettings, saveKitSettings, getTrayList, saveTrayList, isTrayPhotoPath, editTrayList
} from './_kits.js'
import { temporaryLink, dropboxConnectUrl, finishDropboxConnect, dropboxStatus } from './_dropbox.js'
import { randomUUID } from 'node:crypto'
import { redis } from './_redis.js'
import { resourceCatalogue, getPicks, setPick, resourcesBySystem, filesFor, openablePath } from './_resources.js'
import { sendBookingNotice, escapeHtml } from './_email.js'
import { listKitDocs, docCounts, keepKitDoc, removeKitDoc, setKitDocKind, kitDocLink, DOC_KINDS,
  dropboxCatalogue, suggestFor, searchCatalogue, linkKitDoc, proposeAgreements } from './_kitDocs.js'

// ─── Theatre guides ──────────────────────────────────────────────────────────
// Eleven field references for the systems the team carries, plus Surgeon
// Preferences. Each is one self-contained HTML page — images, fonts, styles and
// scripts all embedded, and not a single request to anywhere else. That is what
// lets them work on a hospital network that blocks most of the internet.
//
// They are served from here rather than from public/ because public/ is a CDN
// with no notion of who is asking. Surgeon Preferences names individual
// surgeons and records how each of them likes theatre set up; the people who
// wrote these were explicit that it must not be publicly reachable, and Brent's
// decision was that none of them should be.
//
// The cost of that decision is real and worth writing down: these no longer
// come off the CDN, cannot be installed to a phone's home screen, and will not
// open in an airplane-mode dead spot. If a guide is ever wanted at the scrub
// sink without a login, this is the file that has to change.

/**
 * The guides, by the slug used in the URL.
 *
 * `maker` is who manufactures the system; `distributor` is who we order it
 * from, and they are rarely the same company. Shoreline and Mariner are
 * SeaSpine, bought through Device Technologies. Firebird and LONESTAR are
 * Orthofix, bought through KT Medical. Dakota and REFORM are Precision Spine,
 * bought through E4 Surgical.
 *
 * The team thinks in distributors — it is who gets rung when a tray is short
 * and who the usage sheet is emailed to — so that is what the list is grouped
 * by. The keys are the ones _distributors.js already routes usage by, rather
 * than a second set of names that could drift away from it.
 *
 * Listed rather than discovered from the directory. A typo in a folder name
 * should show up as a missing guide here, not as a page nobody can find, and an
 * unreviewed folder appearing on disk should not become a route.
 *
 * `restricted` marks the one that names surgeons. Everything is behind the
 * login, so today it changes nothing but the wording on screen — it is here so
 * that if the others are ever opened up, this one is not opened up with them by
 * accident.
 */
export const GUIDES = [
  { slug: 'truprofile', distributor: 'device', name: 'Shoreline TruProfile ACS', maker: 'SeaSpine', group: 'Spine', file: 'truprofile/index.html', revision: 'D0000975C' },
  { slug: 'dakota', distributor: 'e4', name: 'Dakota ACDF', maker: 'Precision Spine', group: 'Spine', file: 'dakota/index.html', revision: 'LBL-STG-047 Rev C' },
  { slug: 'lonestar', distributor: 'kt', name: 'LONESTAR CSA', maker: 'Orthofix', group: 'Spine', file: 'lonestar/index.html', revision: 'OP-83-9901-US Rev AA' },
  { slug: 'athlet-ascot', distributor: 'signus', name: 'ATHLET + ASCOT', maker: 'SIGNUS', group: 'Spine', file: 'athlet-ascot/index.html' },
  { slug: 'reform-poct', distributor: 'e4', name: 'REFORM POCT', maker: 'Precision Spine', group: 'Spine', file: 'reform-poct/index.html', revision: 'LBL-STG-033 Rev A' },
  { slug: 'diplomat', distributor: 'signus', name: 'DIPLOMAT', maker: 'SIGNUS', group: 'Spine', file: 'diplomat/index.html', revision: 'Rev. 2015-08' },
  { slug: 'mariner', distributor: 'device', name: 'MARINER MIS', maker: 'SeaSpine', group: 'Spine', file: 'mariner/index.html', revision: 'RA-15122022-GT' },
  { slug: 'firebird-forza', distributor: 'kt', name: 'Firebird NXG + Forza XP', maker: 'Orthofix', group: 'Spine', file: 'firebird-forza/index.html', revision: 'NX-1706 · FX-1704' },
  { slug: 'global-plif', distributor: 'e4', name: 'Global PLIF GW', maker: 'Global Biomedica', group: 'Spine', file: 'global-plif/index.html', revision: 'Rev. 2020-05-12 v1.1' },
  // New from Aimee, 12 October. Nuvasive, so it routes under the globus key —
  // _distributors.js calls that one "Nuvasive/Globus".
  //
  // No revision: the document does not state one, and the rule here is that a
  // blank is shown rather than a number invented, since this line is how
  // anybody tells whether a guide still matches the manufacturer's current
  // document. Its own title is "XCore Corpectomy Guide" while the team says
  // "XCore", so corpectomy is in the keywords instead — that is what somebody
  // will type when they are looking for it.
  {
    slug: 'xcore-vbr',
    distributor: 'globus',
    name: 'XCore VBR',
    maker: 'NuVasive',
    group: 'Spine',
    file: 'xcore-vbr/index.html',
    keywords: 'Corpectomy · vertebral body replacement · expandable'
  },
  { slug: 'brainlab', name: 'Brainlab Navigation', maker: 'Brainlab', group: 'Navigation', file: 'brainlab/index.html' },
  { slug: 'clavicle-2.7', name: 'VA LCP Clavicle Plate 2.7', maker: 'DePuy Synthes', group: 'Orthopaedics', file: 'clavicle-2.7/index.html', revision: 'SE_825567 AF · 2025/07' },
  // Two plates in one guide — the lateral VA-LCP and the medial LCP — which
  // is why it carries two source revisions. `keywords` is not shown on the
  // card; it is there so the search finds the guide by what is inside it
  // rather than only by its name. See the search in TheatreGuides.jsx.
  {
    slug: 'prox-tib-3.5',
    name: 'Proximal Tibia Plates 3.5',
    maker: 'DePuy Synthes',
    group: 'Orthopaedics',
    file: 'prox-tib-3.5/index.html',
    revision: 'SE_858604 AA (lateral) · J5954-A (medial)',
    keywords: 'Lateral VA-LCP and medial LCP plates in one app. '
      + 'Plate selector · Technique · Screw/drill/torque · Trays · RHH small frag'
  },
  {
    slug: 'surgeon-preferences',
    name: 'Surgeon Preferences',
    maker: 'TechnoMed',
    group: 'Restricted',
    file: 'restricted/surgeon-preferences/index.html',
    restricted: true
  }
]

// Named in the hub but not yet built. Shown so the team can see what is coming
// rather than wondering whether a guide is missing or was never made.
//
// ATHLET + ASCOT and Brainlab carry no revision because their own guides do not
// state one — shown as blank rather than invented, since this line is how anyone
// tells whether a guide still matches the manufacturer's current document.
export const COMING = [
  { name: 'CYLOX ST', maker: 'SIGNUS', group: 'Spine', distributor: 'signus' }
]

const ROOT = join(process.cwd(), 'theatre-guides')

export default async function handler(req, res) {
  // Dropbox sends the browser back here with no session header of ours, so
  // this one is answered before the session check — and trusts nothing but a
  // `state` this portal issued to an admin in the last ten minutes.
  if (req.query.dropbox === 'callback') return handleDropboxCallback(req, res)

  const session = await requireSession(req, res)
  if (!session) return
  if (req.query.dropbox) return handleDropbox(req, res, session)

  // The editable surgeon preference cards (Task 18), here rather than in a
  // function of their own: the plan allows twelve and the app is at twelve.
  if (req.query.prefs) return handlePreferences(req, res, session)
  // The kit room, here for the same reason.
  if (req.query.kits) return handleKits(req, res, session)
  // Resources: each system's ARTG, surgical technique, rebate codes and tray list.
  if (req.query.resources) return handleResources(req, res, session)

  const slug = String(req.query.guide || '').trim()

  // No slug: the list, so the app can draw its own index rather than shipping
  // the hub page and navigating between folders inside an iframe.
  if (!slug) {
    // Not cached.
    //
    // It was five minutes, which is nothing on a page somebody opens twice a
    // week and everything on the afternoon a guide is added: the guide is
    // deployed, the card does not appear, and the app looks broken to the one
    // person who knows it should be there. That happened with the proximal
    // tibia guide and would have happened with every guide after it.
    //
    // There is nothing to buy back. It is a list of eleven names — under two
    // kilobytes — fetched once when the screen opens. The megabyte is the
    // guide itself, which is revalidated below rather than held for an hour.
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      guides: GUIDES.map(({ file, ...rest }) => rest),
      coming: COMING
    })
  }

  // Matched against the list, never joined from the request. A slug is a key
  // here, not a path — which is what stops `../../` from being one.
  const guide = GUIDES.find(g => g.slug === slug)
  if (!guide) return res.status(404).json({ error: 'No such guide' })

  try {
    const path = normalize(join(ROOT, guide.file))
    if (!path.startsWith(ROOT)) return res.status(400).json({ error: 'Bad path' })
    const html = await readFile(path, 'utf8')

    // ── Cached, but checked ──
    //
    // This was `max-age=3600` on the reasoning that "a slug's content never
    // changes". That was true for about a fortnight. Aimee rebuilt eight of
    // these in October — same slug, new file — and anybody who had opened one
    // in the previous hour kept the old one, with nothing on screen to say so.
    // Reported as "are you sure they updated?", which is the right question
    // to ask of a guide that still says what it said yesterday.
    //
    // An ETag keeps what the hour was buying and drops what it cost. The
    // browser still holds the megabyte; it just asks first, and the asking is
    // a 304 with no body. A rebuilt guide arrives on the next open rather
    // than within the hour.
    const etag = `"${createHash('sha1').update(html).digest('base64url')}"`
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')

    if (req.headers['if-none-match'] === etag) return res.status(304).end()

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(200).send(html)
  } catch {
    return res.status(404).json({ error: 'That guide could not be read' })
  }
}


async function handlePreferences(req, res, session) {
  res.setHeader('Cache-Control', 'no-store')
  const by = firstNameFor(session.email) || session.name || session.email
  const canEdit = canEditPreferences(session.email)
  try {
    if (req.method === 'GET') {
      if (req.query.prefs === 'history') {
        return res.status(200).json({ history: await preferenceHistory() })
      }
      return res.status(200).json({ ...(await getPreferences()), canEdit })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (!canEdit) return res.status(403).json({ error: 'Only the clinical team can change preference cards' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const saved = body.restore !== undefined
      ? await restoreVersion(body.restore, by)
      : await editCard({
        baseVersion: body.baseVersion, surgeonId: body.surgeonId,
        index: body.index === null || body.index === undefined ? null : Number(body.index),
        card: body.card === null ? null : body.card
      }, by)
    return res.status(200).json({ ...saved, canEdit })
  } catch (err) {
    if (err.code === 'stale') return res.status(409).json({ error: err.message, code: 'stale' })
    return res.status(400).json({ error: err.message })
  }
}


// ─── Kit room ────────────────────────────────────────────────────────────────
// See api/_kits.js. Anyone signed in can see kits and move them — the team
// moving kits is the whole point. Editing the list of kits and their trays is
// for admins and the clinical team; switching hospital emails on is admin only.

function hobartToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Hobart' }).format(new Date())
}

// ─── Resources (Brent, 12 Nov 2026) — see api/_resources.js ─────────────────
async function handleResources(req, res, session) {
  const what = String(req.query.resources)
  try {
    if (what === 'list' && req.method === 'GET') {
      const fresh = req.query.fresh === '1'
      const [catalogue, picks, kits] = await Promise.all([resourceCatalogue({ fresh }), getPicks(), listKits().catch(() => [])])
      const lists = kits.length ? await redis('mget', ...kits.map(k => `kits:list:${k.id}`)).catch(() => []) : []
      const withTrays = kits.map((k, i) => {
        let n = 0
        try { n = (JSON.parse(lists?.[i] || 'null')?.trays || []).length } catch { n = 0 }
        return { id: k.id, name: k.name, system: k.system, trayCount: n }
      })
      return res.status(200).json({ systems: resourcesBySystem({ catalogue, picks, kits: withTrays }), canEdit: Boolean(session?.email) })
    }
    if (what === 'files' && req.method === 'GET') {
      const catalogue = await resourceCatalogue()
      return res.status(200).json({ files: filesFor(catalogue, String(req.query.distributor || ''), String(req.query.slot || '')) })
    }
    if (what === 'open' && req.method === 'GET') {
      const path = String(req.query.path || '')
      if (!openablePath(path, await resourceCatalogue())) return res.status(404).json({ error: 'That file is not in the reference folders' })
      return res.status(200).json({ ...(await temporaryLink(path)), path })
    }
    if (what === 'pick' && req.method === 'POST') {
      const { system, slot, path } = req.body || {}
      await setPick(String(system || ''), String(slot || ''), path ? String(path) : null, await resourceCatalogue())
      return res.status(200).json({ ok: true })
    }
    return res.status(400).json({ error: 'Unknown resources action' })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Could not load the resources' })
  }
}

async function handleKits(req, res, session) {
  const staff = STAFF.find(s => s.email === session.email) || {}
  const sender = { name: staff.name || session.name || '', email: staff.email || session.email, firstName: staff.firstName }
  // Brent, 11 Nov 2026: "They don't want to rely on me to fix things for them
  // or make things available." Every member of staff can add and change kits,
  // tray lists and documents; every change is logged with who made it. Only
  // taking a kit off the list altogether, and the hospital-email switch, stay
  // with admins and the clinical team.
  const canEdit = Boolean(staff.email)
  const canRemove = Boolean(staff.isAdmin || staff.isClinicalTeam)
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const what = String(req.query.kits)
  const who = sender.firstName || sender.email
  const kitById = async id => (await listKits()).find(k => k.id === String(id || ''))
  try {
    if (what === 'list') {
      const [kits, settings, order] = await Promise.all([listKits(), getKitSettings(), getKitOrder()])
      const counts = await docCounts(kits.map(k => k.id))
      return res.status(200).json({
        kits: kits.map(k => ({ ...k, docs: counts[k.id] || { docs: 0, consignment: 0 } })),
        order, settings, canEdit, canRemove, isAdmin: Boolean(staff.isAdmin), today: hobartToday()
      })
    }
    if (what === 'docs' && req.method === 'GET') {
      return res.status(200).json({ docs: await listKitDocs(String(req.query.id || '')) })
    }
    if (what === 'doc-link' && req.method === 'GET') {
      return res.status(200).json(await kitDocLink(String(req.query.id || ''), String(req.query.doc || '')))
    }
    // Add from Dropbox: what looks like this kit's, or a search.
    if (what === 'dbx-suggest' && req.method === 'GET') {
      const kit = await kitById(req.query.id)
      if (!kit) return res.status(404).json({ error: 'No such kit' })
      const kind = ['consignment', 'traylist', 'other'].includes(String(req.query.kind)) ? String(req.query.kind) : 'consignment'
      const taken = (await listKitDocs(kit.id)).map(d => d.path)
      const catalogue = await dropboxCatalogue({ fresh: req.query.fresh === '1' })
      return res.status(200).json({ suggested: suggestFor(kit, catalogue, { kind, taken }) })
    }
    if (what === 'dbx-search' && req.method === 'GET') {
      return res.status(200).json({ files: searchCatalogue(await dropboxCatalogue(), String(req.query.q || '')) })
    }
    // Every kit at once, for an admin or the clinical team: a dry run first
    // (what it would attach, what it is unsure of), then only what was ticked.
    if (what === 'dbx-autolink' && req.method === 'GET') {
      if (!canRemove) return res.status(403).json({ error: 'Admins and the clinical team only' })
      const kits = await listKits()
      const lists = await Promise.all(kits.map(k => listKitDocs(k.id)))
      const docsByKit = Object.fromEntries(kits.map((k, i) => [k.id, lists[i]]))
      return res.status(200).json(proposeAgreements(kits, await dropboxCatalogue({ fresh: true }), docsByKit))
    }
    // The original document a tray list was read from — only a path the
    // kit's own list holds.
    if (what === 'tray-file' && req.method === 'GET') {
      const list = await getTrayList(String(req.query.id || ''))
      const paths = [...new Set((list?.trays || []).map(t => t.dropboxPath).filter(Boolean))]
      const path = paths.includes(String(req.query.path || '')) ? String(req.query.path) : paths[0]
      if (!path) return res.status(404).json({ error: 'The original of this tray list was not kept — upload it again to share it' })
      return res.status(200).json({ ...(await temporaryLink(path)), path, paths })
    }
    if (what === 'history') return res.status(200).json({ history: await kitHistory(150) })
    if (what === 'photo' && req.method === 'GET') {
      // Fetched per view and never stored, like every other Dropbox link here.
      const path = String(req.query.path || '')
      if (!isTrayPhotoPath(path)) return res.status(400).json({ error: 'Not a tray photo' })
      return res.status(200).json({ url: (await temporaryLink(path)).url })
    }
    // A tray's item pictures, all in one go when it is opened — a check sheet
    // has one beside every item, and forty requests for forty thumbnails is
    // a slow tray on hospital wifi.
    if (what === 'photos' && req.method === 'POST') {
      const paths = [...new Set((Array.isArray(body?.paths) ? body.paths : []).map(String).filter(isTrayPhotoPath))].slice(0, 400)
      const urls = {}
      for (let i = 0; i < paths.length; i += 8) {
        await Promise.all(paths.slice(i, i + 8).map(async p => {
          try { urls[p] = (await temporaryLink(p)).url } catch { /* that one shows no picture */ }
        }))
      }
      return res.status(200).json({ urls })
    }
    if (what === 'traylist' && req.method === 'GET') {
      return res.status(200).json({ list: await getTrayList(String(req.query.id || '')) })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    if (what === 'move') return res.status(200).json(await prepareMove({ ...body, today: hobartToday() }, sender))
    if (what === 'confirm') {
      return res.status(200).json(await confirmMove(body, sender, (email, from) => sendBookingNotice({
        to: email.to, cc: email.cc, subject: email.subject, text: email.text,
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5">${
          escapeHtml(email.text).replace(/\n/g, '<br>')}</div>`,
        sender: { name: from.name, email: from.email },
        label: 'Kit move'
      })))
    }
    if (what === 'return') { await returnKit(body.kitId, sender); return res.status(200).json({ ok: true }) }
    if (what === 'check') { await checkKit(body.kitId, body.at, sender.firstName || sender.email); return res.status(200).json({ ok: true }) }

    // Anyone signed in may keep a tray list up to date — "the staff have
    // freedom to make changes as the kits change". Every change is logged
    // with who made it.
    if (what === 'editlist') {
      try {
        return res.status(200).json({ list: await editTrayList(String(body.kitId || ''), body, sender.firstName || sender.email) })
      } catch (err) {
        if (err.code === 'conflict') {
          return res.status(409).json({ error: err.message, list: await getTrayList(String(body.kitId || '')) })
        }
        throw err
      }
    }
    if (what === 'doc-keep') {
      const kit = await kitById(body.kitId)
      if (!kit) return res.status(404).json({ error: 'No such kit' })
      const ours = /^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\/kitdocs\//i.test(String(body.url || ''))
      let buffer
      if (typeof body.data === 'string' && body.data) buffer = Buffer.from(body.data, 'base64')
      else if (ours) {
        const got = await fetch(body.url)
        if (!got.ok) return res.status(502).json({ error: 'The upload could not be fetched — try again' })
        buffer = Buffer.from(await got.arrayBuffer())
        // The temporary copy in the upload store, deleted once it is in
        // Dropbox — by the store's own API, so this function carries no
        // package the bundler cannot trace.
        if (process.env.BLOB_READ_WRITE_TOKEN) {
          fetch('https://blob.vercel-storage.com/delete', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`, 'Content-Type': 'application/json', 'x-api-version': '7' },
            body: JSON.stringify({ urls: [body.url] })
          }).catch(() => {})
        }
      } else return res.status(400).json({ error: 'Upload the file again' })
      const doc = await keepKitDoc(kit, { buffer, filename: body.filename, kind: body.kind }, who)
      await logKitEvent({ kind: 'doc', kitId: kit.id, kitName: kit.name, by: who, text: `${DOC_KINDS[doc.kind].label} added: ${doc.name}` })
      return res.status(200).json({ doc })
    }
    if (what === 'doc-dbx') {
      const picks = Array.isArray(body.picks) ? body.picks.slice(0, 80) : [{ kitId: body.kitId, path: body.path, kind: body.kind }]
      if (picks.length > 1 && !canRemove) return res.status(403).json({ error: 'Admins and the clinical team only' })
      const kits = await listKits()
      const linked = []
      const failed = []
      for (const pick of picks) {
        const kit = kits.find(k => k.id === String(pick.kitId || ''))
        if (!kit) { failed.push({ ...pick, error: 'No such kit' }); continue }
        try {
          const doc = await linkKitDoc(kit, { path: String(pick.path || ''), kind: pick.kind }, who)
          await logKitEvent({ kind: 'doc', kitId: kit.id, kitName: kit.name, by: who, text: `${DOC_KINDS[doc.kind]?.label || 'Document'} attached from Dropbox: ${doc.name}` })
          linked.push({ kitId: kit.id, doc })
        } catch (err) { failed.push({ kitId: pick.kitId, path: pick.path, error: err.message }) }
      }
      if (picks.length === 1 && failed.length) return res.status(400).json({ error: failed[0].error })
      return res.status(200).json({ linked, failed, doc: linked[0]?.doc })
    }
    if (what === 'doc-remove') {
      const kit = await kitById(body.kitId)
      if (!kit) return res.status(404).json({ error: 'No such kit' })
      const doc = await removeKitDoc(kit.id, String(body.docId || ''))
      await logKitEvent({ kind: 'doc', kitId: kit.id, kitName: kit.name, by: who, text: `${DOC_KINDS[doc.kind]?.label || 'Document'} taken off: ${doc.name} (still in Dropbox)` })
      return res.status(200).json({ ok: true })
    }
    if (what === 'doc-kind') {
      const doc = await setKitDocKind(String(body.kitId || ''), String(body.docId || ''), String(body.kind || ''))
      return res.status(200).json({ doc })
    }
    if (what === 'order') {
      return res.status(200).json({ order: await saveKitOrder(body.ids, who) })
    }
    if (what === 'savelist') {
      if (!canEdit) return res.status(403).json({ error: 'Sign in to change tray lists' })
      return res.status(200).json({ list: await saveTrayList(String(body.kitId || ''), body, sender.firstName) })
    }
    if (what === 'save' || what === 'remove') {
      if (!canEdit) return res.status(403).json({ error: 'Sign in to change the kit list' })
      if (what === 'remove' && !canRemove) return res.status(403).json({ error: 'Only admins and the clinical team can take a kit off the list' })
      if (what === 'save') return res.status(200).json({ kit: await saveKitDef(body.kit, sender.firstName, body.renames) })
      await removeKitDef(body.kitId, sender.firstName)
      return res.status(200).json({ ok: true })
    }
    if (what === 'settings') {
      if (!staff.isAdmin) return res.status(403).json({ error: 'Admins only' })
      return res.status(200).json(await saveKitSettings(body, sender.firstName))
    }
    return res.status(400).json({ error: 'Unknown kit action' })
  } catch (err) {
    // Every message thrown in _kits.js is a sentence for a person; nothing in
    // it carries patient detail.
    return res.status(400).json({ error: err.message || 'That did not work' })
  }
}


// ─── Connecting Dropbox (Admin → System) ─────────────────────────────────────
// See api/_dropbox.js. Same shape as Xero: an admin starts it, approves it on
// Dropbox, and comes back to the portal connected.

function dropboxRedirectUri(req) {
  if (process.env.DROPBOX_REDIRECT_URI) return process.env.DROPBOX_REDIRECT_URI
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `https://${host}/api/dropbox/callback`
}

async function handleDropbox(req, res, session) {
  const staff = STAFF.find(s => s.email === session.email)
  if (!staff?.isAdmin) return res.status(403).json({ error: 'Admins only' })
  try {
    if (req.query.dropbox === 'status') return res.status(200).json(await dropboxStatus())
    if (req.query.dropbox === 'connect') {
      const state = randomUUID()
      await redis('set', `dropbox_state:${state}`, session.email, 'EX', '600')
      return res.status(200).json({ url: dropboxConnectUrl(state, dropboxRedirectUri(req)), redirectUri: dropboxRedirectUri(req) })
    }
    return res.status(400).json({ error: 'Unknown Dropbox action' })
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
}

async function handleDropboxCallback(req, res) {
  const { code, state, error } = req.query
  if (error) return res.redirect(302, '/?dropbox=declined')
  const who = state ? await redis('get', `dropbox_state:${state}`).catch(() => null) : null
  if (!who || !code) return res.redirect(302, '/?dropbox=expired')
  await redis('del', `dropbox_state:${state}`).catch(() => {})
  try {
    const done = await finishDropboxConnect(String(code), dropboxRedirectUri(req))
    return res.redirect(302, `/?dropbox=${done.root ? 'connected' : 'connected-no-team-folder'}`)
  } catch (err) {
    console.error('Dropbox connect failed:', err.message)
    return res.redirect(302, '/?dropbox=failed')
  }
}
