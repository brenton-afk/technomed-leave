import { readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { requireSession } from './_auth.js'

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
  const session = await requireSession(req, res)
  if (!session) return

  const slug = String(req.query.guide || '').trim()

  // No slug: the list, so the app can draw its own index rather than shipping
  // the hub page and navigating between folders inside an iframe.
  if (!slug) {
    res.setHeader('Cache-Control', 'private, max-age=300')
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

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    // Private, because it is behind a login. Cached for the session anyway:
    // these are one to two megabytes and nobody wants to pay that twice for
    // flicking back to a guide they had open a minute ago.
    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.status(200).send(html)
  } catch {
    return res.status(404).json({ error: 'That guide could not be read' })
  }
}
