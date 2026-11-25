// ─── Import labels from the Avery export (Brent, 25 Nov 2026) ─────────────
// Choose the TechnoMed_Label_Templates ZIP; every label in it is shown as it
// will look in Label Studio, ticked — except any already brought in. Nothing
// is saved until "Import N labels": then each picture is uploaded once as a
// logo (a vector PDF drawn at 300 dpi first) and each label made.

import React, { useMemo, useRef, useState } from 'react'
import { useBackLayer } from '../backButton.js'
import { colour, text, space, radius, face, border } from '../design/tokens.js'
import LabelSvg from './LabelSvg.jsx'
import { sizeText, MM_PER_PT } from './model.js'
import { templateToLabel, rekey, importedIds } from './averyImport.js'
import { readExport, pictureSize, shrinkPicture, drawPdf, blobDataUrl } from './averyZip.js'
import { measureRun } from './measure.js'
import { loadLabelFonts } from './fonts.js'
import { createLabel, uploadLogo } from './api.js'

const btn = { ...text('caption'), fontWeight: 600, padding: '9px 14px', borderRadius: radius.control, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap' }
/** Width in mm, by the browser's measure of the label fonts (a rough guess with no canvas). */
const measure = (t, run) => measureRun(t, run) ?? [...t].length * (Number(run.size) || 8) * MM_PER_PT * 0.5

export default function ImportSheet({ user, labels, onImported, onClose }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [rows, setRows] = useState(null)
  const [skip, setSkip] = useState(() => new Set())
  const [done, setDone] = useState(null)
  const exportRef = useRef(null)
  const previewLogos = useRef({})
  const [, redraw] = useState(0)
  useBackLayer(true, () => { if (!busy) close() })
  const already = useMemo(() => importedIds(labels), [labels])

  function close() {
    for (const l of Object.values(previewLogos.current)) URL.revokeObjectURL(l.url)
    onClose()
  }

  async function choose(file) {
    if (!file) return
    setError(''); setRows(null); setDone(null); setBusy('Reading the file…')
    try {
      await loadLabelFonts()
      const ex = await readExport(file)
      exportRef.current = ex
      const logos = {}
      const out = []
      for (const { folder, tpl } of ex.templates) {
        // Picture sizes first (for 'contain' and the previews): a PDF shows its PNG stand-in here.
        const sizes = {}
        for (const e of tpl.elements || []) {
          if (!e.src) continue
          const name = e.src.replace(/^assets\//, '')
          const shown = (e.previewSrc || e.src).replace(/^assets\//, '')
          if (logos[name]) { sizes[name] = logos[name]; continue }
          const blob = await ex.file(folder, shown)
          if (!blob) continue
          const px = await pictureSize(blob).catch(() => null)
          if (!px) continue
          logos[name] = { k: name, name, url: URL.createObjectURL(blob), w: px.w, h: px.h }
          sizes[name] = px
        }
        const { label, assets } = templateToLabel(tpl, measure, sizes)
        out.push({ id: `${folder}`, folder, label, assets, already: already.has(label.sourceId) })
      }
      out.sort((a, b) => a.label.name.localeCompare(b.label.name, 'en', { numeric: true }))
      previewLogos.current = logos
      setSkip(new Set(out.filter(r => r.already).map(r => r.id)))
      setRows(out)
      redraw(n => n + 1)
    } catch (err) {
      setError(err.message || 'That file could not be read')
    } finally { setBusy('') }
  }

  const chosen = (rows || []).filter(r => !skip.has(r.id))
  const toggle = id => setSkip(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function importAll() {
    const ex = exportRef.current
    if (!ex || !chosen.length) return
    setError('')
    const keyOf = {}
    const newLogos = {}
    const made = []
    const failed = []
    // Each picture once, at the largest size any chosen label uses it.
    const widest = {}
    const where = {}
    for (const r of chosen) {
      for (const a of r.assets) where[a.name] ||= { folder: r.folder, ...a }
      for (const i of r.label.items) if (i.t === 'img') widest[i.k] = Math.max(widest[i.k] || 0, i.w)
    }
    const names = Object.keys(where)
    try {
      for (let n = 0; n < names.length; n++) {
        const a = where[names[n]]
        setBusy(`Uploading pictures… ${n + 1} of ${names.length}`)
        let blob = await ex.file(a.folder, a.name)
        if (blob && /\.pdf$/i.test(a.name)) {
          try { blob = await drawPdf(blob, widest[a.name]) } catch { blob = a.preview ? await ex.file(a.folder, a.preview) : null }
        }
        if (!blob) { failed.push(`Picture ${a.name} missing`); continue }
        blob = await shrinkPicture(blob)
        const label = (chosen.find(r => r.assets.some(x => x.name === a.name))?.label.name || 'Avery').slice(0, 40)
        const { logo } = await uploadLogo(user.token, `Avery · ${label}`, await blobDataUrl(blob))
        keyOf[a.name] = logo.k
        newLogos[logo.k] = logo
      }
      for (let n = 0; n < chosen.length; n++) {
        const r = chosen[n]
        setBusy(`Making labels… ${n + 1} of ${chosen.length}`)
        if (r.label.items.some(i => i.t === 'img' && !keyOf[i.k])) { failed.push(`${r.label.name}: a picture did not upload`); continue }
        try {
          const { label } = await createLabel(user.token, rekey(r.label, keyOf))
          made.push(label)
        } catch (err) { failed.push(`${r.label.name}: ${err.message}`) }
      }
    } catch (err) {
      failed.push(err.message)
    }
    setBusy('')
    setDone({ made: made.length, failed })
    onImported(made, newLogos)
  }

  return (
    <div data-import-sheet role="dialog" aria-label="Import labels"
      style={{ position: 'fixed', inset: 0, zIndex: 3300, background: colour.canvas, overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: colour.surface, borderBottom: border.hairline, padding: `${space.md}px ${space.lg}px`, display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ ...text('title'), color: colour.ink }}>Import labels</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            From the Avery export (TechnoMed_Label_Templates ZIP). Each label keeps its own size and Avery sheet layout, and prints on a label printer or on A4.
          </div>
        </div>
        {rows && !done && (
          <button data-import-go disabled={Boolean(busy) || !chosen.length} onClick={importAll} style={{ ...btn, ...face.primary, opacity: busy || !chosen.length ? 0.6 : 1 }}>
            {busy || `Import ${chosen.length} label${chosen.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button onClick={close} disabled={Boolean(busy) && Boolean(rows)} style={{ ...btn, ...face.secondary }}>{done ? 'Done' : 'Cancel'}</button>
      </div>
      <div style={{ padding: space.lg, maxWidth: 1100, margin: '0 auto' }}>
        {!rows && (
          <label style={{ display: 'block', background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.xl, textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ ...text('bodyStrong'), color: colour.ink, marginBottom: space.sm }}>{busy || 'Choose the export ZIP'}</div>
            <div style={{ ...text('caption'), color: colour.inkFaint }}>Nothing is saved until you have seen every label and tapped Import.</div>
            <input data-import-file type="file" accept=".zip,application/zip" disabled={Boolean(busy)} onChange={e => choose(e.target.files?.[0])} style={{ ...text('field'), marginTop: space.md }} />
          </label>
        )}
        {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, background: colour.dangerSoft, border: `1px solid ${colour.dangerLine}`, borderRadius: radius.control, padding: space.md, margin: `${space.md}px 0` }}>{error}</div>}
        {done && (
          <div role="status" data-import-done style={{ ...text('body'), color: done.failed.length ? colour.warning : colour.accentDeep, background: done.failed.length ? colour.warningSoft : colour.accentSoft, borderRadius: radius.control, padding: space.md, marginBottom: space.md }}>
            {done.made} label{done.made === 1 ? '' : 's'} imported.
            {done.failed.length > 0 && <><br />Not imported: {done.failed.join(' · ')}</>}
          </div>
        )}
        {rows && !done && (
          <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.md }}>
            {rows.length} label{rows.length === 1 ? '' : 's'} in the file{rows.some(r => r.already) ? ` — ${rows.filter(r => r.already).length} already in Label Studio, left unticked` : ''}. Untick any you don&rsquo;t want.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: space.md }}>
          {(rows || []).map(r => {
            const on = !skip.has(r.id)
            return (
              <div key={r.id} data-import-row style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md, opacity: on ? 1 : 0.55 }}>
                <label style={{ display: 'flex', gap: space.sm, alignItems: 'center', marginBottom: space.sm, cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} disabled={Boolean(busy) || Boolean(done)} onChange={() => toggle(r.id)} style={{ width: 20, height: 20, fontSize: 16 }} />
                  <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0 }}>{r.label.name}</span>
                  {r.already && <span style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint }}>Already in</span>}
                </label>
                <div style={{ boxShadow: '0 1px 3px rgba(4,39,70,0.18)', borderRadius: 3, overflow: 'hidden' }}><LabelSvg label={r.label} logos={previewLogos.current} /></div>
                <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 6 }}>{sizeText(r.label)}{r.label.sheet ? ` · ${r.label.sheet.name}` : ''}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
