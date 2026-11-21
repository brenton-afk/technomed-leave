import { uniqueTrayNames } from '../../trayNames.js'
import { shareFiles, shareText, trayListText, shareReady } from '../../kit/share.js'
import DocViewer from '../../kit/DocViewer.jsx'
import React, { useState, useEffect, useRef } from 'react'
import { upload } from '@vercel/blob/client'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { trayFilePayload, originalIfSmall } from './readTrayFile.js'
import EditableTray from './EditableTray.jsx'
import { trayPlace } from '../../kit/trayPlaces.js'
import RepairSheet from './RepairSheet.jsx'
import { printTrayList } from './printTrayList.js'
import { useLiveRefresh } from '../../liveRefresh.js'
import { useBackLayer } from '../../backButton.js'
import { Overlay } from '../../design/Shell.jsx'

// ─── What is in each tray ────────────────────────────────────────────────────
// A kit's tray list: uploaded from the hospital's own copy (a PDF, a Word
// document, a spreadsheet or a photo), read by the portal, checked by a
// person, then saved. Nothing read from a file is saved without someone
// looking at it first — a wrong quantity here is a stock-take that never adds
// up.
//
// Implants are counted, instruments are ticked (Brent, 2 Nov 2026), so each
// line carries which it is and the reviewer can see the split.

const PLACES = { office: 'TM office / Warehouse', CLV: 'Calvary', RHH: 'RHH' }
const ACCEPT = '.pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp,application/pdf,image/*'


/** A saved photo, from Dropbox by a link fetched when it is shown. */
function SavedPhoto({ path, user, alt, onOpen, maxHeight = 320 }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let live = true
    fetch(`/api/guides?kits=photo&path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${user?.token || ''}` } })
      .then(r => r.json()).then(d => live && d.url && setUrl(d.url)).catch(() => {})
    return () => { live = false }
  }, [path, user?.token])
  if (!url) return <div style={{ height: 120, background: colour.lineSoft, borderRadius: radius.control, marginBottom: space.sm }} />
  const img = <img src={url} alt={alt} style={{ display: 'block', width: '100%', maxHeight, objectFit: 'contain', borderRadius: radius.control, background: colour.canvas }} />
  if (!onOpen) return <div style={{ marginBottom: space.sm }}>{img}</div>
  return (
    <button type="button" onClick={() => onOpen(url)} aria-label={`${alt} — full size`} data-tray-photo
      style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}>{img}</button>
  )
}

/**
 * Links for a tray's item pictures, fetched in one request once the tray is
 * open (and never stored — a Dropbox link is fetched per view).
 */
function useItemPhotos(lines, open, user) {
  const [urls, setUrls] = useState({})
  const paths = open ? [...new Set(lines.map(l => l.photo).filter(Boolean))] : []
  const key = paths.join('|')
  useEffect(() => {
    if (!key) return
    let live = true
    fetch('/api/guides?kits=photos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${user?.token || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: key.split('|') })
    }).then(r => r.json()).then(d => live && setUrls(d.urls || {})).catch(() => {})
    return () => { live = false }
  }, [key, user?.token])
  return urls
}

/** An item's picture in its row; tapped, it opens full size. */
function ItemThumb({ src, alt, onOpen }) {
  if (!src) return <span aria-hidden="true" style={{ display: 'block', width: 44, height: 44, borderRadius: 6, background: colour.lineSoft }} />
  return (
    <button type="button" onClick={onOpen} aria-label={`Picture of ${alt}`} data-item-photo
      style={{ display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}>
      <img src={src} alt={alt} loading="lazy"
        style={{ display: 'block', width: 44, height: 44, objectFit: 'cover', borderRadius: 6, background: colour.canvas }} />
    </button>
  )
}

/** A tray on its own page, over the system, with back to the list. */
function TrayPage({ tray, where, onBack, children }) {
  useBackLayer(true, onBack)
  const implants = tray.lines.filter(l => l.kind === 'implant').length
  return (
    <Overlay>
    <div data-tray-page role="dialog" aria-label={tray.name}
      style={{ position: 'fixed', inset: 0, zIndex: 3150, background: colour.surface, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `calc(env(safe-area-inset-top) + ${space.sm}px) ${space.md}px ${space.sm}px`,
        borderBottom: border.hairline, background: colour.surface }}>
        <button onClick={onBack} aria-label="Back to the trays" data-tray-back
          style={{ width: 40, height: 40, flexShrink: 0, borderRadius: radius.control, border: 'none', background: colour.canvas,
            color: colour.ink, ...text('heading'), cursor: 'pointer' }}>‹</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...text('heading'), color: colour.ink, lineHeight: 1.2 }}>{tray.name}</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            {where ? `${where} · ` : ''}{tray.lines.length ? `${tray.lines.length} ${tray.lines.length === 1 ? 'item' : 'items'} · ${implants} implant${implants === 1 ? '' : 's'}` : 'Nothing listed yet'}
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingTop: space.sm, paddingBottom: `calc(env(safe-area-inset-bottom) + ${space.md}px)` }}>
        {children}
      </div>
    </div>
    </Overlay>
  )
}

