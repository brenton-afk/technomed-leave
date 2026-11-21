// ─── Who makes each system, and its picture (Brent, 21 Nov 2026) ────────────
// "Use the imagery from the theatre guides of each of the systems to put a
// small icon and a small company logo on the kit board main page" — option B
// of the mock-up (claude.ai/artifact/Mc1sUce8kyQEGGFGHh8Uuc): a picture across
// the top of each tile and the maker above the name — as its logo where we
// have one (Brent, 21 Nov 2026: a logo in the picture's corner covered the
// product), else its name in its colour. Pictures are the product shots from the theatre guides, in
// public/kit-art; a real logo only where a guide carries one (Brainlab,
// Precision Spine, Global Biomedica) and, from Brent's own files (21 Nov
// 2026), SeaSpine and Orthofix — SIGNUS and the rest are the maker's name in
// its colour until we have the files. Brent's product shots replaced the guide
// pictures for Mariner, Shoreline, Diplomat, Dakota and added MOBIS (the
// curved ST-Line cage), CYLOX and Forza XP. A system with no picture shows its initial.
// To change a picture, replace the file in public/kit-art (240 × 240 JPEG).

const ART = name => `/kit-art/${name}`

const MAKERS = {
  seaspine: { name: 'SeaSpine', ink: '#b8500e', logo: ART('logo-seaspine.png'), logoBg: '#ffffff', logoAspect: 5.25 },
  signus: { name: 'SIGNUS', ink: '#c8102e', logo: ART('logo-signus.png'), logoBg: '#ffffff', logoAspect: 2.66 },
  precision: { name: 'Precision Spine', ink: '#1f3c88', logo: ART('logo-precision-spine.png'), logoBg: '#ffffff', logoAspect: 3.12 },
  global: { name: 'Global Biomedica', ink: '#3f7d2c', logo: ART('logo-global-biomedica.png'), logoBg: '#ffffff', logoAspect: 3.07 },
  orthofix: { name: 'Orthofix', ink: '#003da5', logo: ART('logo-orthofix.png'), logoBg: '#ffffff', logoAspect: 2.8 },
  nuvasive: { name: 'NuVasive', ink: '#6b2d8f' },
  globus: { name: 'Globus Medical', ink: '#0b4f8a' },
  brainlab: { name: 'Brainlab', ink: '#3d4a5c', logo: ART('logo-brainlab.png'), logoBg: '#3d4a5c', logoAspect: 1.4 },
  technomed: { name: 'TechnoMed', ink: '#0f6f60', logo: ART('logo-technomed.png'), logoBg: '#ffffff', logoAspect: 4.25 },
  arthrex: { name: 'Arthrex', ink: '#1f2a37', logo: ART('logo-arthrex.png'), logoBg: '#ffffff', logoAspect: 3.38 },
  newclip: { name: 'Newclip Technics', ink: '#1f2a37', logo: ART('logo-newclip.png'), logoBg: '#ffffff', logoAspect: 3.92 },
  ausbiotech: { name: 'Australian Biotechnologies', ink: '#222222', logo: ART('logo-ausbiotech.png'), logoBg: '#ffffff', logoAspect: 3.0 },
  synthes: { name: 'DePuy Synthes', ink: '#c8102e' }
}

// First match wins; specific before general.
const RULES = [
  [/outrigger/, 'seaspine', 'mariner-outrigger.jpg'],
  [/mariner/, 'seaspine', 'mariner.jpg'],
  [/shoreline|truprofile/, 'seaspine', 'shoreline.jpg'],
  [/fathom/, 'seaspine', 'fathom.jpg'],
  [/diplomat/, 'signus', 'diplomat.jpg'],
  [/ascot/, 'signus', 'ascot.jpg'],
  [/athlet/, 'signus', 'athlet.jpg'],
  [/cylox/, 'signus', 'cylox.jpg'],
  [/mobis/, 'signus', 'mobis.jpg'],
  [/cerc+ess/, 'signus', 'cercess.jpg'],
  [/signus/, 'signus', null],
  [/dakota/, 'precision', 'dakota.jpg'],
  [/reform/, 'precision', 'reform.jpg'],
  // The ALIF is Catenary (Brent, 21 Nov 2026), Global Biomedica's.
  [/catenary|alif/, 'global', 'catenary.jpg'],
  [/global|bmd/, 'global', 'global-plif.jpg'],
  [/lonestar/, 'orthofix', 'lonestar.jpg'],
  [/forza/, 'orthofix', 'forza.jpg'],
  [/firebird/, 'orthofix', 'firebird.jpg'],
  [/orthofix/, 'orthofix', null],
  [/nuvasive|xcore/, 'nuvasive', 'nuvasive.jpg'],
  [/reline|globus/, 'globus', null],
  [/brainlab|airo/, 'brainlab', 'brainlab.jpg'],
  [/arthrex|mini drill|drill saw/, 'arthrex', 'arthrex-drill.jpg'],
  [/newclip/, 'newclip', null],
  [/boost|ultrafib/, 'ausbiotech', 'boost.jpg'],
  [/synthes|clavicle|tibia/, 'synthes', null],
  [/^tm\b|technomed/, 'technomed', null]
]

// Logos come in every shape — SeaSpine is long and flat, Global and Orthofix
// are stacked — so one height makes the wide ones loud and the stacked ones
// small (Brent, 21 Nov 2026: "Make the logos for the company names consistent
// sizes where possible"). Each is drawn to the same area instead: height from
// its aspect, kept between 14 and 24px. Files are trimmed to their edges.
const LOGO_AREA = 1300
export const logoHeight = aspect => Math.round(Math.max(14, Math.min(24, Math.sqrt(LOGO_AREA / (aspect || 3)))))

/** The tile's look for a system: { maker, ink, logo, logoBg, pic, initial }. Pure. */
export function brandFor(systemName) {
  const n = String(systemName || '').toLowerCase()
  const hit = RULES.find(([re]) => re.test(n))
  const maker = hit && hit[1] ? MAKERS[hit[1]] : null
  const initial = String(systemName || '?').replace(/^TM\s+/i, '').trim().charAt(0).toUpperCase() || '?'
  return {
    maker: maker?.name || '', ink: maker?.ink || '', logo: maker?.logo || '', logoBg: maker?.logoBg || '',
    logoH: maker?.logo ? logoHeight(maker.logoAspect) : 0,
    pic: hit && hit[2] ? ART(hit[2]) : '', initial
  }
}

// What the kit is called on screen, where it differs from its record (Brent,
// 21 Nov 2026: "the drill saw mini 300"). Display only — bookings, agreements
// and moves keep the system's own name.
const DISPLAY = { 'arthrex mini drill 300': 'Arthrex Drill Saw Mini 300' }
export const displayName = name => DISPLAY[String(name || '').trim().toLowerCase()] || String(name || '')

// A tile whose logo already says the maker does not say it again in words
// (Brent, same day: "Don't double up with Newclip logo and then Newclip the
// word"): "NewClip Trans-Articular Screw" → "Trans-Articular Screw".
const SAID_BY_LOGO = /^(newclip|arthrex|orthofix)\s+/i
export function tileName(name) {
  const shown = displayName(name)
  if (!brandFor(name).logo) return shown
  const rest = shown.replace(SAID_BY_LOGO, '').trim()
  return rest || shown
}
