import React, { useEffect, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'

// ─── Fill the kit room from the consignment agreements (Brent, 21 Nov 2026) ──
// One tap works through every agreement, one at a time (a request each — the
// photos take a while): trays, codes, quantities and photos into each set that
// has nothing filled in, missing trays added to the rest, and the agreement
// attached. Each agreement runs once; filled trays are never replaced.

const PLACE = { CLV: 'Calvary', RHH: 'RHH', office: 'Office' }

function summary(rec) {
  if (!rec?.results) return ''
  return rec.results.map(r => {
    const bits = []
    if (r.added) bits.push(`${r.added} tray${r.added === 1 ? '' : 's'} added`)
    if (r.photos) bits.push(`${r.photos} photo${r.photos === 1 ? '' : 's'}`)
    if (r.photosMissed) bits.push(`${r.photosMissed} photo${r.photosMissed === 1 ? '' : 's'} missed`)
    if (r.skipped) bits.push(`${r.skipped} already there`)
    if (r.attached) bits.push('agreement attached')
    if (r.attachError) bits.push('agreement not attached')
    return `${r.kitName}: ${bits.join(', ') || 'nothing to add'}`
  }).join(' · ')
}

export default function FillAgreements({ post, onClose, onDone }) {
  useBackLayer(true, onClose)
  const [list, setList] = useState(null)
  const [running, setRunning] = useState('')
  const [error, setError] = useState('')
  const [photoNote, setPhotoNote] = useState('')

  useEffect(() => { post('agreements', {}).then(d => setList(d.agreements)).catch(e => setError(e.message)) }, [])

  async function fillAll() {
    setError('')
    for (const a of list.filter(x => !x.done)) {
      setRunning(a.doc)
      try {
        const rec = await post('agreements', { doc: a.doc })
        setList(l => l.map(x => (x.doc === a.doc ? { ...x, done: rec } : x)))
      } catch (err) {
        setError(`${a.kit} (${PLACE[a.hospital] || a.hospital}): ${err.message}`)
        break
      }
    }
    setRunning('')
    onDone?.()
  }

  // Photos a fill missed (Brent, 21 Nov 2026: "I can't see any of the new tray
  // image additions") — every agreement, a few uploads a request until done.
  async function addPhotos() {
    setError('')
    setPhotoNote('')
    let added = 0
    let missed = 0
    for (const a of list) {
      setRunning(`photos:${a.doc}`)
      try {
        for (let round = 0; round < 12; round += 1) {
          const r = await post('agreements', { doc: a.doc, photos: true })
          added += r.added || 0
          if (!r.more) { missed += r.missed || 0; break }
        }
      } catch (err) {
        setError(`${a.kit} (${PLACE[a.hospital] || a.hospital}) photos: ${err.message}`)
        break
      }
    }
    setRunning('')
    setPhotoNote(added || missed
      ? `${added} photo${added === 1 ? '' : 's'} added${missed ? ` · ${missed} could not be filed — tap again to retry` : ''}`
      : 'Every tray from the agreements already has its photo.')
    onDone?.()
  }

  const left = (list || []).filter(x => !x.done).length
  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label="Fill from consignment agreements" className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 560, maxHeight: '90%', borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column', overflowX: 'hidden'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1, ...text('heading'), color: colour.ink }}>Fill from consignment agreements</div>
            <button onClick={onClose} disabled={Boolean(running)} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden' }}>
            <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
              Each set gets the trays, codes, quantities and tray photos from its agreement, and the agreement itself. Trays someone has
              already filled in are left alone. No prices come across.
            </div>
            {!list && !error && <div style={{ ...text('body'), color: colour.inkFaint }}>Loading…</div>}
            {list && (
              <button data-fill-all disabled={Boolean(running) || !left} onClick={fillAll}
                style={{ ...face.primary, ...text('bodyStrong'), width: '100%', padding: space.sm, borderRadius: radius.control, border: 'none', marginBottom: space.md, cursor: 'pointer', opacity: running || !left ? 0.6 : 1 }}>
                {running && !running.startsWith('photos:') ? 'Filling…' : left ? `Fill ${left} agreement${left === 1 ? '' : 's'}` : 'All done'}
              </button>
            )}
            {list && (
              <button data-add-photos disabled={Boolean(running)} onClick={addPhotos}
                style={{ ...face.secondary, ...text('bodyStrong'), width: '100%', padding: space.sm, borderRadius: radius.control, marginBottom: space.md, cursor: 'pointer', opacity: running ? 0.6 : 1 }}>
                {running.startsWith('photos:') ? 'Adding photos…' : 'Add missing photos'}
              </button>
            )}
            {photoNote && <div data-photo-note style={{ ...text('caption'), color: colour.accentDeep, marginBottom: space.sm }}>{photoNote}</div>}
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
            {(list || []).map(a => (
              <div key={a.doc} data-agreement={a.doc} style={{ padding: `${space.sm}px 0`, borderBottom: border.hairlineSoft }}>
                <div style={{ display: 'flex', gap: space.sm, alignItems: 'baseline' }}>
                  <div style={{ flex: 1, ...text('bodyStrong'), color: colour.ink }}>{a.kit} · {PLACE[a.hospital] || a.hospital}</div>
                  <div style={{ ...text('caption'), color: a.done ? colour.accentDeep : colour.inkFaint, fontWeight: 600 }}>
                    {a.done ? '✓ Done' : running === a.doc ? 'Filling…' : `${a.trays} tray${a.trays === 1 ? '' : 's'}`}
                  </div>
                </div>
                <div style={{ ...text('caption'), color: colour.inkFaint, overflowWrap: 'anywhere' }}>{a.done ? summary(a.done) : a.file}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
