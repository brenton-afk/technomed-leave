import React, { useState, useEffect, useRef, useCallback } from 'react'
import CameraSheet from './scan/CameraSheet.jsx'
import { releaseCamera } from '../scanner/cameraStream.js'

// Claude downsamples anything larger, and Vercel caps a function request body
// at 4.5MB — a 3-page form at this size lands comfortably inside both.
const MAX_IMAGE_DIM = 1568
const JPEG_QUALITY = 0.85
const MAX_PAYLOAD_BYTES = 4_000_000

const NAVY = '#042746'
const TEAL = '#189a85'
const BLUE = '#2899d4'
const AMBER = '#fff3cd'
const AMBER_TEXT = '#856404'
const MUTED = '#6b7a8d'
const BORDER = 'rgba(26,43,74,0.12)'

const DISTRIBUTOR_OPTIONS = [
  { key: '', label: 'Not identified' },
  { key: 'signus', label: 'Signus' },
  { key: 'device', label: 'Device Technologies' },
  { key: 'device_boost', label: 'Device Technologies Boost Allograft' },
  { key: 'e4', label: 'E4 Surgical' },
  { key: 'kt', label: 'KT Medical' },
  { key: 'globus', label: 'Nuvasive/Globus' },
  { key: 'dtbv', label: 'Donor Tissue Bank of Victoria' }
]

// ─── Image handling ──────────────────────────────────────────

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fall through */ }
  }
  // Older iOS Safari: decode through an <img> instead.
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read that image'))
      el.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight, source: img }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })
}

async function fileToPage(file) {
  if (file.type === 'application/pdf') {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mediaType: 'application/pdf',
      data: await readAsBase64(file),
      preview: null,
      name: file.name || 'document.pdf'
    }
  }

  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap.source || bitmap, 0, 0, canvas.width, canvas.height)
  if (typeof bitmap.close === 'function') bitmap.close()

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mediaType: 'image/jpeg',
    data: dataUrl.split(',')[1],
    preview: dataUrl,
    name: file.name || 'photo.jpg'
  }
}

/** Today, on this device, as YYYY-MM-DD. */
function deviceToday() {
  const now = new Date()
  // Built from the local parts rather than toISOString(), which converts to UTC
  // and would hand back tomorrow for most of a Hobart evening.
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
}

function payloadBytes(pages) {
  // base64 inflates by ~4/3.
  return pages.reduce((sum, p) => sum + Math.ceil(p.data.length * 0.75), 0)
}

function newPageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// A drawn canvas → the same page shape produced by fileToPage.
/** A page from an already-flattened preview, as the scanner hands it over. */
function pageFromPreview(page, index) {
  return {
    id: newPageId(),
    mediaType: 'image/jpeg',
    data: page.preview.split(',')[1],
    preview: page.preview,
    name: `page-${index}.jpg`,
    flattened: page.flattened
  }
}

function canvasToPage(canvas, index) {
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return {
    id: newPageId(),
    mediaType: 'image/jpeg',
    data: dataUrl.split(',')[1],
    preview: dataUrl,
    name: `page-${index}.jpg`
  }
}

// ─── In-app camera (stays open across pages) ─────────────────
// The native file picker (`<input capture>`) returns to the app after a single
// shot, which meant tapping "Take Photo" again for every page of the form.
// This holds one live camera stream open so a 2–3 page form is one session.

// Frames are analysed at this width. Small enough that detection costs a
// couple of milliseconds, large enough to place an edge within a pixel or two
// once scaled back up.
// Detection runs at this width, and it is not an arbitrary choice. The detector
// measures brightness across a border over a band a few pixels wide, sized to
// clear a form's printed margin without reaching into its text; those distances
// are in pixels, so the whole thing is calibrated for 320 across. Measured on the
// synthetic bench in scanner/scenes.js, the same scenes score 11/15 at 320x240
// and only 5/15 at 240x180 — the bands stop straddling what they are meant to.
// Larger is not better either: 400x300 scores 9/15 and costs a third more time.
const DETECT_WIDTH = 320
const DETECT_FPS = 30

