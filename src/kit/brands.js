// ─── Who makes each system, and its picture (Brent, 21 Nov 2026) ────────────
// "Use the imagery from the theatre guides of each of the systems to put a
// small icon and a small company logo on the kit board main page" — option B
// of the mock-up (claude.ai/artifact/Mc1sUce8kyQEGGFGHh8Uuc): a picture across
// the top of each tile, the maker's logo in its corner, the maker above the
// name. Pictures are the product shots from the theatre guides, in
// public/kit-art; a real logo only where a guide carries one (Brainlab,
// Precision Spine, Global Biomedica) — the rest are the maker's name in its
// colour until we have the files. A system with no picture shows its initial.
// To change a picture, replace the file in public/kit-art (240 × 240 JPEG).

const ART = name => `/kit-art/${name}`

const MAKERS = {
  seaspine: { name: 'SeaSpine', ink: '#b8500e' },
  signus: { name: 'SIGNUS', ink: '#c8102e' },
  precision: { name: 'Precision Spine', ink: '#3d4a5c', logo: ART('logo-precision-spine.png'), logoBg: '#111111' },
  global: { name: 'Global Biomedica', ink: '#3f7d2c', logo: ART('logo-global-biomedica.png'), logoBg: '#ffffff' },
  orthofix: { name: 'Orthofix', ink: '#003da5' },
  nuvasive: { name: 'NuVasive', ink: '#6b2d8f' },
  globus: { name: 'Globus Medical', ink: '#0b4f8a' },
  brainlab: { name: 'Brainlab', ink: '#3d4a5c', logo: ART('logo-brainlab.png'), logoBg: '#3d4a5c' },
  technomed: { name: 'TechnoMed', ink: '#0f6f60' },
  arthrex: { name: 'Arthrex', ink: '#1f2a37' },
  synthes: { name: 'DePuy Synthes', ink: '#c8102e' }
}

// First match wins; specific before general.
const RULES = [
  [/outrigger/, 'seaspine', 'mariner-outrigger.jpg'],
  [/mariner/, 'seaspine', 'mariner.jpg'],
  [/shoreline|truprofile/, 'seaspine', 'shoreline.jpg'],
  [/fathom/, 'seaspine', 'fathom.jpg'],
  [/diplomat/, 'signus', 'diplomat.jpg'],
  [/athlet|ascot/, 'signus', 'athlet.jpg'],
  [/cylox|mobis|signus/, 'signus', null],
  [/dakota/, 'precision', 'dakota.jpg'],
  [/reform/, 'precision', 'reform.jpg'],
  [/global|bmd/, 'global', 'global-plif.jpg'],
  [/lonestar/, 'orthofix', 'lonestar.jpg'],
  [/firebird|forza|orthofix/, 'orthofix', null],
  [/nuvasive|xcore/, 'nuvasive', 'nuvasive.jpg'],
  [/reline|globus/, 'globus', null],
  [/brainlab|airo/, 'brainlab', 'brainlab.jpg'],
  [/arthrex/, 'arthrex', null],
  [/synthes|clavicle|tibia/, 'synthes', null],
  [/^tm\b|technomed/, 'technomed', null]
]

/** The tile's look for a system: { maker, ink, logo, logoBg, pic, initial }. Pure. */
export function brandFor(systemName) {
  const n = String(systemName || '').toLowerCase()
  const hit = RULES.find(([re]) => re.test(n))
  const maker = hit ? MAKERS[hit[1]] : null
  const initial = String(systemName || '?').replace(/^TM\s+/i, '').trim().charAt(0).toUpperCase() || '?'
  return {
    maker: maker?.name || '', ink: maker?.ink || '', logo: maker?.logo || '', logoBg: maker?.logoBg || '',
    pic: hit && hit[2] ? ART(hit[2]) : '', initial
  }
}
