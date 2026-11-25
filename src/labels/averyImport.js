// ─── Bringing in the Avery label designs (Brent, 25 Nov 2026) ─────────────
// "Export these label designs into a file type that can be integrated into
// our portal label builder." The export is a ZIP: a folder per label with
// template.json ("technomed-label-template/1.0" — sizes in mm, the sheet
// layout, images, text paragraphs and shapes), the artwork under assets/
// (PNG / JPEG, and vector PDF with a .preview.png beside it). This file turns
// one template into a Label Studio label. Pure apart from the measure passed
// in, so the conversion is tested without a browser.
//
// What changes on the way in:
//   · Avery wraps text inside its box; Label Studio's text never wraps — so
//     the paragraphs are broken into lines here, with the label fonts' own
//     widths, and the box moved to keep Avery's vertical alignment.
//   · Pictures become logos (by key), uploaded once per picture file.
//   · Avery's rectangles (polygons) become rects; an unfilled one is 'none'.
//   · The label's finished size is its `trim`, Avery's layout its `sheet`.

import { MM_PER_PT, FABRIC_SIZE_MULT, LINE_HEIGHT, fontName, toHex, sameStyle } from './model.js'

const r3 = v => Math.round(Number(v) * 1000) / 1000
export const TEMPLATE_SCHEMA = 'technomed-label-template/1.0'

/** A run of the template → a label run. */
function toRun(r) {
  return {
    text: String(r.text ?? '').replace(/\r/g, ''),
    font: fontName(r.font),
    size: r3(Number(r.sizePt) || 8),
    color: toHex(r.color) || '#000000',
    underline: Boolean(r.underline),
    bold: r.weight === 'bold' || Number(r.weight) >= 600,
    italic: r.style === 'italic' || r.style === 'oblique'
  }
}

/**
 * Paragraphs (each { align, runs }) → runs with a '\n' at every paragraph end
 * and wherever a line runs past `width` mm. measure(text, run) gives a run's
 * width in mm. Spaces at a break are dropped; a word longer than the box
 * stays whole on its own line (fit-to-box squeezes it).
 */
export function wrapParagraphs(paragraphs, width, measure) {
  const out = []
  const add = (text, style) => {
    const prev = out[out.length - 1]
    if (prev && sameStyle(prev, style)) prev.text += text
    else out.push({ text, ...style })
  }
  const lines = []
  for (const p of paragraphs || []) {
    const tokens = []
    for (const run of (p.runs || []).map(toRun)) {
      const { text, ...style } = run
      const parts = text.split('\n')
      parts.forEach((part, i) => {
        part.split(/(\s+)/).forEach(w => { if (w) tokens.push({ w, style }) })
        if (i < parts.length - 1) tokens.push({ br: true, style })
      })
    }
    let line = []
    let lineW = 0
    const flush = style => {
      while (line.length && /^\s+$/.test(line[line.length - 1].w)) line.pop()
      lines.push({ tokens: line, style: style || line[line.length - 1]?.style || toRun(p.runs?.[0] || {}) })
      line = []; lineW = 0
    }
    for (const t of tokens) {
      if (t.br) { flush(t.style); continue }
      const space = /^\s+$/.test(t.w)
      if (space && !line.length) continue
      const tw = measure(t.w, t.style) || 0
      if (!space && line.length && lineW + tw > width + 0.01) flush()
      line.push(t); lineW += tw
    }
    flush()
  }
  lines.forEach((l, i) => {
    l.tokens.forEach(t => add(t.w, t.style))
    if (i < lines.length - 1) {
      const { text: _t, ...st } = { text: '', ...(l.tokens[l.tokens.length - 1]?.style || l.style) }
      add('\n', st)
    }
  })
  if (!out.length) out.push({ text: '', font: 'Mulish', size: 8, color: '#000000', underline: false, bold: false, italic: false })
  return out
}

/** Height in mm Label Studio's layout gives these runs (model.layoutText). */
export function textHeight(runs, lh = LINE_HEIGHT) {
  const sizes = []
  let cur = 0
  for (const r of runs) {
    const parts = String(r.text).split('\n')
    parts.forEach((part, i) => {
      if (part) cur = Math.max(cur, Number(r.size) || 8)
      if (i < parts.length - 1) { sizes.push(cur || Number(r.size) || 8); cur = 0 }
    })
  }
  sizes.push(cur || Number(runs[runs.length - 1]?.size) || 8)
  return sizes.slice(0, -1).reduce((a, s) => a + s * MM_PER_PT * lh, 0) + sizes[sizes.length - 1] * MM_PER_PT * FABRIC_SIZE_MULT
}

