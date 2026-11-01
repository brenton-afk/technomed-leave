import React, { useState, useEffect, useRef } from 'react'
import { upload } from '@vercel/blob/client'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { trayFilePayload, originalIfSmall } from './readTrayFile.js'

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


/** A saved photo, from Dropbox by a link fetched when it is shown. */
function SavedPhoto({ path, user, alt }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let live = true
    fetch(`/api/guides?kits=photo&path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${user?.token || ''}` } })
      .then(r => r.json()).then(d => live && d.url && setUrl(d.url)).catch(() => {})
    return () => { live = false }
  }, [path, user?.token])
  if (!url) return <div style={{ height: 120, background: colour.lineSoft, borderRadius: radius.control, marginBottom: space.sm }} />
  return <img src={url} alt={alt} style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: radius.control, background: colour.canvas, marginBottom: space.sm }} />
}

// "It would be better in a table with the instrument description and the qty
// next to it. Nice and neat." Code, description, quantity — one row per line,
// ruled, the quantity right-aligned so a column of numbers reads down.
function TrayBlock({ tray, open, onToggle, onRemove, onRemoveLine, photoData, user }) {
  const implants = tray.lines.filter(l => l.kind === 'implant').length
  const cell = { ...text('caption'), padding: `${space.xs + 2}px ${space.sm}px`, borderBottom: border.hairlineSoft, verticalAlign: 'top' }
  const head = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, padding: `${space.xs + 2}px ${space.sm}px`, borderBottom: border.hairline, textAlign: 'left', background: colour.canvas }
  const hasPhoto = Boolean(photoData || tray.photo)
  return (
    <div style={{ background: colour.surface, border: border.hairline, borderRadius: radius.control, marginBottom: space.sm, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px` }}>
        <button onClick={onToggle} aria-expanded={open} style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer' }}>
          <div style={{ ...text('bodyStrong'), color: colour.ink }}>{tray.name}</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            {tray.lines.length} items · {implants} implant{implants === 1 ? '' : 's'}{hasPhoto ? ' · photo' : ' · no photo'}
          </div>
        </button>
        {onRemove && (
          <button onClick={onRemove} aria-label={`Leave out ${tray.name}`}
            style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer' }}>Leave out</button>
        )}
      </div>
      {open && (
        <div style={{ borderTop: border.hairlineSoft, padding: space.sm }}>
          {photoData && <img src={`data:image/jpeg;base64,${photoData}`} alt={`${tray.name}`}
            style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: radius.control, background: colour.canvas, marginBottom: space.sm }} />}
          {!photoData && tray.photo && <SavedPhoto path={tray.photo} user={user} alt={tray.name} />}
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '30%' }} /><col /><col style={{ width: 48 }} />{onRemoveLine && <col style={{ width: 28 }} />}
            </colgroup>
            <thead>
              <tr><th style={head}>Code</th><th style={head}>Description</th><th style={{ ...head, textAlign: 'right' }}>Qty</th>{onRemoveLine && <th style={head} />}</tr>
            </thead>
            <tbody>
              {tray.lines.map((l, i) => (
                <tr key={`${l.code}-${i}`} style={{ background: i % 2 ? colour.canvas : colour.surface }}>
                  <td style={{ ...cell, color: colour.inkMuted, overflowWrap: 'anywhere' }}>{l.code || '—'}</td>
                  <td style={{ ...cell, color: colour.ink }}>
                    {l.description}
                    {l.kind === 'implant' && <span style={{ ...text('micro'), color: colour.accentDeep, marginLeft: 6, textTransform: 'uppercase' }}>implant</span>}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 600, color: colour.ink }}>{l.qty}</td>
                  {onRemoveLine && (
                    <td style={{ ...cell, textAlign: 'center' }}>
                      <button onClick={() => onRemoveLine(i)} aria-label={`Remove ${l.description}`}
                        style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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

  // Types named from the extension: a phone often reports a Word document
  // with no type at all, which the upload would refuse.
  const TYPES = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  const attempt = useRef(0)

  async function call(action, body, ms) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)
    try {
      const res = await fetch(`/api/meetings/agent?action=${action}`, {
        method: 'POST', signal: ctrl.signal,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, hospital, kitName: kit.name })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'The tray list could not be read')
      return data
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('That took too long — check the connection and try again.')
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  // The original, into Dropbox, without anybody waiting on it. Sent whole when
  // it is small; a big one goes through the upload service, and if that does
  // not come back the list is still read and saved — only the copy is missed.
  function keepOriginal(file, mine) {
    const done = kept => setReview(r => (r && r.attempt === mine ? { ...r, ...kept, keeping: false } : r))
    ;(async () => {
      const data = await originalIfSmall(file)
      if (data) return call('tray-keep', { data, filename: file.name }, 60000)
      const ext = file.name.toLowerCase().split('.').pop()
      const up = await Promise.race([
        upload(`traylists/${Date.now()}-${file.name.replace(/[^\w.\- ]+/g, '_')}`, file, {
          access: 'public', contentType: TYPES[ext] || file.type,
          handleUploadUrl: '/api/meetings/agent?action=blob-upload',
          clientPayload: JSON.stringify({ token: user?.token || null })
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 120000))
      ])
      return call('tray-keep', { url: up.url, filename: file.name }, 60000)
    })().then(done, () => done({ dropboxPath: '', dropboxError: 'The original could not be saved to Dropbox — add it there by hand' }))
  }

  // "Uploading tray lists to the portal is super slow… Still uploading."
  // The phone now unpacks the file and only what needs reading is sent, in an
  // ordinary request — see readTrayFile.js. Nothing waits on the upload
  // service, and nothing can spin for ever: there is a time limit and Cancel.
  async function read(file) {
    if (!file) return
    const mine = attempt.current + 1
    attempt.current = mine
    setError(''); setStage('preparing')
    try {
      const { photos = [], note = '', ...payload } = await trayFilePayload(file)
      if (attempt.current !== mine) return
      setStage('reading')
      const data = await call('tray-read', { ...payload, filename: file.name }, 115000)
      if (attempt.current !== mine) return
      // Each tray's photo, matched by the number the reading gave it. Kept on
      // the phone until the list is saved.
      const byN = new Map(photos.map(p => [p.n, p.data]))
      // A one-tray list whose reading named no photo still has one if the file
      // does: the first picture in it is the tray (a check sheet puts the tray
      // photo first and the item pictures after).
      const named = data.trays.map(t => (t.photo && byN.has(t.photo) ? t.photo : null))
      if (data.trays.length === 1 && !named[0] && photos.length) named[0] = photos[0].n
      const trays = data.trays.map((t, i) => ({ ...t, photoData: named[i] ? byN.get(named[i]) : null, photo: null }))
      setReview({ ...data, trays, file: file.name, attempt: mine, keeping: true, note, photoCount: photos.length })
      setOpen('')
      keepOriginal(file, mine)
    } catch (err) {
      if (attempt.current === mine) setError(err.message || 'The tray list could not be read')
    }
    if (attempt.current === mine) setStage('')
  }

  function cancel() {
    attempt.current += 1
    setStage('')
  }

  async function save() {
    setStage('saving'); setError('')
    try {
      // The photos first, one request each, into Dropbox; the list then
      // carries where each one went.
      const trays = []
      for (const t of review.trays) {
        let photo = null
        if (t.photoData) {
          const kept = await call('tray-photo', { data: t.photoData, trayName: t.name }, 60000)
          photo = kept.path
        }
        const { photoData, ...rest } = t
        trays.push({ ...rest, photo })
      }
      const { list: saved } = await post('savelist', {
        kitId: kit.id, trays,
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
          Read from {review.file}: {review.trays.length} trays, {lines} lines.{review.note ? ` ${review.note}` : ''} Open each tray and check the codes and quantities
          against the paper. Leave out anything that is not part of this kit.
          {review.photoCount ? ` ${review.trays.filter(t => t.photoData).length} of ${review.trays.length} trays have a photo.` : ' No photos were found in this file.'}
          {review.keeping ? ' Saving the original to Dropbox…' : review.dropboxPath ? ` Original saved in Dropbox: ${review.dropboxPath}` : ''}
          {review.dropboxError ? ` (Not saved to Dropbox: ${review.dropboxError})` : ''}
        </div>
        {review.trays.map((t, ti) => (
          <TrayBlock key={t.name} tray={t} photoData={t.photoData} user={user} open={open === t.name} onToggle={() => setOpen(open === t.name ? '' : t.name)}
            onRemove={() => setReview(r => ({ ...r, trays: r.trays.filter((_, j) => j !== ti) }))}
            onRemoveLine={li => setReview(r => ({ ...r, trays: r.trays.map((x, j) => (j === ti ? { ...x, lines: x.lines.filter((_, k) => k !== li) } : x)) }))} />
        ))}
        {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
        <div style={{ display: 'flex', gap: space.sm }}>
          <button disabled={stage === 'saving' || !review.trays.length} onClick={save} style={{
            flex: 2, ...text('bodyStrong'), padding: space.md, borderRadius: radius.control, border: 'none',
            background: colour.accent, color: 'white', cursor: 'pointer', opacity: stage === 'saving' ? 0.6 : 1
          }}>{stage === 'saving' ? 'Saving the list and photos…' : `Save to ${kit.name}`}</button>
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
            {list.source?.dropboxPath ? ` Original in Dropbox: ${list.source.dropboxPath}` : ''}
          </div>
          {list.trays.map(t => (
            <TrayBlock key={t.name} tray={t} user={user} open={open === t.name} onToggle={() => setOpen(open === t.name ? '' : t.name)} />
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
            {stage === 'preparing' ? 'Opening the file…' : stage === 'reading' ? 'Reading the tray list…'
              : list ? 'Upload a new tray list' : 'Upload tray list (PDF, Word, Excel or photo)'}
            <input type="file" accept={ACCEPT} disabled={Boolean(stage)} style={{ display: 'none', fontSize: 16 }}
              onChange={e => { read(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {stage && (
            <button onClick={cancel} style={{ ...text('caption'), marginTop: space.sm, background: 'none', border: 'none', color: colour.inkFaint, cursor: 'pointer', textDecoration: 'underline' }}>
              Cancel
            </button>
          )}
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
