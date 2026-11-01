import React, { useState, useEffect } from 'react'
import { upload } from '@vercel/blob/client'
import { colour, text, space, radius, border } from '../../design/tokens.js'

// ─── What is in each tray ────────────────────────────────────────────────────
// A kit's tray list: uploaded from the hospital's own copy (a PDF, a Word
// document, a spreadsheet or a photo), read by the portal, checked by a
// person, then saved. Nothing read from a file is saved without someone
// looking at it first — a wrong quantity here is a stock-take that never adds
// up.
//
// Implants are counted, instruments are ticked (Brent, 2 Nov 2026), so each
// line carries which it is and the reviewer can see the split.

const PLACES = { office: 'TM office', CLV: 'Calvary', RHH: 'RHH' }
const ACCEPT = '.pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp,application/pdf,image/*'

function TrayBlock({ tray, open, onToggle, onRemove, onRemoveLine }) {
  const implants = tray.lines.filter(l => l.kind === 'implant').length
  return (
    <div style={{ background: colour.surface, border: border.hairline, borderRadius: radius.control, marginBottom: space.sm }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px` }}>
        <button onClick={onToggle} aria-expanded={open} style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer' }}>
          <div style={{ ...text('bodyStrong'), color: colour.ink }}>{tray.name}</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            {tray.lines.length} lines · {implants} implant{implants === 1 ? '' : 's'} counted · {tray.lines.length - implants} instruments ticked
          </div>
        </button>
        {onRemove && (
          <button onClick={onRemove} aria-label={`Leave out ${tray.name}`}
            style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer' }}>Leave out</button>
        )}
      </div>
      {open && (
        <div style={{ borderTop: border.hairlineSoft, padding: `0 ${space.md}px ${space.sm}px` }}>
          {tray.lines.map((l, i) => (
            <div key={`${l.code}-${i}`} style={{ display: 'flex', gap: space.sm, alignItems: 'baseline', padding: `${space.xs}px 0`, borderBottom: border.hairlineSoft }}>
              <span style={{ ...text('caption'), color: colour.inkFaint, width: 92, flexShrink: 0, overflowWrap: 'anywhere' }}>{l.code || '—'}</span>
              <span style={{ ...text('caption'), color: colour.ink, flex: 1 }}>{l.description}</span>
              <span style={{ ...text('caption'), color: l.kind === 'implant' ? colour.accentDeep : colour.inkFaint, whiteSpace: 'nowrap' }}>
                {l.kind === 'implant' ? `× ${l.qty}` : `${l.qty > 1 ? `${l.qty} ` : ''}inst.`}
              </span>
              {onRemoveLine && (
                <button onClick={() => onRemoveLine(i)} aria-label={`Remove ${l.description}`}
                  style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>×</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TrayList({ kit, canEdit, user, post, onSaved }) {
  const [list, setList] = useState(undefined)
  const [open, setOpen] = useState('')
  const [stage, setStage] = useState('')
  const [review, setReview] = useState(null)
  const [hospital, setHospital] = useState(kit.home)
  const [error, setError] = useState('')
  const headers = { Authorization: `Bearer ${user?.token || ''}` }

  useEffect(() => {
    let live = true
    fetch(`/api/guides?kits=traylist&id=${encodeURIComponent(kit.id)}`, { headers })
      .then(r => r.json()).then(d => live && setList(d.list || null)).catch(() => live && setList(null))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit.id])

  async function read(file) {
    if (!file) return
    setError(''); setStage('uploading')
    try {
      const safeName = file.name.replace(/[^\w.\- ]+/g, '_')
      const uploaded = await upload(`traylists/${Date.now()}-${safeName}`, file, {
        access: 'public',
        handleUploadUrl: '/api/meetings/agent?action=blob-upload',
        clientPayload: JSON.stringify({ token: user?.token || null })
      })
      setStage('reading')
      const res = await fetch('/api/meetings/agent?action=tray-read', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: uploaded.url, filename: file.name, mediaType: file.type, hospital, kitName: kit.name })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'The tray list could not be read')
      setReview({ ...data, file: file.name })
      setOpen('')
    } catch (err) {
      setError(err.message)
    }
    setStage('')
  }

  async function save() {
    setStage('saving'); setError('')
    try {
      const { list: saved } = await post('savelist', {
        kitId: kit.id, trays: review.trays,
        source: { file: review.file, hospital, dropboxPath: review.dropboxPath }
      })
      setList(saved); setReview(null)
      await onSaved?.()
    } catch (err) { setError(err.message) }
    setStage('')
  }

  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.lg}px 0 ${space.sm}px` }

  if (review) {
    const lines = review.trays.reduce((n, t) => n + t.lines.length, 0)
    return (
      <div>
        <div style={label}>Check the tray list before saving</div>
        <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
          Read from {review.file}: {review.trays.length} trays, {lines} lines. Open each tray and check the codes and quantities
          against the paper. Leave out anything that is not part of this kit.
          {review.dropboxPath ? ' The original is saved in Dropbox under Tray Lists → Hospital Copies.' : ''}
          {review.dropboxError ? ` (Not saved to Dropbox: ${review.dropboxError})` : ''}
        </div>
        {review.trays.map((t, ti) => (
          <TrayBlock key={t.name} tray={t} open={open === t.name} onToggle={() => setOpen(open === t.name ? '' : t.name)}
            onRemove={() => setReview(r => ({ ...r, trays: r.trays.filter((_, j) => j !== ti) }))}
            onRemoveLine={li => setReview(r => ({ ...r, trays: r.trays.map((x, j) => (j === ti ? { ...x, lines: x.lines.filter((_, k) => k !== li) } : x)) }))} />
        ))}
        {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
        <div style={{ display: 'flex', gap: space.sm }}>
          <button disabled={stage === 'saving' || !review.trays.length} onClick={save} style={{
            flex: 2, ...text('bodyStrong'), padding: space.md, borderRadius: radius.control, border: 'none',
            background: colour.accent, color: 'white', cursor: 'pointer', opacity: stage === 'saving' ? 0.6 : 1
          }}>{stage === 'saving' ? 'Saving…' : `Save to ${kit.name}`}</button>
          <button onClick={() => setReview(null)} style={{
            flex: 1, ...text('bodyStrong'), padding: space.md, borderRadius: radius.control, border: border.hairline,
            background: colour.surface, color: colour.ink, cursor: 'pointer'
          }}>Cancel</button>
        </div>
        {list && (
          <div style={{ ...text('caption'), color: colour.warning, marginTop: space.sm }}>
            Saving replaces the tray list this kit has now.
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={label}>What is in each tray</div>
      {list === undefined && <div style={{ ...text('caption'), color: colour.inkFaint }}>Loading…</div>}
      {list === null && (
        <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
          No tray list yet{canEdit ? ' — upload the hospital’s copy below.' : '.'}
        </div>
      )}
      {list && (
        <>
          <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
            From {list.source?.file || 'an upload'}{list.source?.hospital ? ` (${PLACES[list.source.hospital]}'s copy)` : ''}
            {list.source?.by ? `, saved by ${list.source.by}` : ''}
            {list.source?.at ? ` on ${new Date(list.source.at).toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.
          </div>
          {list.trays.map(t => (
            <TrayBlock key={t.name} tray={t} open={open === t.name} onToggle={() => setOpen(open === t.name ? '' : t.name)} />
          ))}
        </>
      )}

      {canEdit && (
        <div style={{ marginTop: space.sm }}>
          <div style={{ display: 'flex', gap: space.sm, alignItems: 'center', marginBottom: space.sm }}>
            <span style={{ ...text('caption'), color: colour.inkFaint }}>Whose copy:</span>
            <select value={hospital} onChange={e => setHospital(e.target.value)} aria-label="Whose copy of the tray list"
              style={{ ...text('field'), padding: '6px 8px', borderRadius: radius.control, border: border.hairline, background: colour.surface, color: colour.ink }}>
              <option value="CLV">Calvary</option>
              <option value="RHH">RHH</option>
              <option value="office">TechnoMed master</option>
            </select>
          </div>
          <label style={{
            display: 'block', textAlign: 'center', ...text('bodyStrong'), padding: space.md, borderRadius: radius.control,
            border: `1px dashed ${colour.accent}`, color: colour.accentDeep, background: colour.surface,
            cursor: stage ? 'default' : 'pointer', opacity: stage ? 0.6 : 1
          }}>
            {stage === 'uploading' ? 'Uploading…' : stage === 'reading' ? 'Reading the tray list — this can take a minute…'
              : list ? 'Upload a new tray list' : 'Upload tray list (PDF, Word, Excel or photo)'}
            <input type="file" accept={ACCEPT} disabled={Boolean(stage)} style={{ display: 'none', fontSize: 16 }}
              onChange={e => { read(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
