// ─── Label Studio: every implant label in one place (Brent, 25 Nov 2026) ──
// Admin → Labels. The library (search by name, REF, rebate code or brand;
// sort by name or most recently changed; the "to check" badge), the editor,
// and printing — one label or a queue of several in one PDF.

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { colour, text, space, radius, face, border } from '../design/tokens.js'
import LabelSvg from './LabelSvg.jsx'
import PrintSheet from './PrintSheet.jsx'
import { summarise, matchesSearch, blankLabel, duplicateLabel, toHex } from './model.js'
import { listLabels, createLabel, deleteLabel } from './api.js'
import { loadLabelFonts } from './fonts.js'

const LabelEditor = lazy(() => import('./LabelEditor.jsx'))

const btn = { ...text('caption'), fontWeight: 600, padding: '7px 12px', borderRadius: radius.control, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap' }
const fieldStyle = { ...text('field'), padding: '9px 12px', border: border.hairline, borderRadius: radius.control, boxSizing: 'border-box', background: colour.surface, color: colour.ink }
const when = iso => { try { return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return '' } }

/** Colours already used across the labels, most used first: the editor's swatches. */
function usedColours(labels) {
  const n = new Map()
  const add = c => { const h = toHex(c); if (h) n.set(h, (n.get(h) || 0) + 1) }
  for (const l of labels) for (const i of l.items || []) {
    if (i.t === 'txt') i.runs.forEach(r => add(r.color))
    else if (i.fill) add(i.fill)
    if (i.stroke?.color) add(i.stroke.color)
  }
  const out = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h)
  for (const base of ['#000000', '#ffffff', '#189a85', '#042746']) if (!out.includes(base)) out.push(base)
  return out.slice(0, 18)
}