// Mirrors buildFolderName in api/_usageCase.js so the rep sees the folder
// update as they correct fields. The server recomputes it authoritatively.
function folderPreview(c) {
  const seg = v => String(v || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ /g, '-')
  const dmy = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.date || '')
  return [
    seg(c.patientSurname) || 'UnknownPatient',
    dmy ? `${dmy[3]}${dmy[2]}${dmy[1]}` : 'UnknownDate',
    seg(c.surgeonSurname) || 'UnknownSurgeon',
    seg(c.procedure) || 'Procedure',
    seg(c.hospital) || 'Hospital'
  ].join('_')
}

// ─── Shared bits of chrome ───────────────────────────────────

// Its own header rather than the design system's, because this screen predates it.
// The top padding is the safe-area inset plus normal spacing, not the fixed 56px it
// used to be: that number is one particular iPhone's status bar, and it is wrong on
// a desktop and on the newest phones alike.
function Header({ title, subtitle, children }) {
  return (
    <div style={{ background: NAVY, paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)', paddingLeft: 20, paddingRight: 20, paddingBottom: 20 }}>
      <img src="/logo.png" alt="TechnoMed" style={{ height: 36, width: 'auto', marginBottom: 4 }} />
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>Usage Scanning</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: 'white' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>{subtitle}</div>}
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8,
  fontSize: 14, background: 'white', color: NAVY, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit', appearance: 'none', WebkitAppearance: 'none'
}
const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }

function Field({ label, value, onChange, type = 'text', options }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      {options
        ? (
          <select value={value || ''} onChange={e => onChange(e.target.value)} style={inputStyle}>
            {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        )
        : <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} style={inputStyle} />}
    </div>
  )
}

