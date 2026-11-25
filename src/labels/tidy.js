// ─── Tidy all labels: one house style (Brent, 25 Nov 2026) ─────────────────
// "Sweep all the labels in the portal and make all the fonts, sizes,
// orientations etc consistent across the board." From the mock-ups he chose
// A (claude.ai/artifact/3vCGEyKmTBgDQgTXfLaK1p): TechnoMed's logo top left,
// the maker's logo(s) top right — trimmed of blank space and sized to cover
// about the same area, a square one capped at the row's height — the product
// name centred in the maker's colour, black description and size beneath, a
// fine line in the maker's colour, then REF on the left and REBATE on the
// right (REBATE only where there is a code: fascial blades, K-wires and
// guidewires have none). Mulish throughout, fixed sizes, squeezed by fit-to-
// box when too long. Placeholder dots become a write-in line (____).
//
// Device Technologies no longer distributes SeaSpine from next year: their
// logo comes off every label. Screw labels keep a size-colour band on the
// left edge, 4 mm, full height — Diplomat 6.5 is Mariner's yellow and 7.5 a
// royal blue; Mariner's colours are Brent's (4.5 dark grey … 10.5 purple).
//
// Pure: `tidyLabel(label, logos)` reads what a label says and rebuilds it.
// It never invents a REF or a rebate code; what it could not read is said in
// `warnings`, and the person sees every label before and after.

import { hasOwnSize, trimOffset, TRIM_W, TRIM_H, MM_PER_PT, FABRIC_SIZE_MULT, itemText } from './model.js'

export const TIDY_VERSION = 1

/** Each maker: the words before the system, its colour, the logos on the right. */
export const MAKERS = {
  signus: { word: 'SIGNUS', accent: '#c8102e', logos: ['signus'] },
  seaspine: { word: 'SEASPINE', accent: '#e8641c', logos: ['seaspine'] },
  e4: { word: 'E4 SURGICAL', accent: '#2c4f7c', logos: ['e4'] },
  reform: { word: 'PRECISION SPINE', accent: '#1d6f8a', logos: ['reform', 'e4'] },
  orthofix: { word: 'ORTHOFIX', accent: '#0b4f9c', logos: ['orthofix', 'kt'] }
}
const HOUSE_ACCENT = '#042746'

/** A system's name, the same on every one of its labels. */
const SYSTEMS = [
  { re: /diplomat/i, maker: 'signus', name: () => 'SIGNUS DIPLOMAT™' },
  { re: /mariner/i, maker: 'seaspine', name: t => (/\bMIS\b/i.test(t) ? 'SEASPINE MARINER MIS' : 'SEASPINE MARINER') },
  { re: /shoreline/i, maker: 'seaspine', name: () => 'SEASPINE SHORELINE® ACS' },
  { re: /dakota/i, maker: 'e4', name: () => 'E4 SURGICAL DAKOTA' },
  { re: /reform/i, maker: 'reform', name: () => 'PRECISION SPINE REFORM' },
  { re: /lonestar/i, maker: 'orthofix', name: () => 'ORTHOFIX LONESTAR®' },
  { re: /firebird/i, maker: 'orthofix', name: () => 'ORTHOFIX FIREBIRD® NXG' },
  { re: /forza/i, maker: 'orthofix', name: () => 'ORTHOFIX FORZA® XP' }
]

/**
 * The seed logos' own blank space (measured once from the files) and their
 * shape once trimmed. A logo added later is used whole.
 */
export const LOGO_TRIM = {
  seaspine: { crop: { l: 0.037, r: 0.031, t: 0.4, b: 0.368 }, aspect: 5.215 },
  kt: { crop: { l: 0.016, r: 0.016, t: 0.025, b: 0.033 }, aspect: 1.07 },
  technomed: { crop: { l: 0.024, r: 0.026, t: 0.062, b: 0.067 }, aspect: 4.362 },
  signus: { crop: { l: 0.01, r: 0.009, t: 0.029, b: 0.029 }, aspect: 3.034 },
  e4: { crop: null, aspect: 3.0 },
  orthofix: { crop: { l: 0.004, r: 0.003, t: 0.04, b: 0.008 }, aspect: 3.721 },
  reform: { crop: { l: 0.078, r: 0.099, t: 0.081, b: 0.081 }, aspect: 1.925 }
}
/** The small copies of two logos are the same picture. */
const SAME_LOGO = { 'reform-small': 'reform', 'e4-small': 'e4' }
const DROPPED_LOGOS = new Set(['device'])

