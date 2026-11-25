// The thin layer between the label model and real Fabric objects: build an
// object from an item, read one back, and draw a whole label at print
// resolution. The Fabric module is passed in, so the same code runs in the
// browser (import('fabric')) and in node tests (fabric/node).

import { itemToSpec, objectToItem, READ_PROPS } from './fabricAdapter.js'
import { trimOffset, trimSize, fitFactors } from './model.js'
import { printPixels, printDpiFor } from './pdf.js'

let fabricPromise = null
/** Fabric, loaded only when Label Studio needs it (its own chunk). */
export function loadFabric() {
  if (!fabricPromise) fabricPromise = import('fabric')
  return fabricPromise
}

const images = new Map()
function loadImage(fabric, url) {
  if (!images.has(url)) {
    const p = fabric.util.loadImage(url, { crossOrigin: url.startsWith('data:') ? undefined : 'anonymous' })
    p.catch(() => images.delete(url))
    images.set(url, p)
  }
  return images.get(url)
}

const HIDE_SIDES = { ml: false, mr: false, mt: false, mb: false }

/** Handles each kind shows: text and logos scale in proportion; a line only lengthens. */
export function applyControls(obj, { freeResize = false } = {}) {
  if (!obj.setControlsVisibility) return obj
  if (obj.tmKind === 'txt') obj.setControlsVisibility(HIDE_SIDES)
  else if (obj.tmKind === 'img') obj.setControlsVisibility(freeResize ? {} : HIDE_SIDES)
  else if (obj.tmKind === 'line') obj.setControlsVisibility({ mt: false, mb: false, tl: false, tr: false, bl: false, br: false })
  return obj
}

/** One item → a Fabric object (a promise: a logo has to load first). */
export async function createObject(fabric, item, logos, opts = {}) {
  const spec = itemToSpec(item, { logos })
  let obj
  if (spec.kind === 'text') {
    obj = new fabric.IText(spec.text, { ...spec.props, objectCaching: false })
    applyFit(obj)
  } else if (spec.kind === 'image') {
    let el = null
    if (spec.url) { try { el = await loadImage(fabric, spec.url) } catch { el = null } }
    if (el) {
      obj = new fabric.FabricImage(el, spec.props)
      obj.set({ cropX: spec.props.cropX, cropY: spec.props.cropY, width: spec.props.width, height: spec.props.height, scaleX: spec.props.scaleX, scaleY: spec.props.scaleY })
    } else {
      // A logo that would not load stays as a dashed box of the same size, so
      // saving never drops it.
      obj = new fabric.Rect({ ...spec.props, fill: 'rgba(0,0,0,0)', stroke: '#c9d2da', strokeDashArray: [0.6, 0.4], strokeWidth: 0.15, strokeUniform: true })
    }
  } else if (spec.kind === 'ellipse') {
    obj = new fabric.Ellipse(spec.props)
  } else {
    obj = new fabric.Rect(spec.props)
  }
  obj.set({ cornerSize: 10, transparentCorners: false, cornerColor: '#ffffff', cornerStrokeColor: '#189a85', borderColor: '#189a85', borderScaleFactor: 1.5, padding: 0 })
  return applyControls(obj, opts)
}

/**
 * Squeezes a fitted text box into its box width (model.fitFactors), from
 * Fabric's own measure of its widest line. Called on creation and whenever
 * its words or styles change. Returns the factors.
 */
export function applyFit(obj) {
  if (obj?.tmKind !== 'txt') return { sx: 1, sy: 1 }
  const userX = (Number(obj.scaleX) || 1) / (Number(obj.tmFitX) || 1)
  const userY = (Number(obj.scaleY) || 1) / (Number(obj.tmFitY) || 1)
  const f = obj.tmFit ? fitFactors(Number(obj.width) * userX, Number(obj.tmBoxW) * userX) : { sx: 1, sy: 1 }
  obj.set({ tmFitX: f.sx, tmFitY: f.sy, scaleX: userX * f.sx, scaleY: userY * f.sy })
  obj.setCoords?.()
  return f
}

/** A live Fabric object → an item. */
export function readObject(obj) {
  const bag = {}
  for (const k of READ_PROPS) bag[k] = obj[k]
  return objectToItem(bag)
}

/**
 * The trimmed label as a PNG at `dpi` (600 for print, less for a big sheet
 * label — printDpiFor): Fabric drawing the same objects as the editor, on
 * white, cut to the finished label.
 */
export async function renderLabelPng(fabric, label, logos, { dpi } = {}) {
  const size = trimSize(label)
  const { width, height } = printPixels(dpi || printDpiFor(size), size)
  const k = width / size.w
  const off = trimOffset(label)
  const canvas = new fabric.StaticCanvas(null, { width, height, backgroundColor: '#ffffff', enableRetinaScaling: false, renderOnAddRemove: false })
  canvas.setViewportTransform([k, 0, 0, height / size.h, -off.x * k, -off.y * (height / size.h)])
  for (const item of label.items || []) canvas.add(await createObject(fabric, item, logos))
  canvas.renderAll()
  const el = canvas.getElement ? canvas.getElement() : canvas.lowerCanvasEl
  const bytes = await canvasPng(el)
  canvas.dispose()
  return bytes
}

async function canvasPng(el) {
  if (typeof el.toBlob === 'function' && typeof Blob !== 'undefined' && Blob.prototype.arrayBuffer) {
    const blob = await new Promise(resolve => el.toBlob(resolve, 'image/png'))
    if (blob?.arrayBuffer) return new Uint8Array(await blob.arrayBuffer())
  }
  const b64 = el.toDataURL('image/png').split(',')[1]
  if (typeof atob === 'function') return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

const ORIGIN_X = { left: -0.5, center: 0, right: 0.5 }
const ORIGIN_Y = { top: -0.5, center: 0, bottom: 0.5 }

/**
 * Reads an object as it sits on the label even while it is inside a
 * multi-selection (whose members are positioned relative to the group).
 */
export function readAbsolute(fabric, obj) {
  if (!obj.group) return readObject(obj)
  const d = fabric.util.qrDecompose(obj.calcTransformMatrix())
  const ox = (ORIGIN_X[obj.originX] ?? -0.5) * obj.width * d.scaleX
  const oy = (ORIGIN_Y[obj.originY] ?? -0.5) * obj.height * d.scaleY
  const a = (d.angle * Math.PI) / 180
  const bag = {}
  for (const k of READ_PROPS) bag[k] = obj[k]
  Object.assign(bag, {
    angle: d.angle, scaleX: d.scaleX, scaleY: d.scaleY,
    left: d.translateX + ox * Math.cos(a) - oy * Math.sin(a),
    top: d.translateY + ox * Math.sin(a) + oy * Math.cos(a)
  })
  return objectToItem(bag)
}

/** Fabric 6 names its types 'image' / 'Image', 'activeselection' / 'ActiveSelection' by version. */
export const isImage = obj => /^image$/i.test(String(obj?.type || ''))
export const isMultiSelection = obj => /^activeselection$/i.test(String(obj?.type || ''))

/** Model kinds only — the editor's white "paper" and crop helpers are not items. */
export const isItem = obj => ['txt', 'img', 'rect', 'ellipse', 'line'].includes(obj?.tmKind)
