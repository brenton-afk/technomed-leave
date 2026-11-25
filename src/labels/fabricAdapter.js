// ─── The label model ⇄ Fabric.js objects ─────────────────────────────────
// The editor is Fabric.js (Brent, 25 Nov 2026: "not reinventing the wheel");
// what is saved is the label model (model.js), so the library, thumbnails,
// seed and server never depend on Fabric. This file is the whole of the
// translation, and is pure: `itemToSpec` gives the constructor options for an
// item, `objectToItem` reads an object's plain properties back. The editor's
// thin layer (editorCanvas.js) builds the real objects from the specs.
//
// Fabric works in millimetres here — one canvas unit is one mm of the label —
// and the zoom is the viewport transform, so nothing below converts to pixels.
//
// How each kind sits in Fabric:
//   text   IText (never wraps), originX = the alignment, top-left anchored
//          like the model: left edge / centre / right edge of the box. Every
//          character carries its own style, so runs survive inline editing.
//          Turns about that anchor, as model.pivot says.
//   image  Image with cropX/cropY and a cropped width/height, centre origin.
//   rect / ellipse / line   centre origin; a line is a thin rect.

import { MM_PER_PT, FABRIC_SIZE_MULT, fontName, lineSpacing, letterSpacing, textAnchorX, cropBox, sameStyle, toHex, newItemId } from './model.js'

const r3 = v => Math.round(Number(v) * 1000) / 1000
const r4 = v => Math.round(Number(v) * 10000) / 10000
const ORIGIN_SHARE = { left: 0, center: 0.5, right: 1 }

/** What a locked item cannot do. */
export function lockProps(locked) {
  const l = Boolean(locked)
  return {
    lockMovementX: l, lockMovementY: l, lockScalingX: l, lockScalingY: l, lockRotation: l,
    hasControls: !l, editable: !l, tmLocked: l
  }
}

/** A run's style as Fabric character style (font size in mm). */
export function runToStyle(run) {
  return {
    fontFamily: fontName(run.font),
    fontSize: r4((Number(run.size) || 8) * MM_PER_PT),
    fill: toHex(run.color) || '#000000',
    underline: Boolean(run.underline),
    fontWeight: run.bold ? 'bold' : 'normal',
    fontStyle: run.italic ? 'italic' : 'normal'
  }
}

/** Fabric character style → a run's style (size back in pt, × the object's scale). */
export function styleToRun(style, scale = 1) {
  return {
    font: fontName(style.fontFamily),
    size: r3((Number(style.fontSize) || 2.8) * scale / MM_PER_PT),
    color: toHex(style.fill) || '#000000',
    underline: Boolean(style.underline),
    bold: style.fontWeight === 'bold' || Number(style.fontWeight) >= 600,
    italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique'
  }
}

/** Runs → IText text plus a style for every character, by line and column. */
export function runsToStyles(runs) {
  const styles = {}
  let text = ''
  let line = 0
  let col = 0
  for (const run of runs || []) {
    const style = runToStyle(run)
    for (const ch of String(run.text ?? '')) {
      text += ch
      if (ch === '\n') { line++; col = 0; continue }
      ;(styles[line] ||= {})[col++] = { ...style }
    }
  }
  return { text, styles }
}

/**
 * IText text plus its styles → runs. A line break takes the style of the
 * character before it (else the object's own), so an empty line keeps its size.
 */
export function stylesToRuns(text, styles = {}, defaults = {}, scale = 1) {
  const runs = []
  const add = (ch, st) => {
    const run = styleToRun(st, scale)
    const prev = runs[runs.length - 1]
    if (prev && sameStyle(prev, run)) prev.text += ch
    else runs.push({ text: ch, ...run })
  }
  const lines = String(text ?? '').split('\n')
  lines.forEach((line, li) => {
    let last = defaults
    ;[...line].forEach((ch, ci) => {
      last = { ...defaults, ...(styles?.[li]?.[ci] || {}) }
      add(ch, last)
    })
    if (li < lines.length - 1) add('\n', last)
  })
  if (!runs.length) runs.push({ text: '', ...styleToRun(defaults, scale) })
  return runs
}

