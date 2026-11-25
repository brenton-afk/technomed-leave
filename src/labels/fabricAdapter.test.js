// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { PDFDocument } from 'pdf-lib'
import { itemToSpec, objectToItem, runsToStyles, stylesToRuns, pasteItems } from './fabricAdapter.js'
import { buildLabelPdf, printPixels } from './pdf.js'
import { MM_PER_PT, FABRIC_SIZE_MULT, TRIM_W_PT, TRIM_H_PT } from './model.js'
import { SEED_LABELS, SEED_LOGOS } from '../../api/_labelSeed.js'
import { LOGO_DATA } from '../../api/_labelSeedLogos.js'

const logos = Object.fromEntries(SEED_LOGOS.map(l => [l.k, { ...l, url: LOGO_DATA[l.k] }]))
const named = name => SEED_LABELS.find(l => l.name === name)

/** What the editor would read back off an object built from `spec` and left alone. */
const untouched = spec => ({ ...spec.props, text: spec.text, height: spec.props.height ?? 3 })

describe('model ⇄ Fabric', () => {
  it('turns runs into per-character styles and back, line breaks included', () => {
    const runs = [
      { text: 'Crosslink 35 X 46 mm ', font: 'Mulish', size: 8, color: '#000000', underline: false, bold: false, italic: false },
      { text: 'GREEN\n', font: 'Mulish', size: 8, color: '#4cd43b', underline: true, bold: true, italic: false },
      { text: 'next', font: 'Cormorant Garamond', size: 9, color: '#000000', underline: false, bold: false, italic: true }
    ]
    const { text, styles } = runsToStyles(runs)
    expect(text).toBe('Crosslink 35 X 46 mm GREEN\nnext')
    expect(styles[0][21]).toMatchObject({ fill: '#4cd43b', underline: true, fontWeight: 'bold' })
    expect(styles[1][0]).toMatchObject({ fontFamily: 'Cormorant Garamond', fontStyle: 'italic' })
    expect(styles[0][0].fontSize).toBeCloseTo(8 * MM_PER_PT, 4)
    expect(stylesToRuns(text, styles)).toEqual(runs)
  })

  it('a text item survives the round trip, and its anchor follows the alignment', () => {
    for (const ha of ['left', 'center', 'right']) {
      const item = { id: 'a', t: 'txt', x: 18.42, y: 10.23, w: 33.84, h: 6.75, rot: 0, ha, va: 'top', lh: 1.2, ls: 0,
        runs: [{ text: 'K-Wire (Nitinol)\n1.8 x 500mm', font: 'Mulish', size: 8, color: '#000000', underline: false, bold: false, italic: false }] }
      const spec = itemToSpec(item)
      expect(spec.props.originX).toBe(ha)
      expect(spec.props.lineHeight).toBeCloseTo(1.2 / FABRIC_SIZE_MULT, 3)
      const back = objectToItem({ ...untouched(spec), height: 6.75 })
      expect(back).toMatchObject({ x: 18.42, y: 10.23, w: 33.84, ha, lh: 1.2, runs: item.runs })
    }
  })

  it('a scaled text box becomes bigger type, not a stretched one', () => {
    const item = named('Dakota 18x15 cage').items.find(i => i.t === 'txt')
    const spec = itemToSpec(item)
    const back = objectToItem({ ...untouched(spec), scaleX: 1.5, scaleY: 1.5 })
    expect(back.runs[0].size).toBeCloseTo(item.runs[0].size * 1.5, 2)
  })

  it('a cropped logo keeps its crop and box', () => {
    const blade = named('Mariner Fascial Blade')
    const img = blade.items.find(i => i.t === 'img' && i.crop)
    const spec = itemToSpec(img, { logos })
    expect(spec.props.cropX).toBeCloseTo(img.crop.l * logos[img.k].w, 2)
    const back = objectToItem(untouched(spec))
    expect(back.x).toBeCloseTo(img.x, 2)
    expect(back.w).toBeCloseTo(img.w, 2)
    expect(back.h).toBeCloseTo(img.h, 2)
    for (const s of ['t', 'b', 'l', 'r']) expect(back.crop[s]).toBeCloseTo(img.crop[s], 3)
  })

  it('shapes keep size, colour, stroke, rotation and lock', () => {
    for (const t of ['rect', 'ellipse']) {
      const item = { id: 's', t, x: 2, y: 3, w: 6, h: 20, rot: 15, fill: '#4cd43b', stroke: { color: '#ffffff', width: 0.35 }, locked: true }
      const spec = itemToSpec(item)
      expect(spec.props.lockMovementX).toBe(true)
      expect(objectToItem(untouched(spec))).toEqual(item)
    }
  })

  it('pastes copies with new ids, nudged', () => {
    const [p] = pasteItems([{ id: 'a', t: 'rect', x: 1, y: 2, w: 3, h: 4 }])
    expect(p.id).not.toBe('a')
    expect([p.x, p.y]).toEqual([2, 3])
  })

  it('every seeded label survives model → Fabric → model', () => {
    for (const label of SEED_LABELS) {
      for (const item of label.items) {
        const spec = itemToSpec(item, { logos })
        const back = objectToItem({ ...untouched(spec), height: item.h, ...(item.t === 'txt' ? {} : { height: spec.props.height }) })
        if (item.t === 'txt') expect(back.runs, label.name).toEqual(item.runs)
        expect(back.x, label.name).toBeCloseTo(item.x, 2)
        expect(back.y, label.name).toBeCloseTo(item.y, 2)
        expect(back.w, label.name).toBeCloseTo(item.w, 2)
      }
    }
  })
})