// "It would be better in a table with the instrument description and the qty
// next to it. Nice and neat." Code, description, quantity — one row per line,
// ruled, the quantity right-aligned so a column of numbers reads down.
function TrayBlock({ tray, open, onToggle, onRemove, onRemoveLine, photoData, user, onEdit, editing, onEditDone, onStartEdit, onPrint, where, onMove, onRepair, onRepaired, checked, onCheck }) {
  const implants = tray.lines.filter(l => l.kind === 'implant').length
  const hasPhoto = Boolean(photoData || tray.photo)
  // Item pictures (Brent, 11 Nov 2026): on the phone while checking, from
  // Dropbox once saved.
  const urls = useItemPhotos(tray.lines, open && !editing, user)
  const itemSrc = l => (l.photoData ? `data:image/jpeg;base64,${l.photoData}` : (l.photo ? urls[l.photo] : ''))
  const withPictures = tray.lines.some(l => l.photoData || l.photo)
  const pictured = tray.lines.filter(l => l.photoData || l.photo).length
  const [zoom, setZoom] = useState(null)
  // A saved tray opens as its own page (Brent, 21 Nov 2026: "when you open a
  // tray that should open its own page rather than keeping the rest of the
  // list at the bottom … tap back to go back to the rest of the list"). A
  // tray being checked after an upload still opens in place.
  const asPage = Boolean(onMove || onStartEdit || onPrint) && !onRemove
  const inner = (
    <>
      {open && !editing && (onMove || onStartEdit || onPrint) && (
          <div data-tray-actions style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', padding: `0 ${space.md}px ${space.sm}px` }}>
            {onMove && (
              <button onClick={onMove} aria-label={`Move ${tray.name}`} data-move-tray
                style={{ ...text('caption'), fontWeight: 600, color: 'white', background: colour.navy, border: 'none',
                  borderRadius: radius.pill, padding: '6px 14px', cursor: 'pointer' }}>Move</button>
            )}
            {onStartEdit && (
              <button onClick={onStartEdit} aria-label={`Edit ${tray.name}`}
                style={{ ...text('caption'), fontWeight: 600, color: colour.accentDeep, background: 'none', border: `1px solid ${colour.accent}`,
                  borderRadius: radius.pill, padding: '6px 14px', cursor: 'pointer' }}>Edit</button>
            )}
            {onPrint && (
              <button onClick={onPrint} aria-label={`Print ${tray.name}`}
                style={{ ...text('caption'), fontWeight: 600, color: colour.inkMuted, background: 'none', border: border.hairline,
                  borderRadius: radius.pill, padding: '6px 14px', cursor: 'pointer' }}>Print</button>
            )}
          </div>
        )}
        {editing && (
          <div style={{ borderTop: border.hairlineSoft }}>
            {tray.photo && <div style={{ padding: `${space.sm}px ${space.sm}px 0` }}><SavedPhoto path={tray.photo} user={user} alt={tray.name} /></div>}
            <EditableTray tray={tray} onEdit={onEdit} onDone={onEditDone} />
          </div>
        )}
        {open && !editing && (
          <div style={{ borderTop: border.hairlineSoft, padding: `0 ${space.sm}px ${space.sm}px` }}>
            {/* The photo stays at the top while the list scrolls under it, a
                third of the screen at most; tap it for full size (Brent,
                21 Nov 2026: "It's just a long way to scroll"). */}
            {(photoData || tray.photo) && (
              <div data-sticky-photo style={{ position: 'sticky', top: asPage ? 0 : -space.md, zIndex: 2, background: colour.surface,
                padding: `${space.md}px 0 ${space.xs}px`, borderBottom: border.hairlineSoft }}>
                {photoData
                  ? <button type="button" data-tray-photo aria-label={`${tray.name} — full size`}
                      onClick={() => setZoom({ url: `data:image/jpeg;base64,${photoData}`, name: `${tray.name}.jpg` })}
                      style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}>
                      <img src={`data:image/jpeg;base64,${photoData}`} alt={`${tray.name}`}
                        style={{ display: 'block', width: '100%', maxHeight: 'min(30vh, 240px)', objectFit: 'contain', borderRadius: radius.control, background: colour.canvas }} />
                    </button>
                  : <SavedPhoto path={tray.photo} user={user} alt={tray.name} maxHeight="min(30vh, 240px)"
                      onOpen={url => setZoom({ url, name: `${tray.name}.jpg` })} />}
              </div>
            )}
            {/* One compact row per line: the photo's number, what it is with
                its code beneath, the quantity, and Repair. */}
            <div role="list" data-tray-lines>
              {tray.lines.map((l, i) => {
                const m = /^#(\d+)\s+/.exec(l.description || '')
                const ref = m ? m[1] : ''
                const what = m ? l.description.slice(m[0].length) : l.description
                return (
                  <div role="listitem" key={`${l.code}-${i}`} data-tray-line
                    style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: '5px 2px', borderBottom: border.hairlineSoft }}>
                    {withPictures && (
                      <div style={{ width: 44, flexShrink: 0 }}>
                        {(l.photoData || l.photo) && (
                          <ItemThumb src={itemSrc(l)} alt={l.description || l.code}
                            onOpen={() => setZoom({ url: itemSrc(l), name: `${l.description || l.code || 'Item'}.jpg` })} />
                        )}
                      </div>
                    )}
                    {ref && (
                      <span aria-label={`Number ${ref} on the photo`} style={{ ...text('micro'), fontWeight: 700, color: colour.navy, background: colour.lineSoft,
                        borderRadius: 6, minWidth: 22, textAlign: 'center', padding: '2px 4px', flexShrink: 0 }}>{ref}</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...text('caption'), color: colour.ink, lineHeight: 1.25 }}>
                        {what}
                      </div>
                      <div style={{ ...text('micro'), color: colour.inkFaint, letterSpacing: 0, overflowWrap: 'anywhere' }}>
                        {l.code || '—'}
                        {l.kind === 'implant' && <span style={{ color: colour.accentDeep, marginLeft: 6, textTransform: 'uppercase' }}>· implant</span>}
                      </div>
                    </div>
                    <div style={{ ...text('caption'), fontWeight: 700, color: colour.ink, minWidth: 28, textAlign: 'right', flexShrink: 0 }}>×{l.qty}</div>
                    {onRepair && (l.repair ? (
                      <button onClick={() => onRepaired(i, l)} data-repair-back title={`Away for repair since ${new Date(l.repair.since).toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short' })}${l.repair.fault ? ` — ${l.repair.fault}` : ''}`}
                        style={{ ...text('micro'), textTransform: 'none', letterSpacing: 0, fontWeight: 700, color: colour.warning, background: colour.warningSoft,
                          border: `1px solid ${colour.warning}`, borderRadius: radius.pill, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        At repair · back?
                      </button>
                    ) : l.kind !== 'implant' ? (
                      <button onClick={() => onRepair(i, l)} data-repair-line aria-label={`Send ${l.description || l.code} for repair`}
                        style={{ ...text('micro'), textTransform: 'none', letterSpacing: 0, fontWeight: 600, color: colour.inkMuted, background: 'none',
                          border: border.hairline, borderRadius: radius.pill, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        Repair
                      </button>
                    ) : <span style={{ width: 52, flexShrink: 0 }} />)}
                    {onRemoveLine && (
                      <button onClick={() => onRemoveLine(i)} aria-label={`Remove ${l.description}`}
                        style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}>×</button>
                    )}
                  </div>
                )
              })}
            </div>
            {zoom && <DocViewer name={zoom.name} url={zoom.url} onClose={() => setZoom(null)} />}
          </div>
        )}
      </>
  )
  return (
    <div style={{ background: colour.surface, border: border.hairline, borderRadius: radius.control, marginBottom: space.sm, overflow: 'clip' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px` }}>
        {/* Tick several trays to move them together (Brent, 20 Nov 2026). */}
        {onCheck && !editing && (
          <input type="checkbox" checked={Boolean(checked)} onChange={onCheck} aria-label={`Select ${tray.name}`} data-select-tray
            style={{ width: 22, height: 22, flexShrink: 0, accentColor: colour.accent, fontSize: 16, cursor: 'pointer' }} />
        )}
        <button onClick={onToggle} aria-expanded={asPage ? undefined : open} style={{ flex: 1, background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer' }}>
          <div style={{ ...text('bodyStrong'), color: colour.ink }}>{tray.name}</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            {where ? `${where} · ` : ''}{tray.lines.length ? `${tray.lines.length} ${tray.lines.length === 1 ? 'item' : 'items'} · ${implants} implant${implants === 1 ? '' : 's'}${hasPhoto ? ' · photo' : ' · no photo'}` : 'Nothing listed yet'}
            {tray.lines.some(l => l.repair) ? ` · ${tray.lines.filter(l => l.repair).length} away for repair` : ''}
            {pictured ? ` · ${pictured} item picture${pictured === 1 ? '' : 's'}` : ''}
            {tray.updatedBy ? ` · updated by ${tray.updatedBy}${tray.updatedAt ? ` ${new Date(tray.updatedAt).toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short' })}` : ''}` : ''}
          </div>
        </button>
        {/* The tray's actions are inside it (Brent, 21 Nov 2026, the system
            screen he picked): a row is the tick, the name and what it holds. */}
        {(onMove || onStartEdit || onPrint) && !editing && (
          <span aria-hidden="true" style={{ color: colour.inkFainter, ...text('heading'), transform: open && !asPage ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
        )}
        {onRemove && (
          <button onClick={onRemove} aria-label={`Leave out ${tray.name}`}
            style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer' }}>Leave out</button>
        )}
      </div>
      {!asPage && inner}
      {asPage && open && (
        <TrayPage tray={tray} where={where} onBack={() => { if (editing) onEditDone?.(); onToggle() }}>
          {inner}
        </TrayPage>
      )}
    </div>
  )
}

export default function TrayList({ kit, canEdit, user, post, onSaved, onMoveTray, title = 'Trays', only = null, except = null, selected = null, onSelect = null, compact = false, showWhere = true, rows = true }) {
  const [list, setList] = useState(undefined)
  const [repairing, setRepairing] = useState(null)
  const [open, setOpen] = useState('')
  const [stage, setStage] = useState('')
  const [review, setReview] = useState(null)
  const [hospital, setHospital] = useState(kit.home)
  const [error, setError] = useState('')
  const [editingTray, setEditingTray] = useState('')
  const [editError, setEditError] = useState('')
  const [shareMsg, setShareMsg] = useState('')
  const [viewing, setViewing] = useState(null)
  const headers = { Authorization: `Bearer ${user?.token || ''}` }

  // Live: somebody else's changes appear within a minute, and at once when the
  // phone comes back to the portal. Not while this person is editing a tray —
  // a refresh under their fingers would undo what they are typing.
  useLiveRefresh(() => {
    if (editingTray || review) return
    fetch(`/api/guides?kits=traylist&id=${encodeURIComponent(kit.id)}`, { headers })
      .then(r => r.json()).then(d => { if (d.list !== undefined) setList(d.list || null) }).catch(() => {})
  }, [kit.id, editingTray, review])

  // One change to the saved list. A refusal because somebody else changed the
  // same tray comes back with the list as it now is, which replaces ours.
  async function editList(body) {
    setEditError('')
    try {
      const res = await fetch('/api/guides?kits=editlist', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kitId: kit.id, ...body })
      })
      const data = await res.json().catch(() => ({}))
      if (data.list) setList(data.list)
      if (!res.ok || data.error) throw new Error(data.error || 'Not saved — try again')
      if (body.op === 'rename') { setEditingTray(body.name); setOpen(body.name); onSaved?.() }
      if (body.op === 'deleteTray') { setEditingTray(''); setOpen(''); onSaved?.() }
    } catch (err) {
      setEditError(err.message)
    }
  }

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
  // "(2 of 3)" while several files are read in turn.
  const [progress, setProgress] = useState('')
  // Saving adds to the kit's trays unless this is ticked.
  const [replaceAll, setReplaceAll] = useState(false)

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
  function keepOriginal(file) {
    // Per file, now that one review can hold several documents.
    const done = kept => setReview(r => (r?.originals?.[file.name]
      ? { ...r, originals: { ...r.originals, [file.name]: { ...kept, keeping: false } } } : r))
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
  //
  // Several files at once (Aimee, 4 Nov 2026 — a kit like Diplomat comes as
  // one document per tray). Read one after another, into one review; a file
  // that cannot be read is named and the rest still come through.
  async function read(fileList, { more = false } = {}) {
    const files = [...(fileList || [])].filter(Boolean)
    if (!files.length) return
    const mine = attempt.current + 1
    attempt.current = mine
    setError('')
    const collected = []
    const failed = []
    for (const [i, file] of files.entries()) {
      setProgress(files.length > 1 ? ` (${i + 1} of ${files.length})` : '')
      try {
        collected.push(await readOne(file, mine))
      } catch (err) {
        if (attempt.current !== mine) return
        failed.push(`${file.name}: ${err.message || 'could not be read'}`)
      }
      if (attempt.current !== mine) return
    }
    setStage(''); setProgress('')
    if (collected.length) {
      setReview(r => {
        const base = more && r ? r : { trays: [], files: [], originals: {}, attempt: mine }
        return {
          ...base,
          trays: [...base.trays, ...collected.flatMap(c => c.trays)],
          files: [...base.files, ...collected.map(({ file, note, photoCount }) => ({ file, note, photoCount }))],
          originals: { ...base.originals, ...Object.fromEntries(collected.map(c => [c.file, { keeping: true }])) }
        }
      })
      setOpen('')
      for (const c of collected) keepOriginal(c.original)
    }
    if (failed.length) setError(`Not read — ${failed.join('; ')}`)
  }

  async function readOne(file, mine) {
    setStage('preparing')
    const { photos = [], note = '', ...payload } = await trayFilePayload(file)
    if (attempt.current !== mine) throw new Error('cancelled')
    setStage('reading')
    const data = await call('tray-read', { ...payload, filename: file.name }, 115000)
    if (attempt.current !== mine) throw new Error('cancelled')
    // Each tray's photo, matched by the number the reading gave it. Kept on
    // the phone until the list is saved.
    const byN = new Map(photos.map(p => [p.n, p.data]))
    // A one-tray list whose reading named no photo still has one if the file
    // does: the first picture in it is the tray (a check sheet puts the tray
    // photo first and the item pictures after).
    const onLines = new Set(data.trays.flatMap(t => t.lines.map(l => l.photo).filter(Boolean)))
    const named = data.trays.map(t => (t.photo && byN.has(t.photo) ? t.photo : null))
    const spare = photos.find(p => !onLines.has(p.n))
    if (data.trays.length === 1 && !named[0] && spare) named[0] = spare.n
    // Each item's own picture, from its row (Brent, 11 Nov 2026: "We need the
    // photos") — a check sheet has one beside every item.
    const trays = data.trays.map((t, i) => ({
      ...t, file: file.name, photoData: named[i] ? byN.get(named[i]) : null, photo: null,
      lines: t.lines.map(({ photo, ...l }) => (photo && byN.has(photo) ? { ...l, photoData: byN.get(photo) } : l))
    }))
    return { file: file.name, original: file, trays, note, photoCount: photos.length }
  }

  function cancel() {
    attempt.current += 1
    setStage(''); setProgress('')
  }

  async function save() {
    setStage('saving'); setError('')
    try {
      // The photos first, one request each, into Dropbox; the list then
      // carries where each one went.
      const trays = []
      const photoMissed = []
      // Names made unique first: the photo is filed under the tray's name.
      const named = uniqueTrayNames(review.trays, replaceAll ? [] : (list?.trays || []))
      for (const t of named) {
        let photo = null
        if (t.photoData) {
          // A photo that cannot be kept (Dropbox not connected) must not cost
          // the list: it saves without it, and says so.
          try {
            const kept = await call('tray-photo', { data: t.photoData, trayName: t.name }, 60000)
            photo = kept.path
          } catch (err) {
            photoMissed.push(t.name)
          }
        }
        // The items' pictures, four at a time, each beside its tray's.
        const lines = [...t.lines]
        const waiting = lines.map((l, i) => i).filter(i => lines[i].photoData)
        let lost = 0
        const worker = async () => {
          for (let i = waiting.shift(); i !== undefined; i = waiting.shift()) {
            const { photoData, ...l } = lines[i]
            setProgress(`photos for ${t.name}`)
            try {
              const kept = await call('tray-photo', { data: photoData, trayName: t.name, itemName: `${i + 1} ${l.code || l.description}` }, 60000)
              lines[i] = { ...l, photo: kept.path }
            } catch {
              lines[i] = l
              lost += 1
            }
          }
        }
        await Promise.all([worker(), worker(), worker(), worker()])
        if (lost) photoMissed.push(`${lost} item${lost === 1 ? '' : 's'} on ${t.name}`)
        const { photoData, ...rest } = t
        trays.push({ ...rest, lines, photo, dropboxPath: review.originals?.[t.file]?.dropboxPath || '' })
      }
      setProgress('')
      const first = review.files[0]?.file
      const { list: saved } = await post('savelist', {
        kitId: kit.id, trays, mode: replaceAll ? 'replace' : 'add',
        source: { file: review.files.map(f => f.file).join(', '), hospital, dropboxPath: review.originals?.[first]?.dropboxPath || '' }
      })
      setReplaceAll(false)
      setList(saved); setReview(null)
      if (photoMissed.length) {
        setError(`Saved — but the photo for ${photoMissed.join(', ')} could not be kept (Dropbox did not take it). Upload that list again to bring the photos across.`)
      }
      await onSaved?.()
    } catch (err) { setError(err.message) }
    setStage('')
  }

  // "Share the consignment agreement or tray list from the kit room page with
  // a simple share button" (Brent, 11 Nov 2026): the original document(s) the
  // list was read from, through the phone's share sheet; the list as text
  // where no original was kept.
  async function shareList() {
    setShareMsg('Getting the tray list ready…')
    try {
      const paths = [...new Set((list?.trays || []).map(t => t.dropboxPath).filter(Boolean))]
      const title = `${kit.name} — tray list`
      let how
      if (paths.length) {
        const links = []
        for (const path of paths) {
          const res = await fetch(`/api/guides?kits=tray-file&id=${encodeURIComponent(kit.id)}&path=${encodeURIComponent(path)}`,
            { headers: { Authorization: `Bearer ${user?.token || ''}` } })
          const body = await res.json()
          if (!res.ok) throw new Error(body.error || 'Could not get the tray list')
          links.push({ url: body.url, name: body.name })
        }
        how = await shareFiles(links, { title })
      } else {
        how = await shareText({ title, text: trayListText(kit.name, list) })
      }
      setShareMsg(how === 'downloaded' ? 'Downloaded — attach it to an email or message.'
        : how === 'copied' ? 'Copied — paste it into an email or message.'
          : how === 'needs-tap' ? 'ready' : '')
    } catch (err) { setShareMsg(err.message) }
  }

  // The hospital's own document, in the portal's viewer.
  async function viewOriginal() {
    setShareMsg('Opening the original…')
    try {
      const res = await fetch(`/api/guides?kits=tray-file&id=${encodeURIComponent(kit.id)}`, { headers: { Authorization: `Bearer ${user?.token || ''}` } })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not open it')
      setViewing({ url: body.url, name: body.name, path: body.path, rev: body.rev })
      setShareMsg('')
    } catch (err) { setShareMsg(err.message) }
  }

  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.lg}px 0 ${space.sm}px` }

  if (review) {
    const lines = review.trays.reduce((n, t) => n + t.lines.length, 0)
    const originals = Object.values(review.originals || {})
    const photos = review.trays.filter(t => t.photoData).length
    const itemPictures = review.trays.reduce((n, t) => n + t.lines.filter(l => l.photoData).length, 0)
    return (
      <div>
        <div style={label}>Check the tray list before saving</div>
        <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
          Read from {review.files.length === 1 ? review.files[0].file : `${review.files.length} files`}: {review.trays.length} trays, {lines} lines.
          {review.files.map(f => f.note).filter(Boolean).map(n => ` ${n}`).join('')} Open each tray and check the codes and quantities
          against the paper. Leave out anything that is not part of this kit.
          {photos ? ` ${photos} of ${review.trays.length} trays have a photo.` : ' No tray photo was found.'}
          {itemPictures ? ` ${itemPictures} items have their own picture.` : ''}
          {!photos && !itemPictures ? ' This document has no photos in it.' : ''}
          {originals.some(o => o.keeping) ? ' Saving the originals to Dropbox…'
            : originals.some(o => o.dropboxPath) ? ' Originals saved in Dropbox under Tray Lists.' : ''}
          {originals.some(o => o.dropboxError) ? ' (Some originals were not saved to Dropbox — add them there by hand.)' : ''}
        </div>
        {review.trays.map((t, ti) => (
          <TrayBlock key={`${t.file}-${t.name}-${ti}`} tray={t} photoData={t.photoData} user={user} open={open === t.name} onToggle={() => setOpen(open === t.name ? '' : t.name)}
            onRemove={() => setReview(r => ({ ...r, trays: r.trays.filter((_, j) => j !== ti) }))}
            onRemoveLine={li => setReview(r => ({ ...r, trays: r.trays.map((x, j) => (j === ti ? { ...x, lines: x.lines.filter((_, k) => k !== li) } : x)) }))} />
        ))}
        <label style={{
          display: 'block', textAlign: 'center', ...text('caption'), fontWeight: 700, padding: space.sm,
          borderRadius: radius.control, border: `1px dashed ${colour.accent}`, color: colour.accentDeep,
          background: colour.surface, cursor: stage ? 'default' : 'pointer', opacity: stage ? 0.6 : 1, marginBottom: space.sm
        }}>
          {stage === 'preparing' || stage === 'reading' ? `Reading${progress}…` : '＋ Add another file'}
          <input type="file" multiple accept={ACCEPT} disabled={Boolean(stage)} style={{ display: 'none', fontSize: 16 }}
            onChange={e => { read(e.target.files, { more: true }); e.target.value = '' }} />
        </label>
        {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
        <div style={{ display: 'flex', gap: space.sm }}>
          <button disabled={Boolean(stage) || !review.trays.length} onClick={save} style={{
            flex: 2, ...text('bodyStrong'), padding: space.md, borderRadius: radius.control, border: 'none',
            background: colour.accent, color: 'white', cursor: 'pointer', opacity: stage === 'saving' ? 0.6 : 1
          }}>{stage === 'saving' ? (progress ? `Saving the ${progress}…` : 'Saving the list and photos…') : `Save to ${kit.name}`}</button>
          <button onClick={() => setReview(null)} style={{
            flex: 1, ...text('bodyStrong'), padding: space.md, borderRadius: radius.control, border: border.hairline,
            background: colour.surface, color: colour.ink, cursor: 'pointer'
          }}>Cancel</button>
        </div>
        {list && (
          <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, ...text('caption'), marginTop: space.sm,
            color: replaceAll ? colour.warning : colour.inkFaint, minHeight: 44 }}>
            <input type="checkbox" checked={replaceAll} onChange={e => setReplaceAll(e.target.checked)} style={{ fontSize: 16, width: 20, height: 20 }} />
            {replaceAll
              ? `Replace all ${list.trays.length} trays this kit has now`
              : `Adds to the ${list.trays.length} tray${list.trays.length === 1 ? '' : 's'} this kit has. Uploading the same document again updates its trays; a tray from another document with a name already used is kept beside it, numbered. Tick to start the list again instead.`}
          </label>
        )}
      </div>
    )
  }

  // The kit's trays, each once: those the list holds (in its order), then any
  // the kit names that no document has filled yet.
  const listed = list?.trays || []
  const allTrays = [...listed, ...(kit.trays || []).filter(n => !listed.some(t => t.name === n)).map(n => ({ name: n, lines: [] }))]
    // A system shows a set's transferred trays apart (Brent, 20 Nov 2026).
    .filter(t => (!only || only.includes(t.name)) && (!except || !except.includes(t.name)))
  // Where a tray is: with the kit, unless it went somewhere on its own.
  const trayAt = name => trayPlace(kit, name)
  const whereIs = name => PLACES[trayAt(name)] || ''

  return (
    <div>
      {!compact && rows && <div style={label}>{title} · {allTrays.length}</div>}
      {list === undefined && <div style={{ ...text('caption'), color: colour.inkFaint }}>Loading…</div>}
      {!compact && rows && list !== undefined && !allTrays.length && (
        <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
          No trays yet{canEdit ? ' — upload the hospital’s copy below, or tap Edit on the kit to add a tray.' : '.'}
        </div>
      )}
      {list && !compact && (
        <>
          {/* Where the list came from (file names, who, Dropbox path) is no longer
              drawn — Brent, 20 Nov 2026: "all the small writing … it's not useful". */}
          {/* "Ability to print tray lists from portal" — Brent, 3 Nov 2026. */}
          <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginBottom: space.sm }}>
            <button type="button" onClick={shareList} disabled={Boolean(shareMsg && shareMsg.endsWith('…'))} data-share-tray-list
              style={{ ...text('caption'), fontWeight: 600, color: 'white', background: colour.navy, border: 'none',
                borderRadius: radius.pill, padding: '5px 12px', cursor: 'pointer' }}>
              Share tray list
            </button>
            {(list?.trays || []).some(t => t.dropboxPath) && (
              <button type="button" onClick={viewOriginal} data-view-tray-original
                style={{ ...text('caption'), fontWeight: 600, color: colour.accentDeep, background: colour.accentSoft, border: 'none',
                  borderRadius: radius.pill, padding: '5px 12px', cursor: 'pointer' }}>
                View original
              </button>
            )}
            <button type="button" onClick={() => printTrayList(kit, list, { printedBy: user?.firstName || user?.name || '', token: user?.token })}
              style={{ ...text('caption'), fontWeight: 600, color: colour.accentDeep, background: colour.accentSoft, border: 'none',
                borderRadius: radius.pill, padding: '5px 12px', cursor: 'pointer' }}>
              Print tray list
            </button>
          </div>
          {shareMsg === 'ready' && (
            <button type="button" onClick={async () => { setShareMsg(''); try { await shareReady() } catch (err) { setShareMsg(err.message) } }}
              style={{ ...text('bodyStrong'), width: '100%', padding: space.sm, marginBottom: space.sm, borderRadius: radius.control,
                border: 'none', background: colour.accent, color: 'white', cursor: 'pointer' }}>
              Ready — tap to share
            </button>
          )}
          {shareMsg && shareMsg !== 'ready' && <div role="status" style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>{shareMsg}</div>}
          {editError && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{editError}</div>}
        </>
      )}
      {editError && !list && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{editError}</div>}
      {/* Every tray of the kit is a button (Brent, 20 Nov 2026): open it to see
          what it holds, edit it, move it on its own, or send an instrument in
          it for repair — whether or not a document was ever uploaded for it. */}
      {rows && list !== undefined && allTrays.map(t => (
        <TrayBlock key={t.name} tray={t} user={user} open={open === t.name} onToggle={() => setOpen(open === t.name ? '' : t.name)}
          where={showWhere ? whereIs(t.name) : ''}
          checked={selected ? selected.has(t.name) : undefined}
          onCheck={onSelect && (kit.trays || []).includes(t.name) ? () => onSelect(t.name) : undefined}
          editing={editingTray === t.name} onStartEdit={canEdit ? () => { setEditingTray(t.name); setOpen(t.name) } : undefined}
          onEditDone={() => setEditingTray('')} onEdit={editList}
          onMove={onMoveTray && (kit.trays || []).includes(t.name) ? () => onMoveTray(t.name) : undefined}
          onRepair={canEdit ? (i, l) => setRepairing({ tray: t.name, index: i, line: l, at: trayAt(t.name) }) : undefined}
          onRepaired={(i, l) => {
            if (window.confirm(`Mark ${l.description || l.code} back from repair and in ${t.name}?`)) {
              editList({ op: 'repaired', tray: t.name, index: i, expect: { code: l.code, description: l.description } })
            }
          }}
          onPrint={list ? () => printTrayList(kit, list, { only: t.name, printedBy: user?.firstName || user?.name || '', token: user?.token }) : undefined} />
      ))}
      {repairing && (
        <RepairSheet kit={kit} job={repairing} headers={headers} onClose={() => setRepairing(null)}
          onDone={next => { setRepairing(null); if (next) setList(next); onSaved?.() }} />
      )}

      {canEdit && !compact && (
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
            {stage === 'preparing' ? `Opening the file${progress}…` : stage === 'reading' ? `Reading the tray list${progress}…`
              : list ? 'Add tray lists — choose one or several files' : 'Upload tray lists (PDF, Word, Excel or photo) — one or several'}
            <input type="file" multiple accept={ACCEPT} disabled={Boolean(stage)} style={{ display: 'none', fontSize: 16 }}
              onChange={e => { read(e.target.files); e.target.value = '' }} />
          </label>
          {stage && (
            <button onClick={cancel} style={{ ...text('caption'), marginTop: space.sm, background: 'none', border: 'none', color: colour.inkFaint, cursor: 'pointer', textDecoration: 'underline' }}>
              Cancel
            </button>
          )}
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.sm }}>{error}</div>}
        </div>
      )}
      {viewing && <DocViewer name={viewing.name} url={viewing.url} path={viewing.path} rev={viewing.rev} onClose={() => setViewing(null)} onShare={() => { setViewing(null); shareList() }} />}
    </div>
  )
}