function Banner({ tone, children }) {
  const tones = {
    error: { bg: '#fdecea', fg: '#c0392b' },
    warn: { bg: AMBER, fg: AMBER_TEXT },
    ok: { bg: '#e6f4f2', fg: TEAL }
  }
  const t = tones[tone] || tones.ok
  return (
    <div style={{ background: t.bg, color: t.fg, padding: '11px 14px', borderRadius: 10, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────

export default function UsageScan({ user }) {
  // Opens on capture, not history: tapping Scan means "scan something now", and
  // making that three taps was the wrong default.
  const [step, setStep] = useState('capture')
  const [pages, setPages] = useState([])
  // Mirrors `pages` so a capture can check the payload size and answer straight
  // away, without reading state that has not been committed yet.
  const pagesRef = useRef([])
  const [caseRecord, setCaseRecord] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [showCamera, setShowCamera] = useState(false)

  const uploadRef = useRef(null)

  const authHeaders = { Authorization: `Bearer ${user?.token || ''}` }

  useEffect(() => { loadHistory() }, [])

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/usage/agent?action=list', { headers: authHeaders })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setHistory(data.records || [])
    } catch (err) {
      setError('Could not load usage history: ' + err.message)
    }
    setHistoryLoading(false)
  }

  // Single gate for both capture paths, so the request-size cap is enforced
  // whether pages arrive from the camera or the photo library.
  // Deliberately not written as a setPages updater. It used to be, with the size
  // check and setError inside it, and that is why the shutter appeared to do
  // nothing and Done did nothing after it: React runs updaters during render, so
  // calling setError from inside one is not allowed and the page was never
  // actually added. The returned flag was wrong for the same reason — it was read
  // before the updater had run, so it always said "accepted".
  //
  // A ref holds the authoritative list so the size check is synchronous and the
  // answer this returns is true.
  const addPages = useCallback(added => {
    const next = [...pagesRef.current, ...added]
    if (payloadBytes(next) > MAX_PAYLOAD_BYTES) {
      setError('That is as many pages as can be processed in one scan. Read these now, then start a second scan for the rest.')
      return false
    }
    pagesRef.current = next
    setPages(next)
    setError('')
    return true
  }, [])

  async function addFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setError('')
    try {
      const added = []
      for (const file of files) added.push(await fileToPage(file))
      addPages(added)
    } catch (err) {
      setError(err.message)
    }
  }

  function removePage(id) {
    pagesRef.current = pages.filter(p => p.id !== id)
    setPages(pagesRef.current)
  }

  // The stream is held open across pages on purpose — see cameraStream.js — so
  // something has to close it when the scanner is actually finished with.
  useEffect(() => () => releaseCamera(), [])

  function startNew() {
    pagesRef.current = []
    setPages([]); setCaseRecord(null); setResult(null)
    setError(''); setNotice(''); setStep('capture'); setShowCamera(true)
  }

  async function processScan() {
    if (!pages.length) return
    setStep('processing'); setError(''); setBusy(true)
    try {
      const res = await fetch('/api/usage/agent?action=scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          pages: pages.map(p => ({ mediaType: p.mediaType, data: p.data })),
          // The surgery date is taken to be today: a form is scanned in theatre
          // or straight after, and today is a better assumption than a
          // handwritten date read off a photograph. Sent from here because only
          // the device knows what day it is where the rep is standing.
          scanDate: deviceToday()
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCaseRecord(data.case)
      if (data.truncated) setNotice('The document was long and extraction may be incomplete — check every row carefully.')
      setStep('review')
    } catch (err) {
      setError(err.message)
      setStep('capture')
    }
    setBusy(false)
  }

  function updateCase(field, value) {
    setCaseRecord(c => ({ ...c, [field]: value }))
  }

  function updateItem(id, field, value) {
    setCaseRecord(c => ({
      ...c,
      items: c.items.map(it => it.id === id ? { ...it, [field]: value } : it)
    }))
  }

  function resolveItem(id) {
    setCaseRecord(c => ({
      ...c,
      items: c.items.map(it => it.id === id ? { ...it, manualReview: false, reviewReasons: [] } : it)
    }))
  }

  function toggleExcluded(id) {
    setCaseRecord(c => ({
      ...c,
      items: c.items.map(it => it.id === id ? { ...it, excluded: !it.excluded, manualReview: false } : it)
    }))
  }

  // Save to Dropbox, then email. Emails only go out once the files are safely
  // stored, so a Dropbox failure is always retryable without double-sending.
  async function confirmAndSend({ testOnly = false } = {}) {
    setBusy(true); setError(''); setNotice('')
    try {
      const saveRes = await fetch('/api/usage/agent?action=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          case: caseRecord,
          pages: pages.map(p => ({ mediaType: p.mediaType, data: p.data }))
        })
      })
      const saved = await saveRes.json()
      if (saved.error) throw new Error(saved.error)

      const emailRes = await fetch('/api/usage/agent?action=email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          usageId: saved.record.id,
          testOnly,
          // The pages again, so the merged scan can be attached. Nothing stores
          // them server-side — the record holds the transcription, not the
          // photographs — and this is what lets the distributor get the signed
          // form whether or not Dropbox is connected.
          pages: pages.map(p => ({ mediaType: p.mediaType, data: p.data }))
        })
      })
      const emailed = await emailRes.json()

      setResult({
        record: saved.record,
        dropboxPath: saved.dropboxPath,
        dropboxSkipped: saved.dropboxSkipped,
        filesSaved: saved.filesSaved,
        heldBackCount: saved.heldBackCount,
        attendance: saved.attendance,
        emails: emailed.results || [],
        emailError: emailed.error || '',
        scanAttached: Boolean(emailed.scanAttached),
        scanError: emailed.scanError || '',
        test: Boolean(emailed.test),
        sentTo: emailed.sentTo
      })
      setStep('done')
      loadHistory()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function resendFailed() {
    const failedKeys = (result?.emails || []).filter(e => !e.ok).map(e => e.key)
    if (!failedKeys.length) return
    setBusy(true)
    try {
      const res = await fetch('/api/usage/agent?action=email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          usageId: result.record.id,
          only: failedKeys,
          // Still in memory unless the app has been reloaded, in which case the
          // retry sends the sheet without the scan and says so.
          pages: pages.map(p => ({ mediaType: p.mediaType, data: p.data }))
        })
      })
      const data = await res.json()
      const byKey = new Map((data.results || []).map(r => [r.key, r]))
      setResult(r => ({ ...r, emails: r.emails.map(e => byKey.get(e.key) || e) }))
      loadHistory()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  // ── History ──────────────────────────────────────────────
  if (step === 'history') {
    return (
      <div style={{ minHeight: '100vh', background: '#f0f3f7', fontFamily: '-apple-system,sans-serif' }}>
        <Header title="Usage Scanning" subtitle={`${user?.name?.split(' ')[0] || 'Rep'} · scan a usage form to file and send it`} />
        <div style={{ padding: 16 }}>
          {error && <Banner tone="error">{error}</Banner>}
          <button onClick={startNew} style={{ width: '100%', padding: 15, background: TEAL, color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 16 }}>
            📷 New Usage Scan
          </button>

          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Recent scans</div>
          {historyLoading && <div style={{ textAlign: 'center', padding: 30, color: MUTED, fontSize: 14 }}>Loading…</div>}
          {!historyLoading && history.length === 0 && (
            <div style={{ background: 'white', borderRadius: 12, padding: 32, textAlign: 'center', color: MUTED, fontSize: 14 }}>
              No usage scans yet.
            </div>
          )}
          {history.map(h => {
            const failed = (h.emailsSent || []).filter(e => !e.ok).length
            const sent = (h.emailsSent || []).filter(e => e.ok).length
            return (
              <div key={h.id} style={{ background: 'white', borderRadius: 12, padding: '13px 15px', marginBottom: 10, border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, wordBreak: 'break-all' }}>{h.folderName}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                  {h.itemCount} item{h.itemCount === 1 ? '' : 's'} · {h.repName || '—'}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: '#e6f4f2', color: TEAL }}>
                    {h.filesSaved?.length || 0} file{(h.filesSaved?.length || 0) === 1 ? '' : 's'} in Dropbox
                  </span>
                  {sent > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: '#eaf4fc', color: BLUE }}>{sent} emailed</span>}
                  {failed > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: '#fdecea', color: '#c0392b' }}>{failed} failed</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Capture ──────────────────────────────────────────────
  if (step === 'capture') {
    return (
      <div style={{ minHeight: '100vh', background: '#f0f3f7', fontFamily: '-apple-system,sans-serif' }}>
        <Header title="Add pages" subtitle="Photograph or upload every page of the usage form" />
        <div style={{ padding: 16 }}>
          {error && <Banner tone="error">{error}</Banner>}

          <input ref={uploadRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />

          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <button onClick={() => setShowCamera(true)} style={{ flex: 1, padding: 14, background: TEAL, color: 'white', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              📷 {pages.length ? 'Add more pages' : 'Scan pages'}
            </button>
            <button onClick={() => uploadRef.current?.click()} style={{ flex: 1, padding: 14, background: 'white', color: NAVY, border: `1px solid ${BORDER}`, borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              📄 Upload
            </button>
          </div>

          {pages.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
                {pages.length} page{pages.length === 1 ? '' : 's'} ready
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
                {pages.map((p, i) => (
                  <div key={p.id} style={{ position: 'relative', background: 'white', borderRadius: 10, overflow: 'hidden', border: `1px solid ${BORDER}`, aspectRatio: '3/4' }}>
                    {p.preview
                      ? <img src={p.preview} alt={`Page ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 4, color: MUTED, fontSize: 11, padding: 6, textAlign: 'center' }}>
                          <span style={{ fontSize: 22 }}>📄</span>PDF
                        </div>}
                    <button onClick={() => removePage(p.id)} aria-label={`Remove page ${i + 1}`}
                      style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, border: 'none', background: 'rgba(4,39,70,0.75)', color: 'white', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}>×</button>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(4,39,70,0.72)', color: 'white', fontSize: 10, padding: '3px 6px' }}>Page {i + 1}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <button onClick={processScan} disabled={!pages.length}
            style={{ width: '100%', padding: 15, background: pages.length ? NAVY : '#c8d2dc', color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: pages.length ? 'pointer' : 'default', marginBottom: 10 }}>
            Read usage document
          </button>
          <button onClick={() => setStep('history')} style={{ width: '100%', padding: 12, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 13, color: MUTED, cursor: 'pointer' }}>
            Past scans
          </button>
        </div>

        {showCamera && (
          <CameraSheet
            pageCount={pages.length}
            onCapture={page => addPages([pageFromPreview(page, pages.length + 1)])}
            onDone={() => setShowCamera(false)}
            onFallback={() => { setShowCamera(false); uploadRef.current?.click() }}
          />
        )}
      </div>
    )
  }

  // ── Processing ───────────────────────────────────────────
  if (step === 'processing') {
    return (
      <div style={{ minHeight: '100vh', background: NAVY, fontFamily: '-apple-system,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, margin: '0 auto 22px', border: '3px solid rgba(255,255,255,0.18)', borderTopColor: TEAL, borderRadius: '50%', animation: 'tmspin 0.9s linear infinite' }} />
          <style>{'@keyframes tmspin{to{transform:rotate(360deg)}}'}</style>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'white', marginBottom: 6 }}>Reading your usage document…</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
            Extracting implant stickers and handwritten entries.<br />This can take up to a minute.
          </div>
        </div>
      </div>
    )
  }

  // ── Review ───────────────────────────────────────────────
  if (step === 'review' && caseRecord) {
    const flagged = caseRecord.items.filter(it => it.manualReview && !it.excluded)
    const clean = caseRecord.items.filter(it => !it.manualReview && !it.excluded)
    const excluded = caseRecord.items.filter(it => it.excluded)

    return (
      <div style={{ minHeight: '100vh', background: '#f0f3f7', fontFamily: '-apple-system,sans-serif' }}>
        <Header title="Review extracted usage" subtitle="Check every field before filing and sending" />
        <div style={{ padding: 16 }}>
          {error && <Banner tone="error">{error}</Banner>}
          {notice && <Banner tone="warn">{notice}</Banner>}
          {flagged.length > 0 && (
            <Banner tone="warn">
              <strong>{flagged.length} item{flagged.length === 1 ? '' : 's'} need{flagged.length === 1 ? 's' : ''} review.</strong> Flagged rows are not emailed until you resolve them.
            </Banner>
          )}

          <div style={{ background: 'white', borderRadius: 12, padding: 14, marginBottom: 14, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Folder & subject</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: BLUE, wordBreak: 'break-all', marginBottom: 14 }}>{folderPreview(caseRecord)}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Patient surname" value={caseRecord.patientSurname} onChange={v => updateCase('patientSurname', v)} />
              <Field label="First name" value={caseRecord.patientFirstName} onChange={v => updateCase('patientFirstName', v)} />
              <Field label="UR number" value={caseRecord.patientUrNumber} onChange={v => updateCase('patientUrNumber', v)} />
              <Field label="Date" type="date" value={caseRecord.date} onChange={v => updateCase('date', v)} />
              {/* A quiet confirmation, not a question.
                  Forms are always scanned in theatre on the day of surgery, so
                  today's date is right by definition and a date read off the form
                  that differs is a misread. An earlier version said so — "the form
                  looks like it says 18/08/2026" — which invited replacing a
                  correct date with a wrong one. The field is still editable for
                  the day that assumption does not hold; it is just not asked
                  about. */}
              {caseRecord.dateSource === 'scan' && (
                <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5, margin: '-4px 0 10px' }}>
                  Today, from this device.
                </div>
              )}
              <Field label="Surgeon" value={caseRecord.surgeonName} onChange={v => updateCase('surgeonName', v)} />
              <Field label="Surgeon surname" value={caseRecord.surgeonSurname} onChange={v => updateCase('surgeonSurname', v)} />
              <Field label="Procedure" value={caseRecord.procedure} onChange={v => updateCase('procedure', v)} />
              <Field label="Hospital" value={caseRecord.hospital} onChange={v => updateCase('hospital', v)}
                options={[{ key: '', label: 'Select…' }, { key: 'CLV', label: 'CLV — Calvary' }, { key: 'RHH', label: 'Royal Hobart' }]} />
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Rep: <strong style={{ color: NAVY }}>{caseRecord.repName}</strong>
              {caseRecord.repNameOnForm && caseRecord.repNameOnForm !== caseRecord.repName && ` · form reads "${caseRecord.repNameOnForm}"`}
            </div>
          </div>

          {[['Needs review', flagged, true], ['Extracted items', clean, false], ['Excluded', excluded, false]].map(([title, list, isFlagged]) => (
            list.length === 0 ? null : (
              <div key={title}>
                <div style={{ fontSize: 11, fontWeight: 700, color: isFlagged ? AMBER_TEXT : MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '16px 0 10px' }}>
                  {title} ({list.length})
                </div>
                {list.map(item => (
                  <div key={item.id} style={{ background: isFlagged ? AMBER : 'white', borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${isFlagged ? 'rgba(133,100,4,0.25)' : BORDER}`, opacity: item.excluded ? 0.6 : 1 }}>
                    {isFlagged && item.reviewReasons?.length > 0 && (
                      <div style={{ fontSize: 11, color: AMBER_TEXT, fontWeight: 600, marginBottom: 10 }}>⚠ {item.reviewReasons.join(' · ')}</div>
                    )}
                    <Field label="Product / system" value={item.productName} onChange={v => updateItem(item.id, 'productName', v)} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <Field label="Reference code" value={item.referenceCode} onChange={v => updateItem(item.id, 'referenceCode', v)} />
                      <Field label="Lot number" value={item.lotNumber} onChange={v => updateItem(item.id, 'lotNumber', v)} />
                      <Field label="Size" value={item.size} onChange={v => updateItem(item.id, 'size', v)} />
                      <Field label="Quantity" type="number" value={item.quantity} onChange={v => updateItem(item.id, 'quantity', v)} />
                      <Field label="Rebate code" value={item.rebateCode} onChange={v => updateItem(item.id, 'rebateCode', v)} />
                    </div>
                    <Field label="Distributor" value={item.distributorKey || ''} onChange={v => updateItem(item.id, 'distributorKey', v)} options={DISTRIBUTOR_OPTIONS} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      {isFlagged && (
                        <button onClick={() => resolveItem(item.id)} disabled={!item.distributorKey || !item.productName}
                          style={{ flex: 1, padding: 10, background: (!item.distributorKey || !item.productName) ? '#d9cfae' : TEAL, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: (!item.distributorKey || !item.productName) ? 'default' : 'pointer' }}>
                          ✓ Mark resolved
                        </button>
                      )}
                      <button onClick={() => toggleExcluded(item.id)}
                        style={{ flex: 1, padding: 10, background: 'transparent', color: item.excluded ? TEAL : '#c0392b', border: `1px solid ${item.excluded ? 'rgba(24,154,133,0.35)' : 'rgba(192,57,43,0.3)'}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        {item.excluded ? 'Include' : 'Exclude'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ))}

          <button onClick={confirmAndSend} disabled={busy || clean.length === 0}
            style={{ width: '100%', padding: 15, background: (busy || clean.length === 0) ? '#c8d2dc' : TEAL, color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: (busy || clean.length === 0) ? 'default' : 'pointer', margin: '18px 0 10px' }}>
            {busy ? 'Saving and sending…' : `Confirm — file to Dropbox & email${clean.length ? ` (${clean.length} item${clean.length === 1 ? '' : 's'})` : ''}`}
          </button>
          {/* Testing the scanner should not mean emailing a distributor. This
              sends the identical message and attachment to whoever is signed in,
              and to nobody else — the address comes from the session, so there is
              no way to type one in. */}
          <button onClick={() => confirmAndSend({ testOnly: true })} disabled={busy || clean.length === 0}
            style={{ width: '100%', padding: 13, background: 'transparent', border: `1px solid ${TEAL}`, borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: TEAL, cursor: (busy || clean.length === 0) ? 'default' : 'pointer', marginBottom: 10 }}>
            {busy ? 'Sending…' : `Send a test to me only (${user?.email || 'your address'})`}
          </button>
          <button onClick={() => setStep('capture')} disabled={busy} style={{ width: '100%', padding: 12, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 13, color: MUTED, cursor: 'pointer' }}>
            Back to pages
          </button>
        </div>
      </div>
    )
  }

  // ── Done ─────────────────────────────────────────────────
  if (step === 'done' && result) {
    const failed = result.emails.filter(e => !e.ok)
    return (
      <div style={{ minHeight: '100vh', background: '#f0f3f7', fontFamily: '-apple-system,sans-serif' }}>
        <Header
          title={result.test ? 'Test sent to you only' : (failed.length ? 'Filed, with email issues' : 'Usage filed and sent')}
          subtitle={result.record.folderName} />
        <div style={{ padding: 16 }}>
          {result.test && (
            <Banner tone="warn">
              Test only. Everything went to {result.sentTo} and nothing to any distributor —
              and the case is not recorded as sent, so the real send is still there to do.
            </Banner>
          )}
          {error && <Banner tone="error">{error}</Banner>}
          {result.emailError && <Banner tone="error">{result.emailError}</Banner>}
          {result.heldBackCount > 0 && (
            <Banner tone="warn">{result.heldBackCount} unresolved item{result.heldBackCount === 1 ? ' was' : 's were'} saved to the sheet but not emailed.</Banner>
          )}

          <div style={{ background: 'white', borderRadius: 12, padding: 15, marginBottom: 12, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
              {result.dropboxSkipped ? 'Dropbox filing' : 'Saved to Dropbox'}
            </div>
            {result.dropboxSkipped ? (
              <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
                Dropbox isn't connected, so no files were filed. The case is recorded and each
                distributor still received their sheet by email.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: NAVY, wordBreak: 'break-all', marginBottom: 8 }}>{result.dropboxPath}</div>
                {result.filesSaved.map(f => (
                  <div key={f} style={{ fontSize: 12, color: TEAL, marginTop: 3 }}>✓ {f}</div>
                ))}
              </>
            )}
          </div>

          {/* Whether the booking was marked. Said either way: silently not
              recording attendance looks identical to recording it. */}
          {result.attendance && (
            <div style={{ background: 'white', borderRadius: 12, padding: 15, marginBottom: 12, border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Calendar</div>
              {result.attendance.updated ? (
                <div style={{ fontSize: 12.5, color: NAVY, lineHeight: 1.5 }}>
                  ✓ Booking now reads <strong>{result.attendance.title}</strong>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
                  Attendance not recorded — {result.attendance.reason}. The usage is filed
                  regardless; add your name to the booking by hand if it matters.
                </div>
              )}
            </div>
          )}

          <div style={{ background: 'white', borderRadius: 12, padding: 15, marginBottom: 12, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
              {result.test ? 'Test emails — to you only' : 'Distributor emails'}
            </div>
            {result.emails.some(e => e.from) && (
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>
                Sent from {result.emails.find(e => e.from)?.from}
                {result.scanAttached
                  ? ' · usage sheet and scanned form attached'
                  : ' · usage sheet only'}
              </div>
            )}
            {!result.scanAttached && result.scanError && (
              <div style={{ fontSize: 11, color: '#856404', marginBottom: 8, lineHeight: 1.5 }}>
                The scanned form was not attached — {result.scanError}.
              </div>
            )}
            {result.emails.length === 0 && <div style={{ fontSize: 13, color: MUTED }}>No emails were sent.</div>}
            {result.emails.map(e => (
              <div key={e.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(26,43,74,0.06)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{e.name}</div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                    {e.itemCount} item{e.itemCount === 1 ? '' : 's'}
                    {e.ok ? (e.test ? ` · to you` : ` · ${e.to.length} recipient${e.to.length === 1 ? '' : 's'}`) : ''}
                  </div>
                  {!e.ok && <div style={{ fontSize: 11, color: '#c0392b', marginTop: 3 }}>{e.error}</div>}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: e.ok ? TEAL : '#c0392b', whiteSpace: 'nowrap' }}>
                  {e.ok ? (e.test ? '✓ Test sent' : '✓ Sent') : '✕ Failed'}
                </span>
              </div>
            ))}
          </div>

          {failed.length > 0 && (
            <button onClick={resendFailed} disabled={busy}
              style={{ width: '100%', padding: 14, background: BLUE, color: 'white', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}>
              {busy ? 'Resending…' : `Retry ${failed.length} failed email${failed.length === 1 ? '' : 's'}`}
            </button>
          )}
          <button onClick={startNew} style={{ width: '100%', padding: 14, background: TEAL, color: 'white', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}>
            New usage scan
          </button>
          <button onClick={() => { setStep('history'); loadHistory() }} style={{ width: '100%', padding: 12, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 13, color: MUTED, cursor: 'pointer' }}>
            Back to usage history
          </button>
        </div>
      </div>
    )
  }

  return null
}