// Layout, in mm from the trim's top-left corner (the finished 68 × 21 mm).
const EDGE = 1.8
const BAND_W = 4
const LOGO_TOP = 0.8
const LOGO_ROW = 5.0
const LOGO_AREA = 50 // mm² — TechnoMed at 3.4 mm high
const LOGO_MIN = 2.6
const LOGO_GAP = 1.5
const BLOCK_TOP = 6.1
const BLOCK_BOTTOM = 15.7
const RULE_FROM_BOTTOM = 5.0
const RULE_H = 0.15
const RULE_INSET = 4.2
const REF_FROM_BOTTOM = 1.4
const NAME_PT = 8
const BODY_PT = 7
const REF_PT = 7
const LINE_LH = 1.15
const BLACK = '#000000'
const FONT = 'Mulish'

/** Diplomat pedicle screws and every Mariner screw, by diameter. */
export const SCREW_COLOURS = {
  signus: { 4.5: '#aaaaaa', 5.5: '#a41e63', 6.5: '#fddb31', 7.5: '#2346c8', 8.5: '#a45800', 9.5: '#4cd43b' },
  seaspine: { 4.5: '#4a4f57', 5.5: '#8e1468', 6.5: '#1f2d6e', 7.5: '#2e9b45', 8.5: '#fddb31', 9.5: '#1caade', 10.5: '#4a117d' }
}

const round = (v, p = 3) => Math.round(v * 10 ** p) / 10 ** p
const lineHeight = pt => pt * MM_PER_PT * FABRIC_SIZE_MULT

// ── Reading a label ────────────────────────────────────────────────────────

