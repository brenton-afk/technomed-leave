// ─── Label Studio: the label model and its layout maths (Brent, 25 Nov 2026) ──
// "Replace Vistaprint for implant product labels." Every label is a design
// canvas in millimetres — the Vistaprint canvas, which includes bleed — with
// items drawn in order: text (runs of styled text), logos (by key, with an
// optional crop), and plain shapes. The finished label is 68 × 21 mm, cut
// from the middle of that canvas.
//
// Pure on purpose: the on-screen SVG (LabelSvg.jsx), the 600 dpi canvas for
// printing (render.js) and the server's import and validation (api/_labels.js)
// all read the same numbers from here, so the preview and the print can only
// disagree where a browser draws a font differently.

// ── The finished label ─────────────────────────────────────────────────────
export const TRIM_W = 68
export const TRIM_H = 21
export const MM_PER_PT = 25.4 / 72 // ≈ 0.3528
export const PT_PER_MM = 72 / 25.4
/** 68 × 21 mm in PDF points: 192.756 × 59.528. */
export const TRIM_W_PT = TRIM_W * PT_PER_MM
export const TRIM_H_PT = TRIM_H * PT_PER_MM

/**
 * Where the 68 × 21 mm label sits on each Vistaprint canvas, by canvas height.
 * Assumed centred (70.7 wide → 1.35 each side; 23 high → 1.0, 24 high → 1.5).
 * Not yet checked against a printed Vistaprint label: if the first prints
 * come out shifted, change these numbers and nothing else.
 */
export const TRIM_OFFSETS = {
  23: { x: 1.35, y: 1.0 },
  24: { x: 1.35, y: 1.5 }
}

/** A new label's canvas: the 68 × 21 trim with bleed, as Vistaprint's 23 mm one. */
export const BLANK_CANVAS = { w: 70.7, h: 23 }

export function trimOffset(label) {
  const known = TRIM_OFFSETS[Math.round(Number(label?.h) * 10) / 10]
  if (known && Math.abs(Number(label?.w) - 70.7) < 0.01) return known
  return { x: round((Number(label?.w || TRIM_W) - TRIM_W) / 2, 3), y: round((Number(label?.h || TRIM_H) - TRIM_H) / 2, 3) }
}

// ── Type ───────────────────────────────────────────────────────────────────
// The editor is Fabric.js, and the print is Fabric drawing the same objects,
// so the SVG thumbnails copy Fabric's text layout exactly:
//   · a line's pitch is size × lh (lh = line spacing, a multiple of the size;
//     Fabric's own lineHeight is lh ÷ FABRIC_SIZE_MULT);
//   · its baseline sits BASELINE × size below the line's top, whatever lh is;
//   · the last line is FABRIC_SIZE_MULT × size tall.
export const FABRIC_SIZE_MULT = 1.13
export const FABRIC_SIZE_FRACTION = 0.222
/** Vistaprint's default line spacing, as a multiple of the font size. */
export const LINE_HEIGHT = 1.2
export const BASELINE = FABRIC_SIZE_MULT * (1 - FABRIC_SIZE_FRACTION) // ≈ 0.879
/** Space kept clear inside the trim — the editor's dashed safe-area line. */
export const SAFE_MARGIN = 1.5

/**
 * Vistaprint's fonts and what draws them here. Apertura and Borges Titulo are
 * licensed to Vistaprint; Mulish (a humanist sans) and Cormorant Garamond are
 * the nearest free fonts. Alumni Sans, Alex Brush and Damion are themselves.
 * The files are under public/fonts/labels (SIL Open Font Licence).
 */
export const FONT_MAP = {
  'Apertura Web': 'Mulish',
  'Apertura': 'Mulish',
  'Borges Titulo CE Blanca': 'Cormorant Garamond',
  'Alumni Sans': 'Alumni Sans',
  'Alex Brush': 'Alex Brush',
  'Damion': 'Damion',
  'Arial': 'Arial'
}
/** The fonts offered in the editor. */
export const FONTS = ['Mulish', 'Cormorant Garamond', 'Alumni Sans', 'Alex Brush', 'Damion', 'Arial']
export const DEFAULT_FONT = 'Mulish'
/** Which fonts have bold and italic files (the rest are drawn faux by the browser). */
export const FONT_FILES = {
  'Mulish': { file: 'mulish', bold: true, italic: true },
  'Cormorant Garamond': { file: 'cormorant-garamond', bold: true, italic: true },
  'Alumni Sans': { file: 'alumni-sans', bold: true, italic: true },
  'Alex Brush': { file: 'alex-brush', bold: false, italic: false },
  'Damion': { file: 'damion', bold: false, italic: false }
}