/**
 * An item → { kind, props } where props are the Fabric constructor options
 * (and the tm* fields the editor keeps on the object). An image also needs
 * `logo` ({ w, h, url }) for its crop; the editor loads the picture.
 */
export function itemToSpec(item, { logos = {} } = {}) {
  const base = { angle: Number(item.rot) || 0, tmId: item.id || newItemId(), tmKind: item.t, ...lockProps(item.locked) }
  if (item.t === 'txt') {
    const { text, styles } = runsToStyles(item.runs)
    const first = runToStyle(item.runs?.[0] || {})
    return {
      kind: 'text',
      text,
      props: {
        ...base,
        ...first,
        styles,
        left: r4(textAnchorX(item)), top: r4(item.y),
        originX: ['left', 'center', 'right'].includes(item.ha) ? item.ha : 'left', originY: 'top',
        textAlign: ['left', 'center', 'right'].includes(item.ha) ? item.ha : 'left',
        lineHeight: r4(lineSpacing(item) / FABRIC_SIZE_MULT),
        charSpacing: letterSpacing(item),
        tmBoxW: Number(item.w) || 0, tmBoxH: Number(item.h) || 0,
        // Fabric's default stroke width is 1 unit — here 1 mm — and it widens
        // the box handles, snapping and alignment use. Text has no stroke.
        strokeWidth: 0,
        // Fitted to the box: editorCanvas.applyFit sets the scale from the
        // real widths once the object exists, and records it in tmFitX/Y.
        tmFit: Boolean(item.fit), tmFitX: 1, tmFitY: 1
      }
    }
  }
  const cx = r4(Number(item.x) + Number(item.w) / 2)
  const cy = r4(Number(item.y) + Number(item.h) / 2)
  const centred = { left: cx, top: cy, originX: 'center', originY: 'center' }
  if (item.t === 'img') {
    const logo = logos[item.k] || {}
    const c = cropBox(item, logo)
    return {
      kind: 'image',
      url: logo.url || '',
      props: {
        ...base, ...centred, k: item.k, tmIw: c.iw, tmIh: c.ih,
        cropX: c.sx, cropY: c.sy, width: c.sw, height: c.sh,
        scaleX: Number(item.w) / c.sw, scaleY: Number(item.h) / c.sh
      }
    }
  }
  const stroke = item.stroke && Number(item.stroke.width) > 0
    ? { stroke: toHex(item.stroke.color) || '#000000', strokeWidth: Number(item.stroke.width) }
    : { stroke: null, strokeWidth: 0 }
  const fill = toHex(item.fill) || '#000000'
  if (item.t === 'ellipse') {
    return { kind: 'ellipse', props: { ...base, ...centred, rx: r4(item.w / 2), ry: r4(item.h / 2), fill, ...stroke, strokeUniform: true } }
  }
  return {
    kind: item.t === 'line' ? 'line' : 'rect',
    props: { ...base, ...centred, width: r4(item.w), height: r4(item.h), fill, ...(item.t === 'line' ? { stroke: null, strokeWidth: 0 } : stroke), strokeUniform: true }
  }
}

/**
 * A Fabric object's plain properties (read straight off the object) → an
 * item. Scaling is folded in: a scaled text box becomes bigger type, a scaled
 * shape a bigger shape, so the model never carries a scale.
 */