function LabelCard({ label, logos, queued, onOpen, onPrint, onQueue, onDuplicate, onDelete }) {
  const s = summarise(label, logos)
  const [asking, setAsking] = useState(false)
  return (
    <div data-label-card={label.id} style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <button onClick={onOpen} aria-label={`Edit ${label.name}`} style={{ border: 'none', padding: space.md, background: colour.canvas, cursor: 'pointer' }}>
        <div style={{ boxShadow: '0 1px 3px rgba(4,39,70,0.18)', borderRadius: 3, overflow: 'hidden' }}><LabelSvg label={label} logos={logos} /></div>
      </button>
      <div style={{ padding: `${space.sm}px ${space.md}px ${space.md}px`, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <div style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0 }}>{label.name}</div>
          {label.check && <span data-to-check title={label.check} style={{ ...text('micro'), textTransform: 'uppercase', color: colour.warning, background: colour.warningSoft, border: `1px solid ${colour.warningLine}`, borderRadius: radius.pill, padding: '2px 8px', flexShrink: 0 }}>To check</span>}
        </div>
        <div style={{ ...text('caption'), color: colour.inkMuted }}>
          {s.brand && <span>{s.brand}</span>}
          {s.ref && <span>{s.brand ? ' · ' : ''}REF {s.ref}</span>}
          {s.rebate && <span> · Rebate {s.rebate}</span>}
        </div>
        {label.check && <div style={{ ...text('caption'), color: colour.warning }}>{label.check}</div>}
        <div style={{ ...text('caption'), color: colour.inkFainter }}>{label.updatedBy ? `${label.updatedBy}, ${when(label.updatedAt)}` : ''}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto', paddingTop: space.sm }}>
          <button onClick={onOpen} style={{ ...btn, ...face.secondary }}>Edit</button>
          <button data-print-one onClick={onPrint} style={{ ...btn, ...face.secondary }}>Print</button>
          <button data-queue aria-pressed={queued} onClick={onQueue} style={{ ...btn, ...(queued ? face.navy : face.secondary) }}>{queued ? '✓ In queue' : '+ Queue'}</button>
          <button data-duplicate onClick={onDuplicate} style={{ ...btn, ...face.secondary }}>Duplicate</button>
          {!asking && <button data-delete onClick={() => setAsking(true)} style={{ ...btn, ...face.secondary, color: colour.danger }}>Delete</button>}
          {asking && (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span style={{ ...text('caption'), color: colour.danger }}>Delete it?</span>
              <button data-delete-yes onClick={() => { setAsking(false); onDelete() }} style={{ ...btn, background: colour.danger, color: '#ffffff', border: 'none' }}>Yes, delete</button>
              <button onClick={() => setAsking(false)} style={{ ...btn, ...face.secondary }}>No</button>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LabelStudio({ user }) {
  const token = user?.token
  const [labels, setLabels] = useState(null)
  const [logos, setLogos] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(() => { try { return localStorage.getItem('tm_labels_sort') || 'name' } catch { return 'name' } })
  const [editing, setEditing] = useState(null)
  const [printJobs, setPrintJobs] = useState(null)
  const [printFromQueue, setPrintFromQueue] = useState(false)
  const [queue, setQueue] = useState([])
  const [, setFontsIn] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await listLabels(token)
      setLabels(data.labels)
      setLogos(data.logos || {})
      setError('')
      if (data.seeding) setTimeout(load, 3000)
    } catch (err) {
      setError(err.status === 404 ? 'Label Studio is for admins only.' : `The labels could not be loaded — ${err.message}`)
    }
  }, [token])
  useEffect(() => { load() }, [load])
  // Thumbnails redraw in the label fonts once they have arrived.
  useEffect(() => { loadLabelFonts().then(() => setFontsIn(true)) }, [])
  useEffect(() => { try { localStorage.setItem('tm_labels_sort', sort) } catch { /* private window */ } }, [sort])

  const swatches = useMemo(() => usedColours(labels || []), [labels])
  const shown = useMemo(() => {
    const list = (labels || []).filter(l => matchesSearch(l, logos, query))
    if (sort === 'recent') list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    else list.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    return list
  }, [labels, logos, query, sort])

  const upsert = saved => setLabels(list => {
    const rest = (list || []).filter(l => l.id !== saved.id)
    return [...rest, saved]
  })
  const toCheck = (labels || []).filter(l => l.check).length

  async function duplicate(label) {
    try {
      const { label: made } = await createLabel(token, duplicateLabel(label))
      upsert(made)
      setNotice(`Made “${made.name}”.`)
      setEditing(made)
    } catch (err) { setError(`Could not duplicate — ${err.message}`) }
  }
  async function remove(label) {
    try {
      await deleteLabel(token, label.id)
      setLabels(list => list.filter(l => l.id !== label.id))
      setQueue(q => q.filter(j => j.label.id !== label.id))
      setNotice(`Deleted “${label.name}”.`)
    } catch (err) { setError(`Could not delete — ${err.message}`) }
  }
  const toggleQueue = label => setQueue(q => (q.some(j => j.label.id === label.id) ? q.filter(j => j.label.id !== label.id) : [...q, { label, qty: 1 }]))

  return (
    <div data-label-studio>
      <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', alignItems: 'center', marginBottom: space.md }}>
        <input aria-label="Search labels" data-label-search placeholder="Search name, REF, rebate code or brand" value={query} onChange={e => setQuery(e.target.value)}
          style={{ ...fieldStyle, flex: '1 1 240px', minWidth: 0 }} />
        <select aria-label="Sort" value={sort} onChange={e => setSort(e.target.value)} style={{ ...fieldStyle, flex: '0 0 auto' }}>
          <option value="name">By name</option>
          <option value="recent">Recently changed</option>
        </select>
        <button data-new-label onClick={() => setEditing(blankLabel())} style={{ ...btn, ...face.primary, padding: '10px 14px' }}>+ New label</button>
        <button data-print-queue disabled={!queue.length} onClick={() => { setPrintFromQueue(true); setPrintJobs(queue) }} style={{ ...btn, ...(queue.length ? face.navy : face.secondary), padding: '10px 14px', opacity: queue.length ? 1 : 0.5 }}>Print queue ({queue.length})</button>
      </div>
      {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, background: colour.dangerSoft, border: `1px solid ${colour.dangerLine}`, borderRadius: radius.control, padding: space.md, marginBottom: space.md }}>{error}</div>}
      {notice && <div role="status" style={{ ...text('caption'), color: colour.accentDeep, background: colour.accentSoft, borderRadius: radius.control, padding: space.md, marginBottom: space.md }}>{notice}</div>}
      {labels == null && !error && <div style={{ ...text('body'), color: colour.inkFaint, padding: space.xl, textAlign: 'center' }}>Loading the labels… (the first time, the Vistaprint labels are brought in)</div>}
      {labels && (
        <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
          {shown.length === labels.length ? `${labels.length} labels` : `${shown.length} of ${labels.length} labels`}
          {toCheck ? ` · ${toCheck} to check` : ''} · printed 68 × 21 mm
        </div>
      )}
      <div data-label-grid style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: space.md }}>
        {shown.map(l => (
          <LabelCard key={l.id} label={l} logos={logos} queued={queue.some(j => j.label.id === l.id)}
            onOpen={() => setEditing(l)} onPrint={() => { setPrintFromQueue(false); setPrintJobs([{ label: l, qty: 1 }]) }} onQueue={() => toggleQueue(l)}
            onDuplicate={() => duplicate(l)} onDelete={() => remove(l)} />
        ))}
      </div>
      {labels && !shown.length && <div style={{ ...text('body'), color: colour.inkFaint, padding: space.xl, textAlign: 'center' }}>No label matches “{query}”.</div>}

      {editing && (
        <Suspense fallback={null}>
          <LabelEditor user={user} label={editing} logos={logos} onLogosChange={setLogos} swatches={swatches}
            onClose={() => setEditing(null)}
            onSaved={saved => { upsert(saved); setQueue(q => q.map(j => (j.label.id === saved.id ? { ...j, label: saved } : j))) }}
            onPrint={current => { setPrintFromQueue(false); setPrintJobs([{ label: current, qty: 1 }]) }} />
        </Suspense>
      )}
      {printJobs && (
        <PrintSheet jobs={printJobs} logos={logos}
          onChange={jobs => { setPrintJobs(jobs); if (printFromQueue) setQueue(jobs) }}
          onClose={() => setPrintJobs(null)} />
      )}
    </div>
  )
}
