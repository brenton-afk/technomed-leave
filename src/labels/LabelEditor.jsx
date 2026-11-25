// ─── The label editor (Brent, 25 Nov 2026) ───────────────────────────────
// "It must give us the full functionality of the Vistaprint version." Built
// on Fabric.js — handles, inline text editing, multi-select and rotation are
// Fabric's — with the label model as what is saved (fabricAdapter.js). Fabric
// works in millimetres; the zoom is its viewport.
//
// What it does: text typed on the label itself, per-character font, size,
// bold, italic, underline and colour (swatches, picker, CMYK); alignment,
// line and letter spacing; logos from one shared library or uploaded, swapped,
// cropped and resized in proportion; rectangles, ellipses and lines; move,
// resize, rotate; snapping with guides to the label's centre, trim, safe area
// and other items; align and distribute; layer order; lock; copy, paste,
// duplicate, delete; arrow nudges (0.1 mm, Shift 1 mm); undo and redo;
// zoom; the trim, safe area and bleed shown; a position and size readout in
// mm; save against the version it opened; a warning before leaving unsaved.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius, face, border } from '../design/tokens.js'
import { useBackLayer } from '../backButton.js'
import { loadFabric, createObject, readAbsolute, isItem, applyControls, applyFit, isImage, isMultiSelection } from './editorCanvas.js'
import { loadLabelFonts } from './fonts.js'
import { FONTS, MM_PER_PT, trimOffset, trimSize, hasOwnSize, sizeText, SAFE_MARGIN, LINE_HEIGHT, newItemId, fontName } from './model.js'
import { labelFrames, snapTargets, snapBox, alignBoxes, distributeBoxes, createHistory } from './snap.js'
import { pasteItems, styleToRun } from './fabricAdapter.js'
import { createLabel, saveLabel, uploadLogo, readLogoFile } from './api.js'
import ColourField from './ColourField.jsx'

// Copied items outlive one label, so a logo block can be pasted into another.
let clipboard = []

