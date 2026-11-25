// The browser's own measure of a run of label text, in mm — for the SVG
// thumbnails' fit-to-box (the editor and the print measure through Fabric).
// No canvas (jsdom, a server) → null, and nothing is fitted.

import { runFont, MM_PER_PT, fitFactors, naturalWidth } from './model.js'

const PX = 100 // measure large, for precision
let ctx

function context() {
  if (ctx !== undefined) return ctx
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas')
    ctx = c.getContext('2d') || null
  } catch { ctx = null }
  return ctx
}

export function measureRun(text, run) {
  const c = context()
  if (!c || typeof c.measureText !== 'function') return null
  c.font = runFont(run, PX)
  const w = c.measureText(text)?.width
  if (!Number.isFinite(w)) return null
  return (w / PX) * (Number(run.size) || 8) * MM_PER_PT
}

/** { sx, sy } for a fitted text item, or 1 × 1 where nothing can be measured. */
export function fitOf(item) {
  if (!item?.fit) return { sx: 1, sy: 1 }
  if (measureRun('M', { size: 8 }) == null) return { sx: 1, sy: 1 }
  return fitFactors(naturalWidth(item, (t, r) => measureRun(t, r) || 0), item.w)
}