export function objectToItem(o) {
  const angle = r3(((Number(o.angle) || 0) % 360 + 360) % 360)
  const rot = angle > 180 ? r3(angle - 360) : angle
  // A fitted text box's own squeeze is not a change of size: only scaling
  // beyond it (a handle dragged) becomes bigger or smaller type.
  const sx = (Number(o.scaleX) || 1) / (o.tmKind === 'txt' && o.tmFit ? Number(o.tmFitX) || 1 : 1)
  const sy = (Number(o.scaleY) || 1) / (o.tmKind === 'txt' && o.tmFit ? Number(o.tmFitY) || 1 : 1)
  const base = { id: o.tmId || newItemId(), rot, ...(o.tmLocked ? { locked: true } : {}) }
  if (o.tmKind === 'txt') {
    const ha = ['left', 'center', 'right'].includes(o.textAlign) ? o.textAlign : 'left'
    const w = r3((Number(o.tmBoxW) || Number(o.width) || 10) * sx)
    const origin = ORIGIN_SHARE[o.originX] ?? 0
    const runs = stylesToRuns(o.text, o.styles, {
      fontFamily: o.fontFamily, fontSize: o.fontSize, fill: o.fill, underline: o.underline, fontWeight: o.fontWeight, fontStyle: o.fontStyle
    }, sy)
    return {
      ...base, t: 'txt',
      x: r3(Number(o.left) - w * origin), y: r3(o.top), w,
      h: r3(Math.max(0.5, (Number(o.height) || Number(o.tmBoxH) || 3) * sy)),
      ha, va: 'top',
      lh: r3((Number(o.lineHeight) || 1.16) * FABRIC_SIZE_MULT),
      ls: r3(Number(o.charSpacing) || 0),
      ...(o.tmFit ? { fit: true } : {}),
      runs
    }
  }
  if (o.tmKind === 'img') {
    const w = r3(Number(o.width) * sx)
    const h = r3(Number(o.height) * sy)
    const iw = Number(o.tmIw) || Number(o.width) || 1
    const ih = Number(o.tmIh) || Number(o.height) || 1
    const crop = {
      t: r4((Number(o.cropY) || 0) / ih), b: r4(1 - ((Number(o.cropY) || 0) + Number(o.height)) / ih),
      l: r4((Number(o.cropX) || 0) / iw), r: r4(1 - ((Number(o.cropX) || 0) + Number(o.width)) / iw)
    }
    for (const k of Object.keys(crop)) if (Math.abs(crop[k]) < 0.0005) crop[k] = 0
    const hasCrop = Object.values(crop).some(v => v > 0)
    return { ...base, t: 'img', k: o.k, x: r3(Number(o.left) - w / 2), y: r3(Number(o.top) - h / 2), w, h, ...(hasCrop ? { crop } : {}) }
  }
  const isEllipse = o.tmKind === 'ellipse'
  const w = r3((isEllipse ? Number(o.rx) * 2 : Number(o.width)) * sx)
  const h = r3((isEllipse ? Number(o.ry) * 2 : Number(o.height)) * sy)
  const stroke = o.stroke && Number(o.strokeWidth) > 0 ? { color: toHex(o.stroke) || '#000000', width: r3(o.strokeWidth) } : null
  return {
    ...base, t: ['rect', 'ellipse', 'line'].includes(o.tmKind) ? o.tmKind : 'rect',
    x: r3(Number(o.left) - w / 2), y: r3(Number(o.top) - h / 2), w, h,
    fill: toHex(o.fill) || '#000000', stroke: o.tmKind === 'line' ? null : stroke
  }
}

/** The properties objectToItem reads, for pulling them off a live object. */
export const READ_PROPS = ['tmId', 'tmKind', 'tmLocked', 'tmBoxW', 'tmBoxH', 'tmFit', 'tmFitX', 'tmFitY', 'tmIw', 'tmIh', 'k', 'left', 'top', 'angle', 'scaleX', 'scaleY',
  'width', 'height', 'originX', 'originY', 'text', 'styles', 'fontFamily', 'fontSize', 'fill', 'underline', 'fontWeight', 'fontStyle',
  'lineHeight', 'charSpacing', 'textAlign', 'cropX', 'cropY', 'rx', 'ry', 'stroke', 'strokeWidth']

/** Copies of items to paste: new ids, nudged so they do not sit exactly on the originals. */
export function pasteItems(items, offset = 1) {
  return (items || []).map(i => ({ ...JSON.parse(JSON.stringify(i)), id: newItemId(), x: r3(Number(i.x) + offset), y: r3(Number(i.y) + offset) }))
}