/** The asset file name an image element uses: the PNG preview for a PDF until the PDF is drawn. */
export const assetName = src => String(src || '').replace(/^assets\//, '')

/**
 * One template.json → { label, assets } where assets are the picture files
 * the label needs ({ name, preview? } — preview is a PDF's PNG stand-in).
 * Image items carry the asset name as their key until the upload gives the
 * real one (rekey).
 *
 * @param measure (text, run) → mm
 * @param sizes   { assetName: { w, h } } pixel sizes where known (for 'contain')
 */
export function templateToLabel(tpl, measure, sizes = {}) {
  if (!tpl || tpl.schema !== TEMPLATE_SCHEMA) throw new Error('Not a TechnoMed label template')
  const L = tpl.label || {}
  const W = r3(L.width)
  const H = r3(L.height)
  const items = []
  const assets = new Map()
  let n = 0
  for (const e of tpl.elements || []) {
    if (e.visible === false || e.printable === false) continue
    const base = { id: `a${++n}`, x: r3(e.x), y: r3(e.y), w: r3(e.w), h: r3(e.h), rot: r3(e.rotation || 0) }
    if (e.type === 'image' || e.type === 'background') {
      const name = assetName(e.src)
      if (!name) continue
      assets.set(name, { name, ...(e.previewSrc ? { preview: assetName(e.previewSrc) } : {}) })
      let box = base
      const px = sizes[name]
      if (e.fit === 'contain' && px?.w && px?.h) {
        const k = Math.min(base.w / px.w, base.h / px.h)
        const w = r3(px.w * k)
        const h = r3(px.h * k)
        box = { ...base, x: r3(base.x + (base.w - w) / 2), y: r3(base.y + (base.h - h) / 2), w, h }
      }
      items.push({ ...box, t: 'img', k: name })
    } else if (e.type === 'text') {
      const lh = Number(e.lineSpacing) > 0 ? Number(e.lineSpacing) : LINE_HEIGHT
      const runs = wrapParagraphs(e.paragraphs, base.w, measure)
      if (!runs.some(r => r.text.trim())) continue
      const th = textHeight(runs, lh)
      const y = e.valign === 'top' ? base.y : e.valign === 'bottom' ? base.y + base.h - th : base.y + (base.h - th) / 2
      const ha = ['left', 'center', 'right'].includes(e.paragraphs?.[0]?.align) ? e.paragraphs[0].align : 'left'
      items.push({ ...base, t: 'txt', y: r3(y), h: r3(Math.max(0.5, th)), ha, va: 'top', lh: r3(lh), ls: 0, fit: true, runs })
    } else if (e.type === 'shape') {
      const pts = e.points?.length ? e.points : [[0, 0], [e.w, 0], [e.w, e.h], [0, e.h]]
      const xs = pts.map(p => Number(p[0]))
      const ys = pts.map(p => Number(p[1]))
      const x0 = Math.min(...xs)
      const y0 = Math.min(...ys)
      const filled = Number(e.fillOpacity) > 0 && toHex(e.fill)
      const stroke = e.stroke && Number(e.strokeWidthMm) > 0 && Number(e.strokeOpacity ?? 1) > 0
        ? { color: toHex(e.stroke) || '#000000', width: r3(Math.min(5, Number(e.strokeWidthMm))) } : null
      if (!filled && !stroke) continue
      items.push({ ...base, x: r3(base.x + x0), y: r3(base.y + y0), w: r3(Math.max(...xs) - x0), h: r3(Math.max(...ys) - y0), t: 'rect', fill: filled ? toHex(e.fill) : 'none', stroke })
    }
  }
  const g = tpl.sheet?.grid
  const per = Number(tpl.sheet?.labelsPerSheet) || (g ? g.across * g.down : 0)
  const sku = tpl.source?.sku ? `Avery ${tpl.source.sku}` : 'Avery'
  const label = {
    name: String(tpl.name || 'Avery label').trim(),
    w: W, h: H, trim: { w: W, h: H },
    ...(g && g.across && g.down ? {
      sheet: {
        name: `${sku} · ${per} per sheet`,
        pageW: Number(tpl.sheet.width) || 210, pageH: Number(tpl.sheet.height) || 297,
        left: Number(g.marginLeft) || 0, top: Number(g.marginTop) || 0,
        pitchX: Number(g.pitchX) || 0, pitchY: Number(g.pitchY) || 0,
        across: Number(g.across), down: Number(g.down)
      }
    } : {}),
    items,
    source: 'avery',
    sourceId: String(tpl.source?.projectId || '')
  }
  return { label, assets: [...assets.values()] }
}

/** Image items' temporary keys (asset names) → the uploaded logos' keys. */
export function rekey(label, keyOf) {
  return { ...label, items: label.items.map(i => (i.t === 'img' ? { ...i, k: keyOf[i.k] || i.k } : i)) }
}

/** The labels already brought in, by their Avery project id. */
export function importedIds(labels) {
  return new Set((labels || []).filter(l => l.source === 'avery' && l.sourceId).map(l => l.sourceId))
}