/** Placeholder dots or underlines → one write-in line. */
export function writeIn(s) {
  return String(s || '')
    .replace(/[.…]{2,}/g, '____')
    .replace(/_{2,}/g, '____')
    .replace(/(?:____\s*){2,}/g, '____ ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A size line in one form: "4.5 × ____ mm", "Ø3.5 × ____ mm", "____ × 10 × 24 mm". */
export function tidySize(raw) {
  let s = String(raw || '').replace(/[.…]{2,}/g, ' ____ ').replace(/_{2,}/g, ' ____ ').replace(/ {3,}/g, ' ____ ')
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (/^x$/i.test(s)) return '____ × ____ mm'
  if (/^mm$/i.test(s)) return '____ mm'
  s = s.replace(/(\d)\s*mm\b/gi, '$1 mm')
  s = s.replace(/(^|\s)[xX×](?=\s|$)/g, '$1×')
  if (/^×/.test(s)) s = `____ ${s}`
  if (/×$/.test(s)) s = `${s} ____ mm`
  if (/^____$/.test(s)) s = '____ mm'
  s = s.replace(/×\s*____\s*$/, '× ____ mm').replace(/____\s+mm\s+mm/, '____ mm')
  return s.replace(/(?:____\s*){2,}/g, '____ ').replace(/\s+/g, ' ').trim()
}

function splitRef(line) {
  const at = line.search(/\brebate\b/i)
  const refPart = at >= 0 ? line.slice(0, at) : line
  const rebate = (/\brebate\s*(?:code)?\s*[:.]?\s*([A-Z]{2}\s?\d{2,4}[A-Z]?)/i.exec(line)?.[1] || '').replace(/\s/g, '').toUpperCase()
  const ref = writeIn(refPart.replace(/^\s*ref\s*[:.]?\s*/i, '')).replace(/(\S)\(/g, '$1 (')
  return { ref, rebate }
}

/** A line that gives a size: digits, mm, a lone x, or a write-in gap. */
const SIZE_LIKE = /\d|\bmm\b|^\s*[xX×]\s*$|_{2}|\.{2}|\s{3}/

function systemOf(text) {
  return SYSTEMS.find(s => s.re.test(text)) || null
}

/** What a label says: its system, description, size, REF(s), rebate, logos and bands. */
export function readLabel(label) {
  const items = label?.items || []
  const off = trimOffset(label)
  const lines = []
  for (const it of items.filter(i => i.t === 'txt').sort((a, b) => a.y - b.y || a.x - b.x)) {
    itemText(it).split('\n').forEach((t, i) => {
      if (t.trim()) lines.push({ text: t, y: it.y + i, x: it.x })
    })
  }
  const refs = []
  let rebate = ''
  let systemLine = null
  const rest = []
  for (const l of lines) {
    if (/\bref\b/i.test(l.text) && /\bref\s*[:.]?\s*\S/i.test(l.text)) {
      const r = splitRef(l.text)
      if (r.ref) refs.push(r.ref)
      if (r.rebate) rebate = rebate || r.rebate
    } else if (/\brebate\b/i.test(l.text)) {
      rebate = rebate || splitRef(l.text).rebate
    } else if (!systemLine && l.text.trim().length <= 30 && systemOf(l.text)) {
      systemLine = l.text.trim()
    } else {
      rest.push(l.text.trim())
    }
  }
  const keys = items.filter(i => i.t === 'img').map(i => SAME_LOGO[i.k] || i.k)
  const bands = items
    .filter(i => i.t === 'rect' && Number(i.x) < off.x + 2 && Number(i.w) < 12 && Number(i.h) >= 8)
    .sort((a, b) => a.y - b.y).map(i => i.fill)
  return {
    system: systemLine,
    desc: [rest[0] || '', ...rest.slice(1).filter(t => !SIZE_LIKE.test(t))].filter(Boolean).join(', '),
    size: rest.slice(1).filter(t => SIZE_LIKE.test(t)).join(' '),
    refs: [...new Set(refs)],
    rebate,
    logos: [...new Set(keys)],
    bands,
    otherShapes: items.filter(i => i.t !== 'txt' && i.t !== 'img' && Number(i.h) >= 0.5).length - bands.length
  }
}

function makerOf(read, label) {
  const sys = systemOf(read.system || '') || systemOf(label?.name || '')
  if (sys) return sys.maker
  if (read.logos.includes('reform')) return 'reform'
  if (read.logos.includes('signus')) return 'signus'
  if (read.logos.includes('seaspine')) return 'seaspine'
  if (read.logos.includes('orthofix') || read.logos.includes('kt')) return 'orthofix'
  if (read.logos.includes('e4')) return 'e4'
  return ''
}

/** A screw's diameter from its size or description: "6.5 x", "Ø4.0", "6.5mm". */
export function diameterOf(...texts) {
  for (const t of texts) {
    const m = /Ø\s*(\d+(?:\.\d)?)/.exec(t || '') || /(\d+(?:\.\d)?)\s*(?:mm)?\s*[x×]/i.exec(t || '') || /(\d+\.\d)\s*mm/i.exec(t || '')
    if (m) return Number(m[1])
  }
  return null
}

function screwBand(maker, desc, size, name) {
  const table = SCREW_COLOURS[maker]
  if (!table) return null
  const words = `${desc} ${name}`
  if (!/screw/i.test(words) || /set screw/i.test(words)) return null
  if (maker === 'signus' && !/pedicle/i.test(words)) return null
  const d = diameterOf(size, desc, name)
  return d != null ? table[d] || null : null
}

// ── Building it again ─────────────────────────────────────────────────────

const run = (text, size, color = BLACK, bold = false) => ({ text, font: FONT, size, color, underline: false, bold, italic: false })

function logoItem(id, k, logos, x, centreY, h) {
  const trim = LOGO_TRIM[k]
  const logo = logos?.[k]
  const aspect = trim?.aspect || (logo?.w && logo?.h ? logo.w / logo.h : 3)
  const w = h * aspect
  return { id, t: 'img', k, x: round(x), y: round(centreY - h / 2), w: round(w), h: round(h), rot: 0, ...(trim?.crop ? { crop: trim.crop } : {}) }
}

/** Equal area, capped to the row: a long flat logo stays low, a square one goes taller. */
export function logoHeight(k, logos) {
  const aspect = LOGO_TRIM[k]?.aspect || (logos?.[k]?.w && logos?.[k]?.h ? logos[k].w / logos[k].h : 3)
  return round(Math.min(LOGO_ROW, Math.max(LOGO_MIN, Math.sqrt(LOGO_AREA / aspect))))
}

/**
 * The label rebuilt in the house style, with what was read and what to check:
 * { label, read, warnings, changed }.
 */
export function tidyLabel(label, logos = {}) {
  // The house style is for 68 × 21 implant labels; sheet labels keep their design.
  if (hasOwnSize(label)) return { label, changed: false, warnings: [] }
  const read = readLabel(label)
  const maker = makerOf(read, label)
  const m = MAKERS[maker]
  const accent = m?.accent || HOUSE_ACCENT
  const sys = systemOf(read.system || '') || systemOf(label?.name || '')
  const name = sys ? sys.name(read.system || label.name) : (read.system || '').toUpperCase()
  const desc = writeIn(read.desc).replace(/(\d|____)\s*mm\b/g, '$1 mm')
  const size = tidySize(read.size)
  const warnings = []
  if (!read.refs.length) warnings.push('No REF found on the label')
  if (read.refs.length > 1) warnings.push('Two REFs — check the line still reads')
  if (!maker) warnings.push('Maker not recognised — logos and colour kept as they were')
  if (!desc) warnings.push('No description found')
  if (read.otherShapes > 0) warnings.push('A shape on the label was left off')
  if (read.logos.includes('device')) warnings.push('Device Technologies logo taken off')

  const off = trimOffset(label)
  const top = off.y
  let bands = read.bands
  const screw = screwBand(maker, desc, size, label?.name || '')
  if (screw && bands.length <= 1) bands = [screw]
  const left = off.x + (bands.length ? BAND_W + EDGE : EDGE)
  const right = off.x + TRIM_W - EDGE
  const width = right - left
  const items = []
  let n = 0
  const id = () => `t${++n}`

  // Size-colour band(s), out into the bleed on three sides.
  bands.forEach((fill, i) => {
    const h = Number(label.h) / bands.length
    items.push({ id: id(), t: 'rect', x: 0, y: round(h * i), w: round(off.x + BAND_W), h: round(h), rot: 0, fill, stroke: null })
  })

  // Logos: TechnoMed on the left, the maker's on the right, Device's never.
  const centreY = top + LOGO_TOP + LOGO_ROW / 2
  const has = k => Boolean(logos?.[k]) || read.logos.includes(k)
  if (has('technomed')) items.push(logoItem(id(), 'technomed', logos, left, centreY, logoHeight('technomed', logos)))
  const rightKeys = m
    ? m.logos.filter(has)
    : read.logos.filter(k => k !== 'technomed' && !DROPPED_LOGOS.has(k))
  let x = right
  for (const k of [...rightKeys].reverse()) {
    const h = logoHeight(k, logos)
    const aspect = LOGO_TRIM[k]?.aspect || (logos?.[k]?.w && logos?.[k]?.h ? logos[k].w / logos[k].h : 3)
    x -= h * aspect
    items.push(logoItem(id(), k, logos, x, centreY, h))
    x -= LOGO_GAP
  }

  // Name, description, size: centred as a block between the logos and the line.
  const block = [
    name && { text: name, pt: NAME_PT, color: accent, bold: true },
    desc && { text: desc, pt: BODY_PT, color: BLACK, bold: false },
    size && { text: size, pt: BODY_PT, color: BLACK, bold: false }
  ].filter(Boolean)
  const pitch = b => b.pt * MM_PER_PT * LINE_LH
  const total = block.reduce((s, b, i) => s + (i < block.length - 1 ? pitch(b) : lineHeight(b.pt)), 0)
  let y = top + BLOCK_TOP + Math.max(0, (BLOCK_BOTTOM - BLOCK_TOP - total) / 2)
  for (const b of block) {
    items.push({ id: id(), t: 'txt', x: round(left), y: round(y), w: round(width), h: round(lineHeight(b.pt)), rot: 0,
      ha: 'center', va: 'top', lh: LINE_LH, ls: 0, fit: true, runs: [run(b.text, b.pt, b.color, b.bold)] })
    y += pitch(b)
  }

  // The fine line, then REF and REBATE.
  const ref = read.refs.join(' / ')
  if (ref || read.rebate) {
    items.push({ id: id(), t: 'rect', x: round(left + RULE_INSET), y: round(top + TRIM_H - RULE_FROM_BOTTOM), w: round(width - 2 * RULE_INSET), h: RULE_H, rot: 0, fill: accent, stroke: null })
    const refY = round(top + TRIM_H - REF_FROM_BOTTOM - lineHeight(REF_PT))
    // REBATE needs about 20 mm; REF has the rest of the line.
    const split = read.rebate ? Math.max(0.55, (width - 20) / width) : 1
    if (ref) {
      items.push({ id: id(), t: 'txt', x: round(left), y: refY, w: round(width * split - (read.rebate ? 1 : 0)), h: round(lineHeight(REF_PT)), rot: 0,
        ha: 'left', va: 'top', lh: LINE_LH, ls: 0, fit: true, runs: [run('REF', REF_PT, BLACK, true), run(`  ${ref}`, REF_PT)] })
    }
    if (read.rebate) {
      items.push({ id: id(), t: 'txt', x: round(left + width * split), y: refY, w: round(width * (1 - split)), h: round(lineHeight(REF_PT)), rot: 0,
        ha: 'right', va: 'top', lh: LINE_LH, ls: 0, fit: true, runs: [run('REBATE', REF_PT, BLACK, true), run(`  ${read.rebate}`, REF_PT)] })
    }
  }

  const tidied = { ...label, items }
  return { label: tidied, read: { ...read, maker, name, desc, size, ref, bands }, warnings, changed: JSON.stringify(items) !== JSON.stringify(label.items) }
}