const PAD = 28
const SNAP_PX = 7
const btn = { ...text('caption'), fontWeight: 600, padding: '7px 10px', borderRadius: radius.control, cursor: 'pointer', font: 'inherit', lineHeight: 1.2, whiteSpace: 'nowrap' }
const tool = (on = false, disabled = false) => ({ ...btn, ...(on ? face.navy : face.secondary), opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer' })
const fieldStyle = { ...text('field'), width: '100%', padding: '6px 8px', border: border.hairline, borderRadius: 8, boxSizing: 'border-box', background: colour.surface, color: colour.ink }
const r2 = v => Math.round(Number(v) * 100) / 100

function Section({ title, children }) {
  return (
    <div style={{ padding: `${space.md}px 0`, borderBottom: border.hairlineSoft }}>
      <div style={{ ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', marginBottom: space.sm }}>{title}</div>
      {children}
    </div>
  )
}

function NumberField({ label, value, onCommit, step = 0.1, suffix, width }) {
  const [draft, setDraft] = useState(null)
  const shown = draft ?? (value === '' || value == null ? '' : String(r2(value)))
  const commit = () => { if (draft != null) { const n = Number(draft); if (Number.isFinite(n)) onCommit(n); setDraft(null) } }
  return (
    <label style={{ display: 'block', width }}>
      <span style={{ ...text('caption'), color: colour.inkFaint }}>{label}{suffix ? ` (${suffix})` : ''}</span>
      <input data-num={label} inputMode="decimal" value={shown} style={fieldStyle}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const n = (Number(shown) || 0) + (e.key === 'ArrowUp' ? step : -step); setDraft(null); onCommit(r2(n)) }
        }} />
    </label>
  )
}

/** Every logo, to add or to swap one in, and Upload for a new one. */
function LogoLibrary({ logos, mode, onPick, onUpload, onClose }) {
  useBackLayer(true, onClose)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const list = Object.values(logos).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return (
    <div data-logo-library role="dialog" aria-label="Logos" onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 3450, background: 'rgba(15,30,43,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
      <div style={{ background: colour.surface, borderRadius: radius.sheet, padding: space.lg, width: '100%', maxWidth: 720, maxHeight: '86dvh', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.md }}>
          <div style={{ ...text('title'), color: colour.ink, flex: 1 }}>{mode === 'replace' ? 'Swap the logo' : 'Add a logo'}</div>
          <label style={{ ...tool(), ...face.primary, display: 'inline-block' }}>
            {busy ? 'Uploading…' : 'Upload a logo'}
            <input type="file" accept="image/png,image/jpeg" data-logo-upload style={{ display: 'none', fontSize: 16 }} disabled={busy}
              onChange={async e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setBusy(true); setError('')
                try { await onUpload(file) } catch (err) { setError(err.message) } finally { setBusy(false) }
              }} />
          </label>
          <button onClick={onClose} aria-label="Close" style={tool()}>✕</button>
        </div>
        <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.md }}>One library for every label. Uploads: PNG or JPEG, up to 2 MB — a transparent PNG looks best.</div>
        {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: space.sm }}>
          {list.map(l => (
            <button key={l.k} data-logo={l.k} onClick={() => onPick(l)}
              style={{ ...face.secondary, borderRadius: radius.card, padding: space.sm, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch', font: 'inherit' }}>
              <span style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff' }}>
                {l.url ? <img src={l.url} alt="" style={{ maxWidth: '100%', maxHeight: 56, objectFit: 'contain' }} /> : null}
              </span>
              <span style={{ ...text('caption'), color: colour.ink, textAlign: 'left' }}>{l.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function LabelEditor({ user, label: initial, logos, onLogosChange, swatches = [], onClose, onSaved, onPrint }) {
  const token = user?.token
  const canvasEl = useRef(null)
  const wrapRef = useRef(null)
  const fcRef = useRef(null)
  const fabricRef = useRef(null)
  const historyRef = useRef(createHistory(150))
  const loadingRef = useRef(false)
  const guidesRef = useRef({ x: null, y: null })
  const cropRef = useRef(null)
  const logosRef = useRef(logos)
  logosRef.current = logos
  // The canvas and, for a sheet label, its own finished size and sheet.
  const geomRef = useRef({ w: initial.w, h: initial.h, ...(hasOwnSize(initial) ? { trim: initial.trim, sheet: initial.sheet } : {}) })

  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState(initial.name)
  const [check, setCheck] = useState(initial.check || '')
  const [meta, setMeta] = useState({ id: initial.id || null, version: initial.version || 0 })
  const [snap, setSnap] = useState(null)
  const [sel, setSel] = useState({ count: 0, items: [], editing: false, rangeStyle: null, locked: false })
  const [zoom, setZoom] = useState({ mode: 'fit', z: 10 })
  const [panel, setPanel] = useState(null)
  const [cropping, setCropping] = useState(false)
  const [freeResize, setFreeResize] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [backToken, setBackToken] = useState(1)
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false })
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 980)

  const labelState = useMemo(() => ({ snap, name, check }), [snap, name, check])
  const [savedState, setSavedState] = useState(null)
  const isDirty = savedState ? (labelState.snap !== savedState.snap || labelState.name !== savedState.name || labelState.check !== savedState.check) : !meta.id

  // ── Reading the canvas ──────────────────────────────────────────────────
  const modelObjects = () => (fcRef.current?.getObjects() || []).filter(isItem)
  const readItems = useCallback(() => modelObjects().map(o => readAbsolute(fabricRef.current, o)), [])
  const selectedObjects = () => {
    const fc = fcRef.current
    if (!fc) return []
    return fc.getActiveObjects().filter(isItem)
  }

  const refreshSel = useCallback(() => {
    const fc = fcRef.current
    if (!fc || !fabricRef.current) return
    const objs = selectedObjects()
    const active = fc.getActiveObject()
    let rangeStyle = null
    if (active?.isEditing && active.selectionStart !== active.selectionEnd) {
      const st = active.getSelectionStyles(active.selectionStart, active.selectionStart + 1)[0] || {}
      rangeStyle = styleToRun({ fontFamily: active.fontFamily, fontSize: active.fontSize, fill: active.fill, underline: active.underline, fontWeight: active.fontWeight, fontStyle: active.fontStyle, ...st })
    }
    const t = objs.length === 1 && objs[0].tmKind === 'txt' ? objs[0] : null
    setSel({
      fit: t ? { on: Boolean(t.tmFit), sx: Number(t.tmFitX) || 1, sy: Number(t.tmFitY) || 1 } : null,
      count: objs.length,
      items: objs.map(o => readAbsolute(fabricRef.current, o)),
      editing: Boolean(active?.isEditing),
      rangeStyle,
      locked: objs.length > 0 && objs.every(o => o.tmLocked)
    })
  }, [])

  const commit = useCallback(() => {
    if (loadingRef.current || !fcRef.current) return
    const s = JSON.stringify(readItems())
    historyRef.current.push(s)
    setSnap(s)
    setUndoState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo })
    refreshSel()
  }, [readItems, refreshSel])

  // ── Building the canvas from items ──────────────────────────────────────
  const loadItems = useCallback(async (items, { select = [] } = {}) => {
    const fc = fcRef.current
    const fabric = fabricRef.current
    loadingRef.current = true
    try {
      fc.discardActiveObject()
      for (const o of modelObjects()) fc.remove(o)
      const objs = []
      for (const item of items) objs.push(await createObject(fabric, item, logosRef.current, { freeResize }))
      fc.add(...objs)
      const chosen = objs.filter(o => select.includes(o.tmId))
      if (chosen.length === 1) fc.setActiveObject(chosen[0])
      else if (chosen.length > 1) fc.setActiveObject(new fabric.ActiveSelection(chosen, { canvas: fc }))
      fc.requestRenderAll()
    } finally {
      loadingRef.current = false
    }
    refreshSel()
  }, [freeResize, refreshSel])

  /** Swaps objects for new ones built from changed items, in the same places in the stack. */
  const replaceItems = useCallback(async (changes, { keepSelection = true } = {}) => {
    const fc = fcRef.current
    const fabric = fabricRef.current
    if (!changes.length) return
    const ids = changes.map(c => c.item.id)
    fc.discardActiveObject()
    loadingRef.current = true
    const made = []
    try {
      for (const { obj, item } of changes) {
        const next = await createObject(fabric, item, logosRef.current, { freeResize })
        const idx = fc.getObjects().indexOf(obj)
        fc.remove(obj)
        fc.insertAt(Math.max(1, idx), next)
        made.push(next)
      }
    } finally { loadingRef.current = false }
    if (keepSelection) {
      const chosen = modelObjects().filter(o => ids.includes(o.tmId))
      if (chosen.length === 1) fc.setActiveObject(chosen[0])
      else if (chosen.length > 1) fc.setActiveObject(new fabric.ActiveSelection(chosen, { canvas: fc }))
    }
    fc.requestRenderAll()
    commit()
    return made
  }, [commit, freeResize])

  const updateSelected = useCallback(async fn => {
    const objs = selectedObjects()
    if (!objs.length) return
    const changes = objs.map(obj => ({ obj, item: fn(readAbsolute(fabricRef.current, obj)) })).filter(c => c.item)
    await replaceItems(changes)
  }, [replaceItems])

  // ── Zoom and drawing the guides ─────────────────────────────────────────
  const layout = useCallback((mode = zoom.mode, z = zoom.z) => {
    const fc = fcRef.current
    const wrap = wrapRef.current
    if (!fc || !wrap) return
    const { w, h } = geomRef.current
    const cw = Math.max(280, wrap.clientWidth)
    const fit = (cw - 2 * PAD) / w
    const zz = mode === 'fit' ? fit : z
    const width = Math.max(cw, Math.ceil(w * zz + 2 * PAD))
    const height = Math.ceil(h * zz + 2 * PAD)
    fc.setDimensions({ width, height })
    fc.setViewportTransform([zz, 0, 0, zz, (width - w * zz) / 2, PAD])
    fc.requestRenderAll()
    if (mode === 'fit' && zoom.z !== zz) setZoom({ mode: 'fit', z: zz })
  }, [zoom])

  // ── Setting up Fabric ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let fc = null
    ;(async () => {
      try {
        await loadLabelFonts()
        const fabric = await loadFabric()
        if (cancelled) return
        fabric.cache?.clearFontCache?.()
        fabricRef.current = fabric
        fc = new fabric.Canvas(canvasEl.current, {
          preserveObjectStacking: true, selection: true, backgroundColor: '#e9eef2', stopContextMenu: true,
          uniformScaling: true, enableRetinaScaling: true, fireRightClick: false, targetFindTolerance: 4
        })
        fcRef.current = fc
        const { w, h } = geomRef.current
        // The paper: the label's canvas, white, under everything; never an item.
        const paper = new fabric.Rect({ left: 0, top: 0, width: w, height: h, fill: '#ffffff', selectable: false, evented: false, hoverCursor: 'default', tmKind: 'paper', strokeWidth: 0 })
        fc.add(paper)
        fabric.FabricObject.prototype.snapAngle = 45
        fabric.FabricObject.prototype.snapThreshold = 4

        fc.on('after:render', ({ ctx }) => drawGuides(ctx))
        fc.on('selection:created', refreshSel)
        fc.on('selection:updated', refreshSel)
        fc.on('selection:cleared', refreshSel)
        fc.on('text:selection:changed', refreshSel)
        fc.on('text:editing:entered', refreshSel)
        fc.on('text:editing:exited', () => commit())
        // Typing into a fitted box re-fits it as the words change.
        fc.on('text:changed', e => { if (e.target?.tmFit) { applyFit(e.target); fc.requestRenderAll(); requestAnimationFrame(refreshSel) } })
        fc.on('object:moving', onMoving)
        fc.on('object:scaling', () => requestAnimationFrame(refreshSel))
        fc.on('object:rotating', () => requestAnimationFrame(refreshSel))
        fc.on('mouse:up', () => { guidesRef.current = { x: null, y: null }; fc.requestRenderAll() })
        fc.on('object:modified', onModified)

        await loadItems(initial.items || [])
        const s = JSON.stringify(readItems())
        historyRef.current.reset(s)
        setSnap(s)
        setSavedState(initial.id ? { snap: s, name: initial.name, check: initial.check || '' } : null)
        setReady(true)
        layout('fit')
      } catch (err) {
        console.error('label editor failed to start', err)
        setLoadError('The editor could not start — check the connection and try again.')
      }
    })()
    return () => { cancelled = true; if (fc) fc.dispose() }
    // Set up once per label opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onResize = () => { setWide(window.innerWidth >= 980); if (zoom.mode === 'fit') layout('fit') }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [layout, zoom.mode])
  useEffect(() => { if (ready) layout() }, [wide, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  function drawGuides(ctx) {
    const fc = fcRef.current
    if (!fc) return
    const v = fc.viewportTransform
    const z = v[0]
    const { w, h } = geomRef.current
    const off = trimOffset(geomRef.current)
    const { w: TRIM_W, h: TRIM_H } = trimSize(geomRef.current)
    ctx.save()
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5])
    // Bleed: shaded outside the trim.
    ctx.fillStyle = 'rgba(15,30,43,0.10)'
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.rect(off.x + TRIM_W, off.y, -TRIM_W, TRIM_H)
    ctx.fill('evenodd')
    ctx.lineWidth = 1.2 / z
    ctx.strokeStyle = '#b42318'
    ctx.setLineDash([])
    ctx.strokeRect(off.x, off.y, TRIM_W, TRIM_H)
    ctx.strokeStyle = '#189a85'
    ctx.setLineDash([5 / z, 4 / z])
    ctx.lineWidth = 1 / z
    ctx.strokeRect(off.x + SAFE_MARGIN, off.y + SAFE_MARGIN, TRIM_W - 2 * SAFE_MARGIN, TRIM_H - 2 * SAFE_MARGIN)
    const g = guidesRef.current
    ctx.strokeStyle = '#d6337a'
    ctx.setLineDash([])
    ctx.lineWidth = 1 / z
    if (g.x != null) { ctx.beginPath(); ctx.moveTo(g.x, -PAD / z); ctx.lineTo(g.x, h + PAD / z); ctx.stroke() }
    if (g.y != null) { ctx.beginPath(); ctx.moveTo(-PAD / z, g.y); ctx.lineTo(w + PAD / z, g.y); ctx.stroke() }
    ctx.restore()
  }

  function onMoving(e) {
    const fc = fcRef.current
    const target = e.target
    if (!target || cropRef.current) return
    if (e.e?.altKey) { guidesRef.current = { x: null, y: null }; return }
    const moving = new Set(isMultiSelection(target) ? target.getObjects() : [target])
    const others = modelObjects().filter(o => !moving.has(o)).map(o => o.getBoundingRect())
    const box = target.getBoundingRect()
    const s = snapBox(box, snapTargets(geomRef.current, others), SNAP_PX / fc.viewportTransform[0])
    if (s.dx || s.dy) {
      target.set({ left: target.left + s.dx, top: target.top + s.dy })
      target.setCoords()
    }
    guidesRef.current = s.guides
    requestAnimationFrame(refreshSel)
  }

  async function onModified(e) {
    const t = e.target
    if (!t || cropRef.current) return
    // A text box scaled with its corner becomes bigger type, not stretched type.
    const objs = isMultiSelection(t) ? [] : [t]
    const scaledText = objs.filter(o => o.tmKind === 'txt' && (Math.abs(o.scaleX / (o.tmFitX || 1) - 1) > 1e-6 || Math.abs(o.scaleY / (o.tmFitY || 1) - 1) > 1e-6))
    if (scaledText.length) {
      await replaceItems(scaledText.map(obj => ({ obj, item: readAbsolute(fabricRef.current, obj) })))
      return
    }
    commit()
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  const centre = () => { const off = trimOffset(geomRef.current); const t = trimSize(geomRef.current); return { x: off.x + t.w / 2, y: off.y + t.h / 2 } }

  async function addItem(item, { edit = false } = {}) {
    const fc = fcRef.current
    const obj = await createObject(fabricRef.current, item, logosRef.current, { freeResize })
    fc.add(obj)
    fc.setActiveObject(obj)
    if (edit && obj.enterEditing) { obj.enterEditing(); obj.selectAll() }
    fc.requestRenderAll()
    commit()
  }

  const addText = () => {
    const c = centre()
    addItem({ id: newItemId(), t: 'txt', x: c.x - 15, y: c.y - 2, w: 30, h: 4, rot: 0, ha: 'center', va: 'top', lh: LINE_HEIGHT, ls: 0,
      runs: [{ text: 'Your text', font: 'Mulish', size: 8, color: '#000000', underline: false, bold: false, italic: false }] }, { edit: true })
  }
  const addShape = t => {
    const c = centre()
    const size = t === 'line' ? { w: 20, h: 0.3 } : { w: 10, h: 6 }
    addItem({ id: newItemId(), t, x: c.x - size.w / 2, y: c.y - size.h / 2, ...size, rot: 0, fill: t === 'line' ? '#000000' : '#1caade', stroke: null })
  }
  const addLogo = logo => {
    const c = centre()
    const ratio = (logo.w || 4) / (logo.h || 1)
    let h = 4
    let w = h * ratio
    if (w > 30) { w = 30; h = w / ratio }
    addItem({ id: newItemId(), t: 'img', k: logo.k, x: c.x - w / 2, y: c.y - h / 2, w, h, rot: 0 })
  }
  const swapLogo = logo => updateSelected(item => {
    if (item.t !== 'img') return null
    const ratio = (logo.w || 1) / (logo.h || 1)
    const cx = item.x + item.w / 2
    const w = item.h * ratio
    const { crop: _c, ...rest } = item
    return { ...rest, k: logo.k, x: cx - w / 2, w }
  })

  async function removeSelected() {
    const fc = fcRef.current
    const objs = selectedObjects().filter(o => !o.tmLocked)
    if (!objs.length) return
    fc.discardActiveObject()
    for (const o of objs) fc.remove(o)
    fc.requestRenderAll()
    commit()
  }
  function copySelected() {
    clipboard = selectedObjects().map(o => readAbsolute(fabricRef.current, o))
    setMessage({ tone: 'info', text: `${clipboard.length} copied` })
  }
  async function paste(items = clipboard) {
    if (!items.length) return
    const fc = fcRef.current
    const copies = pasteItems(items)
    const objs = []
    for (const item of copies) objs.push(await createObject(fabricRef.current, item, logosRef.current, { freeResize }))
    fc.discardActiveObject()
    fc.add(...objs)
    fc.setActiveObject(objs.length === 1 ? objs[0] : new fabricRef.current.ActiveSelection(objs, { canvas: fc }))
    fc.requestRenderAll()
    commit()
  }
  const duplicateSelected = () => paste(selectedObjects().map(o => readAbsolute(fabricRef.current, o)))

  function layer(how) {
    const fc = fcRef.current
    const objs = selectedObjects()
    for (const o of how === 'forward' || how === 'front' ? [...objs].reverse() : objs) {
      if (how === 'forward') fc.bringObjectForward(o)
      if (how === 'backward') fc.sendObjectBackwards(o)
      if (how === 'front') fc.bringObjectToFront(o)
      if (how === 'back') fc.moveObjectTo(o, 1)
      if (fc.getObjects().indexOf(o) === 0) fc.moveObjectTo(o, 1) // never under the paper
    }
    fc.requestRenderAll()
    commit()
  }

  function toggleLock() {
    const lock = !sel.locked
    updateSelected(item => ({ ...item, locked: lock || undefined }))
  }

  /** Moves the selected objects by (dx, dy) mm each, keeping the selection. */
  function moveEach(moves) {
    const fc = fcRef.current
    const fabric = fabricRef.current
    const objs = selectedObjects()
    fc.discardActiveObject()
    objs.forEach((o, i) => { o.set({ left: o.left + moves[i].dx, top: o.top + moves[i].dy }); o.setCoords() })
    if (objs.length > 1) fc.setActiveObject(new fabric.ActiveSelection(objs, { canvas: fc }))
    else if (objs[0]) fc.setActiveObject(objs[0])
    fc.requestRenderAll()
    commit()
  }
  function align(mode) {
    const fc = fcRef.current
    const objs = selectedObjects().filter(o => !o.tmLocked)
    if (!objs.length) return
    fc.discardActiveObject()
    const boxes = objs.map(o => o.getBoundingRect())
    const moves = alignBoxes(boxes, mode, labelFrames(geomRef.current).trim)
    objs.forEach((o, i) => { o.set({ left: o.left + moves[i].dx, top: o.top + moves[i].dy }); o.setCoords() })
    fc.setActiveObject(objs.length > 1 ? new fabricRef.current.ActiveSelection(objs, { canvas: fc }) : objs[0])
    fc.requestRenderAll()
    commit()
  }
  function distribute(axis) {
    const fc = fcRef.current
    const objs = selectedObjects().filter(o => !o.tmLocked)
    if (objs.length < 3) return
    fc.discardActiveObject()
    const moves = distributeBoxes(objs.map(o => o.getBoundingRect()), axis)
    objs.forEach((o, i) => { o.set({ left: o.left + moves[i].dx, top: o.top + moves[i].dy }); o.setCoords() })
    fc.setActiveObject(new fabricRef.current.ActiveSelection(objs, { canvas: fc }))
    fc.requestRenderAll()
    commit()
  }
  function nudge(dx, dy) {
    const fc = fcRef.current
    const a = fc.getActiveObject()
    if (!a || a.lockMovementX) return
    a.set({ left: a.left + dx, top: a.top + dy })
    a.setCoords()
    fc.requestRenderAll()
    commit()
  }

  async function undo() {
    const s = historyRef.current.undo()
    if (s == null) return
    await loadItems(JSON.parse(s))
    setSnap(s)
    setUndoState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo })
  }
  async function redo() {
    const s = historyRef.current.redo()
    if (s == null) return
    await loadItems(JSON.parse(s))
    setSnap(s)
    setUndoState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo })
  }

  // ── Text styling: the highlighted letters while typing, else the whole box ─
  const FABRIC_STYLE = {
    font: v => ({ fontFamily: fontName(v) }), size: v => ({ fontSize: Number(v) * MM_PER_PT }), color: v => ({ fill: v }),
    bold: v => ({ fontWeight: v ? 'bold' : 'normal' }), italic: v => ({ fontStyle: v ? 'italic' : 'normal' }), underline: v => ({ underline: Boolean(v) })
  }
  function styleText(key, value) {
    const fc = fcRef.current
    const a = fc.getActiveObject()
    if (a?.isEditing && a.selectionStart !== a.selectionEnd) {
      a.setSelectionStyles(FABRIC_STYLE[key](value))
      a.initDimensions?.()
      applyFit(a)
      a.setCoords()
      fc.requestRenderAll()
      commit()
      return
    }
    updateSelected(item => (item.t === 'txt' ? { ...item, runs: item.runs.map(r => ({ ...r, [key]: value })) } : null))
  }
  const setTextProp = (key, value) => updateSelected(item => (item.t === 'txt' ? { ...item, [key]: value } : null))

  // ── Crop: the whole picture faint, a frame to drag over the part to keep ──
  async function startCrop() {
    const fc = fcRef.current
    const fabric = fabricRef.current
    const obj = selectedObjects()[0]
    if (!obj || obj.tmKind !== 'img' || !isImage(obj)) return
    if (Math.abs(obj.angle % 360) > 0.01) { setMessage({ tone: 'warning', text: 'Straighten the logo (rotation 0) before cropping it.' }); return }
    const item = readAbsolute(fabric, obj)
    const logo = logosRef.current[item.k]
    const iw = obj.tmIw; const ih = obj.tmIh
    const sx = item.w / obj.width; const sy = item.h / obj.height
    const fullLeft = item.x - (obj.cropX || 0) * sx
    const fullTop = item.y - (obj.cropY || 0) * sy
    const ghost = new fabric.FabricImage(obj.getElement(), { left: fullLeft, top: fullTop, originX: 'left', originY: 'top', scaleX: sx, scaleY: sy, opacity: 0.35, selectable: false, evented: false, tmKind: 'crop' })
    ghost.set({ width: iw, height: ih, cropX: 0, cropY: 0 })
    const frame = new fabric.Rect({ left: item.x, top: item.y, width: item.w, height: item.h, originX: 'left', originY: 'top', fill: 'rgba(24,154,133,0.08)', stroke: '#189a85', strokeWidth: 0.15, strokeDashArray: [0.5, 0.35], tmKind: 'crop', lockRotation: true, cornerColor: '#ffffff', cornerStrokeColor: '#189a85', transparentCorners: false, cornerSize: 10 })
    frame.setControlsVisibility({ mtr: false })
    const bounds = { left: fullLeft, top: fullTop, right: fullLeft + iw * sx, bottom: fullTop + ih * sy }
    const clamp = () => {
      const w = Math.min(frame.width * frame.scaleX, bounds.right - bounds.left)
      const h = Math.min(frame.height * frame.scaleY, bounds.bottom - bounds.top)
      frame.set({ width: w, height: h, scaleX: 1, scaleY: 1 })
      frame.set({ left: Math.min(Math.max(frame.left, bounds.left), bounds.right - w), top: Math.min(Math.max(frame.top, bounds.top), bounds.bottom - h) })
      frame.setCoords()
    }
    frame.on('moving', clamp)
    frame.on('modified', clamp)
    obj.set({ visible: false })
    fc.discardActiveObject()
    fc.add(ghost, frame)
    fc.setActiveObject(frame)
    cropRef.current = { obj, item, ghost, frame, bounds, iw, ih, sx, sy, logo }
    setCropping(true)
    fc.requestRenderAll()
  }
  async function endCrop(apply) {
    const fc = fcRef.current
    const c = cropRef.current
    if (!c) return
    cropRef.current = null
    setCropping(false)
    const { obj, item, ghost, frame, bounds } = c
    const fw = frame.width * frame.scaleX
    const fh = frame.height * frame.scaleY
    fc.remove(ghost, frame)
    obj.set({ visible: true })
    if (!apply) { fc.setActiveObject(obj); fc.requestRenderAll(); return }
    const fullW = bounds.right - bounds.left
    const fullH = bounds.bottom - bounds.top
    const crop = {
      l: (frame.left - bounds.left) / fullW, t: (frame.top - bounds.top) / fullH,
      r: (bounds.right - frame.left - fw) / fullW, b: (bounds.bottom - frame.top - fh) / fullH
    }
    for (const k of Object.keys(crop)) crop[k] = Math.max(0, Math.round(crop[k] * 10000) / 10000)
    await replaceItems([{ obj, item: { ...item, x: frame.left, y: frame.top, w: fw, h: fh, crop } }])
  }
  const resetCrop = () => updateSelected(item => {
    if (item.t !== 'img' || !item.crop) return null
    const c = item.crop
    const fullW = item.w / (1 - c.l - c.r)
    const fullH = item.h / (1 - c.t - c.b)
    const { crop: _c, ...rest } = item
    return { ...rest, x: item.x - c.l * fullW, y: item.y - c.t * fullH, w: fullW, h: fullH }
  })

  useEffect(() => {
    for (const o of modelObjects()) applyControls(o, { freeResize })
    fcRef.current?.requestRenderAll()
  }, [freeResize])

  // ── Saving ──────────────────────────────────────────────────────────────
  async function save({ force = false } = {}) {
    if (cropRef.current) await endCrop(true)
    const fc = fcRef.current
    const a = fc?.getActiveObject()
    if (a?.isEditing) a.exitEditing()
    const items = readItems()
    const g = geomRef.current
    const body = { name: name.trim() || 'Untitled label', w: g.w, h: g.h, items, ...(check ? { check } : {}), ...(g.trim ? { trim: g.trim, ...(g.sheet ? { sheet: g.sheet } : {}) } : {}) }
    setSaving(true); setMessage(null)
    try {
      const out = meta.id
        ? await saveLabel(token, meta.id, body, force ? conflict?.current?.version : meta.version)
        : await createLabel(token, body)
      const saved = out.label
      setMeta({ id: saved.id, version: saved.version })
      const s = JSON.stringify(items)
      setSnap(s)
      setSavedState({ snap: s, name: saved.name, check: saved.check || '' })
      setName(saved.name)
      setConflict(null)
      setMessage({ tone: 'info', text: 'Saved' })
      onSaved?.(saved)
      return saved
    } catch (err) {
      if (err.status === 409) setConflict({ current: err.data.current, text: err.message })
      else setMessage({ tone: 'danger', text: `Not saved — ${err.message}` })
      return null
    } finally { setSaving(false) }
  }
  async function loadTheirs() {
    const cur = conflict.current
    await loadItems(cur.items || [])
    const s = JSON.stringify(readItems())
    historyRef.current.reset(s)
    setSnap(s); setName(cur.name); setCheck(cur.check || '')
    setMeta({ id: cur.id, version: cur.version })
    setSavedState({ snap: s, name: cur.name, check: cur.check || '' })
    setConflict(null)
    onSaved?.(cur)
  }

  // ── Leaving ─────────────────────────────────────────────────────────────
  const requestClose = useCallback(() => {
    if (isDirty) { setConfirmLeave(true); return false }
    onClose()
    return true
  }, [isDirty, onClose])
  useBackLayer(backToken, () => { if (!requestClose()) setBackToken(t => t + 1) })
  useEffect(() => {
    if (!isDirty) return undefined
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      const fc = fcRef.current
      if (!fc || panel || confirmLeave) return
      const mod = e.metaKey || e.ctrlKey
      const editing = Boolean(fc.getActiveObject()?.isEditing)
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') && !editing
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return }
      if (inField) return
      if (editing) { if (e.key === 'Escape') { fc.getActiveObject().exitEditing(); fc.requestRenderAll() } return }
      if (cropRef.current) {
        if (e.key === 'Enter') { e.preventDefault(); endCrop(true) }
        if (e.key === 'Escape') { e.preventDefault(); endCrop(false) }
        return
      }
      const k = e.key.toLowerCase()
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && k === 'y') { e.preventDefault(); redo(); return }
      if (mod && k === 'c') { e.preventDefault(); copySelected(); return }
      if (mod && k === 'x') { e.preventDefault(); copySelected(); removeSelected(); return }
      if (mod && k === 'v') { e.preventDefault(); paste(); return }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return }
      if (mod && k === 'a') { e.preventDefault(); const objs = modelObjects(); if (objs.length) { fc.setActiveObject(objs.length > 1 ? new fabricRef.current.ActiveSelection(objs, { canvas: fc }) : objs[0]); fc.requestRenderAll() } return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return }
      if (e.key === 'Escape') { fc.discardActiveObject(); fc.requestRenderAll(); return }
      const step = e.shiftKey ? 1 : 0.1
      const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (arrows[e.key] && fc.getActiveObject()) { e.preventDefault(); nudge(...arrows[e.key]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── What the inspector shows ─────────────────────────────────────────────
  const one = sel.count === 1 ? sel.items[0] : null
  const texts = sel.items.filter(i => i.t === 'txt')
  const firstRun = sel.rangeStyle || texts[0]?.runs?.[0] || null
  const off = trimOffset(geomRef.current)
  const setGeom = (key, v) => updateSelected(item => {
    const next = { ...item }
    if (key === 'x') next.x = v + off.x
    if (key === 'y') next.y = v + off.y
    if (key === 'w') {
      if (item.t === 'txt') return null
      if (item.t === 'img' && !freeResize) { next.h = item.h * (v / item.w) }
      next.w = Math.max(0.2, v)
    }
    if (key === 'h') {
      if (item.t === 'txt') return null
      if (item.t === 'img' && !freeResize) { next.w = item.w * (v / item.h) }
      next.h = Math.max(0.05, v)
    }
    if (key === 'rot') next.rot = v
    return next
  })

  const zoomBy = f => { const z = Math.min(80, Math.max(3, zoom.z * f)); setZoom({ mode: 'manual', z }); layout('manual', z) }
  const fitZoom = () => { setZoom({ mode: 'fit', z: zoom.z }); layout('fit') }

  const hasSel = sel.count > 0
  const unlockedSel = hasSel && !sel.locked

  const inspector = (
    <div data-label-inspector style={{ padding: `0 ${space.lg}px ${space.xl}px` }}>
      {check && (
        <div data-label-check style={{ margin: `${space.md}px 0`, padding: space.md, borderRadius: radius.control, background: colour.warningSoft, border: `1px solid ${colour.warningLine}`, color: colour.warning, ...text('caption') }}>
          <strong>To check:</strong> {check}
          <div><button onClick={() => setCheck('')} style={{ ...tool(), marginTop: 6 }}>Mark as checked</button></div>
        </div>
      )}
      {!hasSel && (
        <Section title="Label">
          <div style={{ ...text('caption'), color: colour.inkMuted, lineHeight: 1.6 }}>
            {hasOwnSize(geomRef.current)
              ? <>{sizeText(geomRef.current)} finished (red line){geomRef.current.sheet?.name ? ` · ${geomRef.current.sheet.name}` : ''}. Keep words inside the dashed safe area.<br /></>
              : <>68 × 21 mm finished (red line), {geomRef.current.w} × {geomRef.current.h} mm with bleed (shaded). Keep words inside the dashed safe area.<br /></>}
            Click an item to select it; Shift-click or drag a box to select several. Double-click text to type on the label. Arrow keys nudge 0.1 mm (Shift: 1 mm); hold Alt while dragging to stop snapping.
          </div>
        </Section>
      )}
      {hasSel && (
        <Section title={sel.count === 1 ? ({ txt: 'Text', img: 'Logo', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' }[one?.t] || 'Item') : `${sel.count} items`}>
          {one && (
            <div data-readout style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: space.sm }}>
              <NumberField label="X" suffix="mm" value={one.x - off.x} onCommit={v => setGeom('x', v)} />
              <NumberField label="Y" suffix="mm" value={one.y - off.y} onCommit={v => setGeom('y', v)} />
              <NumberField label="Turn" suffix="°" step={1} value={one.rot || 0} onCommit={v => setGeom('rot', v)} />
              {one.t !== 'txt' && <NumberField label="W" suffix="mm" value={one.w} onCommit={v => setGeom('w', v)} />}
              {one.t !== 'txt' && <NumberField label="H" suffix="mm" value={one.h} onCommit={v => setGeom('h', v)} />}
            </div>
          )}
          {one && <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 6 }}>From the label's top-left corner (the trim).</div>}
        </Section>
      )}
      {texts.length > 0 && firstRun && (
        <Section title={sel.rangeStyle ? 'Highlighted letters' : 'Type'}>
          <label style={{ display: 'block', marginBottom: space.sm }}>
            <span style={{ ...text('caption'), color: colour.inkFaint }}>Font</span>
            <select data-font value={fontName(firstRun.font)} onChange={e => styleText('font', e.target.value)} style={fieldStyle}>
              {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}{f === 'Mulish' ? ' (for Apertura)' : f === 'Cormorant Garamond' ? ' (for Borges Titulo)' : ''}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: space.sm, alignItems: 'flex-end', marginBottom: space.sm }}>
            <div style={{ width: 90 }}><NumberField label="Size" suffix="pt" step={0.5} value={firstRun.size} onCommit={v => styleText('size', Math.max(3, Math.min(72, v)))} /></div>
            <button aria-label="Bold" aria-pressed={Boolean(firstRun.bold)} data-style-bold onClick={() => styleText('bold', !firstRun.bold)} style={{ ...tool(firstRun.bold), fontWeight: 800, minWidth: 38 }}>B</button>
            <button aria-label="Italic" aria-pressed={Boolean(firstRun.italic)} onClick={() => styleText('italic', !firstRun.italic)} style={{ ...tool(firstRun.italic), fontStyle: 'italic', minWidth: 38 }}>I</button>
            <button aria-label="Underline" aria-pressed={Boolean(firstRun.underline)} onClick={() => styleText('underline', !firstRun.underline)} style={{ ...tool(firstRun.underline), textDecoration: 'underline', minWidth: 38 }}>U</button>
          </div>
          <ColourField label="Text colour" value={firstRun.color} swatches={swatches} onChange={v => v && styleText('color', v)} />
          {!sel.rangeStyle && (
            <>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>Alignment</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: space.sm }}>
                {[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([v, l]) => (
                  <button key={v} data-align-text={v} aria-pressed={texts[0].ha === v} onClick={() => setTextProp('ha', v)} style={tool(texts[0].ha === v)}>{l}</button>
                ))}
              </div>
              {sel.fit && (
                <div data-fit-panel style={{ margin: `${space.sm}px 0`, padding: space.sm, borderRadius: radius.control, background: colour.canvas, border: border.hairlineSoft }}>
                  <label style={{ ...text('caption'), color: colour.ink, display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
                    <input type="checkbox" data-fit-toggle style={{ fontSize: 16 }} checked={sel.fit.on} onChange={e => setTextProp('fit', e.target.checked || undefined)} />
                    Fit to its box width
                  </label>
                  <div data-fit-hint style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>
                    {!sel.fit.on ? `Off — a line longer than the box (${r2(texts[0].w)} mm) runs past it.`
                      : sel.fit.sx >= 0.9995 ? `Fits its ${r2(texts[0].w)} mm box as typed.`
                        : `Fitted to its ${r2(texts[0].w)} mm box: letters at ${Math.round(sel.fit.sx * 100)}% width${sel.fit.sy < 0.9995 ? `, type at ${Math.round(sel.fit.sy * 100)}% size` : ''}. This is what prints.`}
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.sm }}>
                <NumberField label="Line spacing" suffix="×" step={0.05} value={texts[0].lh ?? LINE_HEIGHT} onCommit={v => setTextProp('lh', Math.max(0.5, Math.min(4, v)))} />
                <NumberField label="Letter spacing" step={10} value={texts[0].ls || 0} onCommit={v => setTextProp('ls', Math.max(-200, Math.min(2000, v)))} />
              </div>
            </>
          )}
          {!sel.editing && <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 6 }}>Double-click the text to type; highlight letters to style only those.</div>}
        </Section>
      )}
      {one?.t === 'img' && (
        <Section title="Logo">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: space.sm }}>
            <button data-swap-logo onClick={() => setPanel('replace')} style={tool()}>Swap logo</button>
            {!cropping && <button data-crop onClick={startCrop} style={tool()}>Crop</button>}
            {one.crop && !cropping && <button onClick={resetCrop} style={tool()}>Undo crop</button>}
          </div>
          <label style={{ ...text('caption'), color: colour.inkMuted, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" style={{ fontSize: 16 }} checked={!freeResize} onChange={e => setFreeResize(!e.target.checked)} /> Keep proportions when resizing
          </label>
        </Section>
      )}
      {one && ['rect', 'ellipse', 'line'].includes(one.t) && (
        <Section title={one.t === 'line' ? 'Line' : 'Shape'}>
          <ColourField label={one.t === 'line' ? 'Colour' : 'Fill'} value={one.fill} swatches={swatches} allowNone={one.t !== 'line'} onChange={v => updateSelected(i => (v ? { ...i, fill: v } : i.t === 'line' ? null : { ...i, fill: 'none' }))} />
          {one.t === 'line' && <NumberField label="Thickness" suffix="mm" value={one.h} onCommit={v => setGeom('h', Math.max(0.05, v))} />}
          {one.t !== 'line' && (
            <>
              <ColourField label="Outline" allowNone value={one.stroke?.color || null} swatches={swatches}
                onChange={v => updateSelected(i => ({ ...i, stroke: v ? { color: v, width: i.stroke?.width || 0.3 } : null }))} />
              {one.stroke && <NumberField label="Outline width" suffix="mm" step={0.05} value={one.stroke.width} onCommit={v => updateSelected(i => ({ ...i, stroke: { ...i.stroke, width: Math.max(0.05, v) } }))} />}
            </>
          )}
        </Section>
      )}
    </div>
  )

  const bar = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }
  const sep = <span style={{ width: 1, alignSelf: 'stretch', background: colour.line, margin: '0 2px' }} />

  return (
    <Overlay>
      <div data-label-editor role="dialog" aria-label={`Edit ${name}`}
        style={{ position: 'fixed', inset: 0, zIndex: 3300, background: colour.canvas, display: 'flex', flexDirection: 'column', fontFamily: 'inherit' }}>
        {/* Top bar: close, name, save state, undo, zoom, print, save */}
        <div style={{ ...bar, padding: `${space.sm}px ${space.md}px`, paddingTop: `calc(${space.sm}px + env(safe-area-inset-top))`, background: colour.surface, borderBottom: border.hairline }}>
          <button aria-label="Close the editor" data-editor-close onClick={requestClose} style={tool()}>✕</button>
          <input aria-label="Label name" data-label-name value={name} onChange={e => setName(e.target.value)}
            style={{ ...fieldStyle, flex: '1 1 200px', width: 'auto', fontWeight: 600 }} />
          <span data-save-state style={{ ...text('caption'), color: isDirty ? colour.warning : colour.inkFaint, minWidth: 90 }}>{isDirty ? '● Unsaved changes' : meta.id ? 'All saved' : ''}</span>
          <button aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!undoState.canUndo} onClick={undo} style={tool(false, !undoState.canUndo)}>↶ Undo</button>
          <button aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!undoState.canRedo} onClick={redo} style={tool(false, !undoState.canRedo)}>↷ Redo</button>
          {sep}
          <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)} style={tool()}>−</button>
          <button aria-label="Fit to screen" onClick={fitZoom} style={tool(zoom.mode === 'fit')}>Fit</button>
          <button aria-label="Zoom in" onClick={() => zoomBy(1.25)} style={tool()}>+</button>
          <span style={{ ...text('caption'), color: colour.inkFaint, minWidth: 44 }}>{Math.round((zoom.z / (96 / 25.4)) * 100)}%</span>
          {sep}
          <button data-editor-print onClick={() => onPrint?.({ ...initial, id: meta.id, version: meta.version, name, check, items: readItems() })} style={tool()}>Print…</button>
          <button data-editor-save disabled={saving} onClick={() => save()} style={{ ...btn, ...face.primary, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
        {/* Insert and arrange */}
        <div data-editor-toolbar style={{ ...bar, padding: `${space.sm}px ${space.md}px`, background: colour.surface, borderBottom: border.hairline }}>
          <button data-add-text onClick={addText} style={tool()}>＋ Text</button>
          <button data-add-logo onClick={() => setPanel('add')} style={tool()}>＋ Logo</button>
          <button data-add-rect onClick={() => addShape('rect')} style={tool()}>＋ Rectangle</button>
          <button data-add-ellipse onClick={() => addShape('ellipse')} style={tool()}>＋ Ellipse</button>
          <button data-add-line onClick={() => addShape('line')} style={tool()}>＋ Line</button>
          {sep}
          <button title="Copy (Ctrl/⌘ C)" disabled={!hasSel} onClick={copySelected} style={tool(false, !hasSel)}>Copy</button>
          <button title="Paste (Ctrl/⌘ V)" disabled={!clipboard.length} onClick={() => paste()} style={tool(false, !clipboard.length)}>Paste</button>
          <button title="Duplicate (Ctrl/⌘ D)" data-duplicate-item disabled={!hasSel} onClick={duplicateSelected} style={tool(false, !hasSel)}>Duplicate</button>
          <button title="Delete" data-delete-item disabled={!unlockedSel} onClick={removeSelected} style={tool(false, !unlockedSel)}>Delete</button>
          <button data-lock disabled={!hasSel} onClick={toggleLock} style={tool(sel.locked, !hasSel)}>{sel.locked ? 'Unlock' : 'Lock'}</button>
          {sep}
          <span style={{ ...text('caption'), color: colour.inkFaint }}>Layer</span>
          <button title="Bring to front" disabled={!hasSel} onClick={() => layer('front')} style={tool(false, !hasSel)}>⤒</button>
          <button title="Bring forward" disabled={!hasSel} onClick={() => layer('forward')} style={tool(false, !hasSel)}>↑</button>
          <button title="Send backward" disabled={!hasSel} onClick={() => layer('backward')} style={tool(false, !hasSel)}>↓</button>
          <button title="Send to back" disabled={!hasSel} onClick={() => layer('back')} style={tool(false, !hasSel)}>⤓</button>
          {sep}
          <span style={{ ...text('caption'), color: colour.inkFaint }}>{sel.count > 1 ? 'Align' : 'Align to label'}</span>
          {[['left', '⇤', 'Align left'], ['hcenter', '↔', 'Centre across'], ['right', '⇥', 'Align right'], ['top', '⤒', 'Align top'], ['vcenter', '↕', 'Centre down'], ['bottom', '⤓', 'Align bottom']].map(([m, g, t]) => (
            <button key={m} data-align={m} title={t} aria-label={t} disabled={!unlockedSel} onClick={() => align(m)} style={tool(false, !unlockedSel)}>{g}</button>
          ))}
          <button title="Space evenly across" aria-label="Space evenly across" disabled={sel.count < 3} onClick={() => distribute('x')} style={tool(false, sel.count < 3)}>⇹</button>
          <button title="Space evenly down" aria-label="Space evenly down" disabled={sel.count < 3} onClick={() => distribute('y')} style={tool(false, sel.count < 3)}>⇳</button>
        </div>
        {(message || conflict) && (
          <div role="status" style={{ padding: `${space.sm}px ${space.md}px`, ...text('caption'),
            background: conflict || message?.tone === 'danger' ? colour.dangerSoft : message?.tone === 'warning' ? colour.warningSoft : colour.accentSoft,
            color: conflict || message?.tone === 'danger' ? colour.danger : message?.tone === 'warning' ? colour.warning : colour.accentDeep }}>
            {conflict ? (
              <span data-save-conflict>{conflict.text}. <button onClick={loadTheirs} style={tool()}>Load their version</button> <button onClick={() => save({ force: true })} style={tool()}>Keep mine and save over it</button></span>
            ) : message.text}
            {!conflict && <button aria-label="Dismiss" onClick={() => setMessage(null)} style={{ ...btn, background: 'transparent', border: 'none', color: 'inherit' }}>✕</button>}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: wide ? 'row' : 'column', overflow: wide ? 'hidden' : 'auto' }}>
          <div ref={wrapRef} data-editor-stage style={{ flex: wide ? 1 : 'none', minWidth: 0, overflow: 'auto', background: '#e9eef2' }}>
            {loadError && <div role="alert" style={{ padding: space.xl, color: colour.danger, ...text('body') }}>{loadError}</div>}
            {!ready && !loadError && <div style={{ padding: space.xl, color: colour.inkFaint, ...text('body') }}>Opening the editor…</div>}
            {cropping && (
              <div data-crop-bar style={{ display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap', padding: `${space.sm}px ${space.lg}px`, background: colour.accentSoft, ...text('caption'), color: colour.accentDeep }}>
                <span style={{ flex: '1 1 240px' }}>Cropping: drag the frame and its corners over the part of the logo to keep.</span>
                <button data-crop-done onClick={() => endCrop(true)} style={{ ...btn, ...face.primary }}>Done cropping</button>
                <button data-crop-cancel onClick={() => endCrop(false)} style={tool()}>Cancel</button>
              </div>
            )}
            {/* Fabric wraps the canvas in its own elements, so React keeps it alone in a box. */}
            <div data-editor-canvas><canvas ref={canvasEl} /></div>
          </div>
          <div style={{ width: wide ? 330 : 'auto', flexShrink: 0, overflowY: wide ? 'auto' : 'visible', background: colour.surface, borderLeft: wide ? border.hairline : 'none' }}>
            {inspector}
          </div>
        </div>
        {panel && (
          <LogoLibrary logos={logos} mode={panel} onClose={() => setPanel(null)}
            onPick={logo => { setPanel(null); if (panel === 'replace') swapLogo(logo); else addLogo(logo) }}
            onUpload={async file => {
              const data = await readLogoFile(file)
              const { logo } = await uploadLogo(token, file.name, data)
              logosRef.current = { ...logosRef.current, [logo.k]: logo }
              onLogosChange?.(logosRef.current)
              setPanel(null)
              if (panel === 'replace') swapLogo(logo); else addLogo(logo)
            }} />
        )}
        {confirmLeave && (
          <div data-confirm-leave role="alertdialog" aria-label="Unsaved changes" style={{ position: 'fixed', inset: 0, zIndex: 3500, background: 'rgba(15,30,43,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
            <div style={{ background: colour.surface, borderRadius: radius.sheet, padding: space.xl, maxWidth: 420 }}>
              <div style={{ ...text('title'), color: colour.ink, marginBottom: space.sm }}>Unsaved changes</div>
              <div style={{ ...text('body'), color: colour.inkMuted, marginBottom: space.lg }}>“{name}” has changes that are not saved. Leave without saving them?</div>
              <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
                <button data-leave-save onClick={async () => { const ok = await save(); if (ok) { setConfirmLeave(false); onClose() } }} style={{ ...btn, ...face.primary }}>Save and close</button>
                <button data-leave-discard onClick={() => { setConfirmLeave(false); onClose() }} style={{ ...btn, ...face.secondary, color: colour.danger }}>Discard changes</button>
                <button data-leave-stay onClick={() => setConfirmLeave(false)} style={{ ...btn, ...face.secondary }}>Keep editing</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Overlay>
  )
}