const FALLBACK = { 'Cormorant Garamond': 'Georgia, serif', 'Alex Brush': 'cursive', 'Damion': 'cursive' }
export function fontName(family) {
  return FONT_MAP[family] || (FONTS.includes(family) ? family : DEFAULT_FONT)
}
/** A CSS font-family list for a stored family name. */
export function fontStack(family) {
  const name = fontName(family)
  if (name === 'Arial') return 'Arial, Helvetica, sans-serif'
  return `"${name}", ${FALLBACK[name] || 'Arial, Helvetica, sans-serif'}`
}

// ── Colour ─────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
function round(v, places = 2) { const f = 10 ** places; return Math.round(v * f) / f }

/** c, m, y, k in 0–100 → { r, g, b } 0–255, the simple screen conversion. */
export function cmykToRgb(c, m, y, k) {
  const K = 1 - clamp(Number(k) || 0, 0, 100) / 100
  const ch = v => Math.round(255 * (1 - clamp(Number(v) || 0, 0, 100) / 100) * K)
  return { r: ch(c), g: ch(m), b: ch(y) }
}

const hex2 = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')

/**
 * Any colour the export or the editor writes → '#rrggbb', or null when it is
 * not a colour. Accepts cmyk(c,m,y,k), rgb(r, g, b), Vistaprint's
 * rgb(#AAAAAA), #rgb and #rrggbb.
 */