describe('the print file', () => {
  // A 1 × 1 white PNG stands in for the 600 dpi render.
  const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'))

  it('has one 68 × 21 mm page per label printed', async () => {
    const bytes = await buildLabelPdf([{ png: PNG, qty: 3 }, { png: PNG, qty: 2 }, { png: PNG, qty: 0 }])
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(5)
    for (const page of doc.getPages()) {
      const box = page.getMediaBox()
      expect(Math.abs(box.width - 192.756)).toBeLessThan(0.01)
      expect(Math.abs(box.height - 59.528)).toBeLessThan(0.01)
      expect(box.width).toBeCloseTo(TRIM_W_PT, 6)
      expect(box.height).toBeCloseTo(TRIM_H_PT, 6)
    }
  })

  it('refuses an empty print', async () => {
    await expect(buildLabelPdf([{ png: PNG, qty: 0 }])).rejects.toThrow(/quantity/)
  })

  it('draws at 600 dpi', () => {
    expect(printPixels()).toEqual({ width: 1606, height: 496 })
  })
})

// Fabric itself, where node-canvas is installed (it is an optional dependency
// of fabric and may be missing on a build machine).
const require = createRequire(import.meta.url)
let hasCanvas = false
try { require('canvas'); hasCanvas = true } catch { hasCanvas = false }

describe.skipIf(!hasCanvas)('real Fabric objects', () => {
  it('build from every Dakota item, read back the same, and render a 600 dpi PNG', async () => {
    const fabric = await import('fabric/node')
    const { createObject, readObject, renderLabelPng } = await import('./editorCanvas.js')
    const label = named('Dakota 18x15 cage')
    for (const item of label.items) {
      const obj = await createObject(fabric, item, logos)
      const back = readObject(obj)
      expect(back.x).toBeCloseTo(item.x, 2)
      expect(back.y).toBeCloseTo(item.y, 2)
      if (item.t === 'txt') expect(back.runs).toEqual(item.runs)
      else expect(back.w).toBeCloseTo(item.w, 2)
    }
    const png = await renderLabelPng(fabric, label, logos)
    const doc = await PDFDocument.create()
    const img = await doc.embedPng(png)
    expect([img.width, img.height]).toEqual([1606, 496])
    const pdf = await PDFDocument.load(await buildLabelPdf([{ png, qty: 2 }]))
    expect(pdf.getPageCount()).toBe(2)
  }, 30000)
})