export function toHex(value) {
  const s = String(value ?? '').trim()
  let m = /^cmyk\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(s)
  if (m) { const { r, g, b } = cmykToRgb(m[1], m[2], m[3], m[4]); return `#${hex2(r)}${hex2(g)}${hex2(b)}` }
  m = /^rgb\(\s*(#[0-9a-f]{3}|#[0-9a-f]{6})\s*\)$/i.exec(s)
  if (m) return toHex(m[1])
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(s)
  if (m) return `#${hex2(m[1])}${hex2(m[2])}${hex2(m[3])}`
  m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) return `#${m[1].split('').map(c => c + c).join('')}`.toLowerCase()
  m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return `#${m[1]}`.toLowerCase()
  return null
}
/** A colour for drawing: never invalid. */
export const paint = (value, fallback = '#000000') => toHex(value) || fallback

// ── Text layout ────────────────────────────────────────────────────────────

/**
 * A text item's runs as lines. Each line: { segments: [{ text, font, size,
 * color, underline, bold }], size } — size the largest on the line in pt (an
 * empty line takes the size of the run its line break was typed in).
 */
export function textLines(item) {
  const lines = [{ segments: [], size: 0, breakSize: 0 }]
  for (const run of item?.runs || []) {
    const parts = String(run.text ?? '').split('\n')
    parts.forEach((part, i) => {
      const line = lines[lines.length - 1]
      if (part) line.segments.push({ ...run, text: part })
      if (i < parts.length - 1) {
        line.breakSize = Number(run.size) || 8
        lines.push({ segments: [], size: 0, breakSize: 0 })
      }
    })
  }
  const lastRun = (item?.runs || [])[(item?.runs || []).length - 1]
  return lines.map(l => ({
    segments: l.segments,
    size: l.segments.length ? Math.max(...l.segments.map(s => Number(s.size) || 8))
      : (l.breakSize || Number(lastRun?.size) || 8)
  }))
}

/** 'left' | 'center' | 'right' → SVG text-anchor. */
export const anchorOf = ha => (ha === 'center' ? 'middle' : ha === 'right' ? 'end' : 'start')

/** Line spacing (× font size) and letter spacing (thousandths of an em). */
export const lineSpacing = item => (Number(item?.lh) > 0 ? Number(item.lh) : LINE_HEIGHT)
export const letterSpacing = item => Number(item?.ls) || 0

/**
 * Where each line of a text item is drawn, in canvas millimetres: the x the
 * line is anchored at (left edge, centre or right edge of the box, by `ha`),
 * its top and its baseline — Fabric's layout, so the thumbnail is the print.
 * Text never wraps: a line is as long as it is typed.
 */
export function layoutText(item) {
  const lines = textLines(item)
  const lh = lineSpacing(item)
  const pitch = lines.map(l => l.size * MM_PER_PT * lh)
  const total = pitch.slice(0, -1).reduce((a, b) => a + b, 0) + (lines.length ? lines[lines.length - 1].size * MM_PER_PT * FABRIC_SIZE_MULT : 0)
  const h = Number(item.h) || 0
  let top = Number(item.y) || 0
  if (item.va === 'middle') top += (h - total) / 2
  else if (item.va === 'bottom') top += h - total
  const anchorX = textAnchorX(item)
  return lines.map((line, i) => {
    const lineTop = top + pitch.slice(0, i).reduce((a, b) => a + b, 0)
    return {
      ...line,
      top: lineTop,
      height: pitch[i],
      baseline: lineTop + BASELINE * line.size * MM_PER_PT,
      anchorX,
      anchor: anchorOf(item.ha)
    }
  })
}

/** The x a text box's lines hang from: its left edge, centre or right edge. */
export function textAnchorX(item) {
  const x = Number(item.x) || 0
  const w = Number(item.w) || 0
  return item.ha === 'center' ? x + w / 2 : item.ha === 'right' ? x + w : x
}

// ── Fitting imported text to its Vistaprint box (Brent, 25 Nov 2026) ───────
// Mulish is a little wider than Apertura, so a line that just fitted its box
// on Vistaprint runs past it here. A text item with `fit: true` (every
// imported one; new text only when switched on) keeps to its box width `w`:
// a line wider than the box is first condensed, down to MIN_CONDENSE, and
// beyond that the type is made smaller as well. The factors are worked out
// from the real font's widths wherever the label is drawn — Fabric in the
// editor and the print, the browser's own measure for the thumbnails — and
// the editor's text panel says what was done.
export const MIN_CONDENSE = 0.85

/** { sx, sy } for a widest line `natural` mm across in a box `boxW` mm wide. */
export function fitFactors(natural, boxW) {
  const n = Number(natural)
  const w = Number(boxW)
  if (!(n > 0) || !(w > 0) || n <= w) return { sx: 1, sy: 1 }
  const r = w / n
  if (r >= MIN_CONDENSE) return { sx: r, sy: 1 }
  return { sx: r, sy: r / MIN_CONDENSE }
}

/**
 * The widest line of a text item in mm, with `measure(text, run)` giving one
 * run's width in mm (letter spacing added here, as Fabric adds it).
 */
export function naturalWidth(item, measure) {
  const ls = letterSpacing(item)
  let widest = 0
  for (const line of textLines(item)) {
    let w = 0
    for (const seg of line.segments) {
      w += measure(seg.text, seg)
      if (ls) w += (ls / 1000) * (Number(seg.size) || 8) * MM_PER_PT * [...seg.text].length
    }
    widest = Math.max(widest, w)
  }
  return widest
}

/** A CSS/canvas font shorthand for a run, at `px` pixels. */
export const runFont = (run, px) => `${run.italic ? 'italic ' : ''}${run.bold ? 700 : 400} ${px}px ${fontStack(run.font)}`

/** Plain text of a text item, line breaks kept. */
export const itemText = item => (item?.runs || []).map(r => r.text).join('')

// ── Images ─────────────────────────────────────────────────────────────────

/**
 * The part of a logo an item shows, in the logo's own pixels: crop holds the
 * fractions trimmed off each side, and what is left fills the item's box.
 */
export function cropBox(item, logo) {
  const iw = Number(logo?.w) || 1
  const ih = Number(logo?.h) || 1
  const c = item?.crop || {}
  const l = clamp(Number(c.l) || 0, 0, 0.95)
  const r = clamp(Number(c.r) || 0, 0, 0.95 - l)
  const t = clamp(Number(c.t) || 0, 0, 0.95)
  const b = clamp(Number(c.b) || 0, 0, 0.95 - t)
  return { sx: l * iw, sy: t * ih, sw: (1 - l - r) * iw, sh: (1 - t - b) * ih, iw, ih }
}

/** Rotation in degrees, as an SVG transform (or ''). */
export function rotation(item) {
  const deg = Number(item?.rot) || 0
  if (!deg) return ''
  const [cx, cy] = pivot(item)
  return `rotate(${round(deg, 3)} ${round(cx, 3)} ${round(cy, 3)})`
}

/**
 * The point an item turns about: a shape or logo its centre; text the point
 * its lines hang from (the anchor on its top edge), as Fabric turns it.
 */
export function pivot(item) {
  if (item?.t === 'txt') return [textAnchorX(item), Number(item.y) || 0]
  return [Number(item.x) + Number(item.w) / 2, Number(item.y) + Number(item.h) / 2]
}

// ── What the library shows ────────────────────────────────────────────────

const REF_RE = /\bREF\s*[:.]?\s*([A-Z0-9][A-Z0-9\-./]*[A-Z0-9.]|[A-Z0-9])/i
const REBATE_RE = /\bRebate\s*Code\s*[:.]?\s*([A-Z]{2}\s?\d{2,4}[A-Z]?)/i

/** REF and rebate code read from a label's words, and its brand logo. */
export function summarise(label, logos = {}) {
  const words = (label?.items || []).filter(i => i.t === 'txt').map(itemText).join('\n')
  const ref = REF_RE.exec(words)?.[1] || ''
  const rebate = (REBATE_RE.exec(words)?.[1] || '').replace(/\s/g, '').toUpperCase()
  const keys = (label?.items || []).filter(i => i.t === 'img').map(i => i.k)
  const brands = [...new Set(keys.map(k => logos[k]?.name).filter(Boolean))]
  const brand = brands.find(n => !/technomed/i.test(n)) || brands[0] || ''
  return { ref, rebate, brand, brandKey: keys.find(k => logos[k]?.name === brand) || '' }
}

/** Every word worth finding a label by. */
export function searchText(label, logos = {}) {
  const s = summarise(label, logos)
  return [label?.name, s.ref, s.rebate, s.brand, ...(label?.items || []).filter(i => i.t === 'txt').map(itemText)]
    .join(' ').toLowerCase().replace(/\s+/g, ' ')
}

export function matchesSearch(label, logos, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = searchText(label, logos)
  return words.every(w => hay.includes(w))
}

// ── Importing the Vistaprint export ──────────────────────────────────────

const parseSize = s => round(Number(String(s ?? '').replace(/pt$/i, '')) || 8, 3)
export const sameStyle = (a, b) => a.font === b.font && a.size === b.size && a.color === b.color
  && Boolean(a.underline) === Boolean(b.underline) && Boolean(a.bold) === Boolean(b.bold) && Boolean(a.italic) === Boolean(b.italic)

/**
 * One exported text box's runs, tidied: trailing spaces on every line and
 * blank lines at the end are dropped; blank lines at the start are dropped
 * too, and the box moved down by their height so the words stay where they
 * were printed. Spaces inside a line are kept — the team spaces REF and
 * Rebate Code apart with them.
 * Returns { runs, shift } — shift in mm to add to y.
 */
export function cleanRuns(rawRuns) {
  const runs = (rawRuns || []).map(r => (Array.isArray(r) ? {
    text: String(r[0] ?? ''), font: fontName(String(r[1] || 'Apertura Web')), size: parseSize(r[2]),
    color: toHex(r[3]) || '#000000', underline: /underline/.test(String(r[4] || '')),
    bold: /bold|[6-9]00/.test(String(r[5] || '')), italic: /italic|oblique/.test(String(r[4] || ''))
  } : { ...r, text: String(r.text ?? '') })).map(r => ({ ...r, text: r.text.replace(/\r/g, '').replace(/\t/g, ' ') }))

  // Into lines of styled pieces, each line remembering its break's style.
  const lines = [{ pieces: [], style: null }]
  for (const run of runs) {
    const { text, ...style } = run
    text.split('\n').forEach((part, i, all) => {
      const line = lines[lines.length - 1]
      if (part) line.pieces.push({ text: part, style })
      if (i < all.length - 1) { line.style = style; lines.push({ pieces: [], style }) }
    })
  }
  for (const line of lines) {
    while (line.pieces.length) {
      const last = line.pieces[line.pieces.length - 1]
      last.text = last.text.replace(/\s+$/, '')
      if (last.text) break
      line.pieces.pop()
    }
  }
  while (lines.length > 1 && !lines[lines.length - 1].pieces.length) lines.pop()
  let shift = 0
  while (lines.length > 1 && !lines[0].pieces.length) {
    const size = lines[0].style?.size || 8
    shift += size * MM_PER_PT * LINE_HEIGHT
    lines.shift()
  }
  // Back into runs, merging neighbours of one style.
  const out = []
  const add = (text, style) => {
    const prev = out[out.length - 1]
    if (prev && sameStyle(prev, style)) prev.text += text
    else out.push({ text, ...style })
  }
  lines.forEach((line, i) => {
    const breakStyle = line.style || line.pieces[line.pieces.length - 1]?.style || runs[0] || {}
    line.pieces.forEach(p => add(p.text, p.style))
    if (i < lines.length - 1) {
      const { text: _t, ...st } = { text: '', ...breakStyle }
      add('\n', line.pieces.length ? line.pieces[line.pieces.length - 1].style : st)
    }
  })
  if (!out.length) out.push({ text: '', font: runs[0]?.font || DEFAULT_FONT, size: runs[0]?.size || 8, color: runs[0]?.color || '#000000', underline: false, bold: false, italic: false })
  return { runs: out, shift: round(shift, 3) }
}

const DIM_RE = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*mm/i

/**
 * Where the project's name and the label's own words give different sizes
 * ("K-Wire 1.6 x 500mm" over a label reading 1.8 x 500mm), say so. The words
 * are what gets printed, so they are kept; the badge asks someone to check.
 */
export function nameCheck(name, text) {
  const n = DIM_RE.exec(String(name || ''))
  if (!n) return ''
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*x\\s*${n[2].replace('.', '\\.')}\\s*mm`, 'i')
  const t = re.exec(String(text || ''))
  if (t && Number(t[1]) !== Number(n[1])) return `Name says ${n[1]}, label reads ${t[1]}`
  return ''
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? round(Number(v), 3) : d)

function parseStroke(stroke) {
  if (!stroke) return null
  let s = stroke
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { return null } }
  const width = Number(String(s.thickness ?? s.width ?? '0').replace(/mm$/, '')) || 0
  if (width <= 0) return null
  return { color: toHex(s.color) || '#000000', width: round(width, 3) }
}

/**
 * One Vistaprint project → a label in this model. Items in draw order (z);
 * logo keys renamed through `keyMap` (the export repeats the same picture
 * under several keys).
 */
export function importLabel(raw, keyMap = {}) {
  const items = [...(raw.items || [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  const out = []
  let n = 0
  for (const it of items) {
    const base = { id: `i${++n}`, x: num(it.x), y: num(it.y), w: num(it.w), h: num(it.h), rot: num(it.rot) }
    if (it.t === 'txt') {
      const { runs, shift } = cleanRuns(it.runs)
      out.push({ ...base, t: 'txt', y: round(base.y + shift, 3), h: round(Math.max(0.5, base.h - shift), 3), ha: ['left', 'center', 'right'].includes(it.ha) ? it.ha : 'left', va: 'top', lh: LINE_HEIGHT, ls: 0, fit: true, runs })
    } else if (it.t === 'img') {
      const crop = it.crop && ['t', 'b', 'l', 'r'].some(s => Number(it.crop[s]))
        ? { t: num(it.crop.t), b: num(it.crop.b), l: num(it.crop.l), r: num(it.crop.r) } : null
      out.push({ ...base, t: 'img', k: keyMap[it.k] || it.k, ...(crop ? { crop } : {}) })
    } else if (['rectangle', 'ellipse', 'line'].includes(it.t)) {
      // The page's own white ground (z −1001) is the paper, not a shape.
      if (it.z <= -1000 && /fff/i.test(String(it.color))) continue
      out.push({ ...base, t: it.t === 'rectangle' ? 'rect' : it.t, fill: toHex(it.color) || '#000000', stroke: parseStroke(it.stroke) })
    }
  }
  const name = String(raw.name || '').replace(/\s+/g, ' ').trim() || 'Untitled label'
  const text = out.filter(i => i.t === 'txt').map(itemText).join('\n')
  const check = nameCheck(name, text)
  return {
    id: String(raw.id),
    name,
    w: num(raw.w, BLANK_CANVAS.w),
    h: num(raw.h, BLANK_CANVAS.h),
    items: out,
    ...(check ? { check } : {}),
    source: 'vistaprint',
    vistaprintCreated: raw.created || ''
  }
}

/** Every item gets a fresh id, for a duplicated label or a pasted item. */
export const newItemId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function blankLabel(name = 'New label') {
  const off = trimOffset(BLANK_CANVAS)
  return {
    name,
    w: BLANK_CANVAS.w,
    h: BLANK_CANVAS.h,
    items: [
      { id: newItemId(), t: 'txt', x: off.x + 15, y: off.y + 3, w: TRIM_W - 30, h: 4.2, rot: 0, ha: 'center', va: 'top',
        runs: [{ text: 'PRODUCT NAME', font: 'Mulish', size: 10, color: '#000000', underline: false, bold: false, italic: false }], lh: LINE_HEIGHT, ls: 0 },
      { id: newItemId(), t: 'txt', x: off.x + 4, y: off.y + 16, w: TRIM_W - 8, h: 3.4, rot: 0, ha: 'left', va: 'top',
        runs: [{ text: 'REF:              Rebate Code:', font: 'Mulish', size: 8, color: '#000000', underline: false, bold: false, italic: false }], lh: LINE_HEIGHT, ls: 0 }
    ]
  }
}

export function duplicateLabel(label) {
  const { id: _id, version: _v, createdAt: _c, updatedAt: _u, updatedBy: _b, createdBy: _cb, check: _ch, ...rest } = label
  return { ...rest, name: `${label.name} (copy)`, items: (label.items || []).map(i => ({ ...i, id: newItemId() })) }
}

// ── What a saved label may hold (the server applies this) ────────────────

const MAX_ITEMS = 60
const MAX_TEXT = 400
const COORD = [-20, 120]

/**
 * A label as sent by the editor, cut down to what the model allows. Unknown
 * fields go; numbers are bounded; colours must be colours; fonts must be one
 * of ours or Vistaprint's; a logo is only ever a key, never a URL.
 */
export function sanitiseLabel(input, { logoKeys = null } = {}) {
  const l = input || {}
  const name = String(l.name || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled label'
  const w = clamp(num(l.w, BLANK_CANVAS.w), 20, 200)
  const h = clamp(num(l.h, BLANK_CANVAS.h), 10, 100)
  const items = []
  for (const it of (Array.isArray(l.items) ? l.items : []).slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== 'object') continue
    const base = {
      id: String(it.id || newItemId()).replace(/[^\w-]/g, '').slice(0, 40) || newItemId(),
      x: clamp(num(it.x), ...COORD), y: clamp(num(it.y), ...COORD),
      w: clamp(num(it.w, 1), 0.2, 150), h: clamp(num(it.h, 1), 0.05, 150), rot: clamp(num(it.rot), -360, 360),
      ...(it.locked ? { locked: true } : {})
    }
    if (it.t === 'txt') {
      const runs = (Array.isArray(it.runs) ? it.runs : []).slice(0, 20).map(r => ({
        text: String(r?.text ?? '').replace(/\r/g, '').slice(0, MAX_TEXT),
        font: fontName(r?.font),
        size: clamp(num(r?.size, 8), 3, 72),
        color: toHex(r?.color) || '#000000',
        underline: Boolean(r?.underline),
        bold: Boolean(r?.bold),
        italic: Boolean(r?.italic)
      }))
      if (!runs.length) runs.push({ text: '', font: DEFAULT_FONT, size: 8, color: '#000000', underline: false, bold: false, italic: false })
      items.push({ ...base, t: 'txt', ha: ['left', 'center', 'right'].includes(it.ha) ? it.ha : 'left', va: 'top',
        lh: clamp(num(it.lh, LINE_HEIGHT), 0.5, 4), ls: clamp(num(it.ls), -200, 2000), ...(it.fit ? { fit: true } : {}), runs })
    } else if (it.t === 'img') {
      const k = String(it.k || '').replace(/[^\w-]/g, '').slice(0, 60)
      if (!k || (logoKeys && !logoKeys.has(k))) continue
      const c = it.crop || {}
      const crop = ['t', 'b', 'l', 'r'].some(s => Number(c[s])) ? { t: clamp(num(c.t), 0, 0.95), b: clamp(num(c.b), 0, 0.95), l: clamp(num(c.l), 0, 0.95), r: clamp(num(c.r), 0, 0.95) } : null
      items.push({ ...base, t: 'img', k, ...(crop ? { crop } : {}) })
    } else if (['rect', 'ellipse', 'line'].includes(it.t)) {
      const st = it.stroke && Number(it.stroke.width) > 0 ? { color: toHex(it.stroke.color) || '#000000', width: clamp(num(it.stroke.width), 0.05, 5) } : null
      items.push({ ...base, t: it.t, fill: toHex(it.fill) || '#000000', stroke: st })
    }
  }
  const out = { name, w, h, items }
  if (l.check && typeof l.check === 'string') out.check = l.check.slice(0, 200)
  return out
}
