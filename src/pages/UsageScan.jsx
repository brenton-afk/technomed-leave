import React, { useState, useEffect, useRef, useCallback } from 'react'
import { reorder } from './scan/pageList.js'
import RegistrarText from './scan/RegistrarText.jsx'
import AmendUsage from './scan/AmendUsage.jsx'
import BoostForm from './scan/BoostForm.jsx'
import CaseFiles from './scan/CaseFiles.jsx'
import CameraSheet from './scan/CameraSheet.jsx'
import ScanPages, { NewScanButton } from './scan/ScanPages.jsx'
import { releaseCamera } from '../scanner/cameraStream.js'
import { partitionItems } from '../usageReview.js'
import { useIsDesktop } from '../design/viewport.js'
import { Header as ShellHeader } from '../design/Shell.jsx'
import { itemGaps, suggestedCode } from '../usageItemCheck.js'
import { SURGEON_KEYS, normaliseSurgeon } from '../clinicalPlan/parse.js'
import { colour } from '../design/tokens.js'

// Every surgeon the portal knows, the same list the bookings are read with
// (Brent, 9 Nov 2026: "the portal … should be able to tell that Thani is a
// surgeon because he's known to the portal").
const SURGEON_KNOWN = name => Boolean(normaliseSurgeon(String(name || '')))

// Claude downsamples anything larger, and Vercel caps a function request body
// at 4.5MB — a 3-page form at this size lands comfortably inside both.
const MAX_IMAGE_DIM = 1568
const JPEG_QUALITY = 0.85
// The filed copy: see CameraSheet's FILE_IMAGE_DIM. Kept in step with it.
const FILE_IMAGE_DIM = 2400
const FILE_JPEG_QUALITY = 0.92
const MAX_PAYLOAD_BYTES = 4_000_000

const NAVY = '#042746'
const TEAL = '#189a85'
const BLUE = '#2899d4'
const AMBER = '#fff3cd'
const AMBER_TEXT = '#856404'
// A resolved row keeps its place in the review list and turns this colour, so
// ticking one off changes something you can see.
const DONE = '#e8f6f3'
const DONE_LINE = 'rgba(24,154,133,0.32)'
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

export async function fileToPage(file) {
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
  const drawn = maxDimension => {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap.source || bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  }
  const dataUrl = drawn(MAX_IMAGE_DIM).toDataURL('image/jpeg', JPEG_QUALITY)
  // The copy that is filed and sent to the distributor, as sharp as the photo
  // allows: a photo from the phone's own camera is 12 megapixels, and this
  // shrank it to the 1568-pixel reading size like everything else, which is
  // about 130 dpi on an A4 form — too soft for a sticker's lot number.
  const full = Math.max(bitmap.width, bitmap.height) > MAX_IMAGE_DIM
    ? drawn(FILE_IMAGE_DIM).toDataURL('image/jpeg', FILE_JPEG_QUALITY).split(',')[1]
    : null
  if (typeof bitmap.close === 'function') bitmap.close()

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mediaType: 'image/jpeg',
    data: dataUrl.split(',')[1],
    full,
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

export function payloadBytes(pages) {
  // base64 inflates by ~4/3.
  return pages.reduce((sum, p) => sum + Math.ceil(p.data.length * 0.75), 0)
}

// ─── The sharper copy, where it fits ──────────────────────────────────────────
// Filing and the distributor's PDF get the 2400-pixel page the scanner keeps
// (see CameraSheet, FILE_IMAGE_DIM); reading gets the 1568 one. Vercel refuses
// a request over 4.5MB, so the sharper copies are used page by page only while
// the whole request stays comfortably under it — a long form falls back to the
// reading copy for its later pages rather than failing to file at all.
const FILING_BUDGET = 3_400_000

export function filingPages(pages) {
  let used = 0
  return pages.map(p => {
    const sharp = p.full && used + p.full.length <= FILING_BUDGET
    const data = sharp ? p.full : p.data
    used += data.length
    return { mediaType: p.mediaType, data }
  })
}

function newPageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// A drawn canvas → the same page shape produced by fileToPage.
/** A page from an already-flattened preview, as the scanner hands it over. */
export function pageFromPreview(page, index) {
  return {
    id: newPageId(),
    mediaType: 'image/jpeg',
    data: page.preview.split(',')[1],
    // The sharper copy for filing and the distributor; see filingPages.
    full: page.full ? page.full.split(',')[1] : null,
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
  // The app's own header, so Usage and Resupply read as one Scan tab (Brent,
  // 6 Nov 2026: "keep it consistent"). It carries the safe-area inset itself.
  return <ShellHeader title={title} subtitle={subtitle}>{children}</ShellHeader>
}

const inputStyle = {
  width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8,
  // 16, not 14: below 16px iOS zooms the page on focus and does not zoom back.
  fontSize: 16, background: 'white', color: NAVY, outline: 'none', boxSizing: 'border-box',
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
    ok: { bg: "#e6f4f2", fg: TEAL },
    success: { bg: "#e6f4f2", fg: TEAL }
  }
  const t = tones[tone] || tones.ok
  return (
    <div style={{ background: t.bg, color: t.fg, padding: '11px 14px', borderRadius: 10, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────


// ─── The first screen of a scan ──────────────────────────────────────────────
// Drawn by scan/ScanPages.jsx, shared with the Resupply scanner so the two
// look and work the same (Brent, 6 Nov 2026: "keep it consistent").

/**
 * This case is already filed (api/_usageDuplicate.js). Nothing has been filed
 * or sent; this says what was, and offers the right next step — which is
 * almost never filing it again.
 */
export function AlreadyFiled({ duplicate, busy, onDiscard, onAmend, onSeparate }) {
  const { kind, earlier, added } = duplicate
  const when = earlier.at
    ? new Date(earlier.at).toLocaleString('en-AU', { timeZone: 'Australia/Hobart', weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : ''
  const button = { width: '100%', padding: 13, borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', marginTop: 8 }
  return (
    <div data-already-filed style={{ background: AMBER, border: `1px solid ${AMBER_TEXT}`, borderRadius: 12, padding: 14, marginTop: 18, color: AMBER_TEXT }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
        {kind === 'folder' ? 'A case is already filed for this patient today' : 'This usage is already filed'}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ wordBreak: 'break-all' }}>{earlier.folderName}</strong>
        {earlier.by || when ? ` — filed${earlier.by ? ` by ${earlier.by}` : ''}${when ? ` ${when}` : ''}` : ''}
        {earlier.sentTo?.length ? `, sent to ${earlier.sentTo.join(', ')}` : ''}.
        {' '}Nothing from this scan has been filed or sent.
      </div>
      {kind === 'identical' && (
        <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>
          This scan has nothing on it that case does not already have — the same items, lots and graft numbers.
        </div>
      )}
      {kind === 'adds' && (
        <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 6 }}>
          It has {added.length} item{added.length === 1 ? '' : 's'} that case does not:{' '}
          {added.map(i => `${i.quantity} × ${i.productName || i.referenceCode}${i.lotNumber ? ` (${i.lotNumber})` : ''}`).join('; ')}.
          Add {added.length === 1 ? 'it' : 'them'} to the earlier case with Amend — the distributor gets a correction, not a second usage.
        </div>
      )}
      {kind === 'adds' && (
        <button type="button" onClick={onAmend} disabled={busy}
          style={{ ...button, background: AMBER_TEXT, color: 'white', border: 'none' }}>
          Amend the earlier case
        </button>
      )}
      <button type="button" onClick={onDiscard} disabled={busy}
        style={{ ...button, background: kind === 'adds' ? 'white' : AMBER_TEXT, color: kind === 'adds' ? AMBER_TEXT : 'white', border: kind === 'adds' ? `1px solid ${AMBER_TEXT}` : 'none' }}>
        Discard this scan
      </button>
      <button type="button" onClick={onSeparate} disabled={busy}
        style={{ ...button, background: 'transparent', color: AMBER_TEXT, border: 'none', fontWeight: 600, fontSize: 13 }}>
        It is a different operation — file it as a separate case
      </button>
    </div>
  )
}

export default function UsageScan({ user, switcher }) {
  // Usage forms are scanned on a phone, held over the paper on a theatre bench.
  // Nobody has ever scanned one with a laptop and nobody is going to — there is
  // no camera pointed at the right thing and no hand free to hold it.
  //
  // So a desktop gets the other half of this screen: what has already been
  // scanned, which is the part somebody at a desk actually wants. The capture
  // path is not hidden behind a warning, it is simply not offered.
  const desktop = useIsDesktop()

  // On a phone, opens on capture: tapping Scan means "scan something now", and
  // making that three taps was the wrong default.
  const [step, setStep] = useState(desktop ? 'history' : 'capture')
  const [pages, setPages] = useState([])
  // Mirrors `pages` so a capture can check the payload size and answer straight
  // away, without reading state that has not been committed yet.
  const pagesRef = useRef([])
  const [caseRecord, setCaseRecord] = useState(null)
  // Set when the save found this case already filed (see confirmAndSend).
  const [duplicate, setDuplicate] = useState(null)
  // Which past usage is open for a correction (scan/AmendUsage.jsx).
  const [amending, setAmending] = useState(null)
  // Which past usage has its Boost tracking form being scanned (scan/BoostForm.jsx).
  const [boostFor, setBoostFor] = useState(null)
  // Which past usage is open to show its filed files (scan/CaseFiles.jsx).
  const [filesFor, setFilesFor] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [showCamera, setShowCamera] = useState(false)
  // Set when the scanner asks to go straight to reading. The page it just
  // captured arrives through setState, so the read has to wait a render for it
  // to actually be in `pages` — reading here and now would read the page before
  // this one, or none at all.
  const [readWhenReady, setReadWhenReady] = useState(false)

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

  /**
   * Moves a page one place earlier or later.
   *
   * Page order is not presentation. The pages go to Claude in this order and
   * get merged into one PDF in this order, and a usage form reads as a
   * sequence — the patient label and the date are on page one, the overflow
   * stickers on page two. Scanning them out of order and having no way to say
   * so meant re-scanning the lot.
   *
   * Arrows rather than drag. This is used standing up, one-handed, often in
   * gloves; a drag target that has to be grabbed and held is the wrong shape
   * for that, and two taps is not slower than one careful drag.
   */
  function movePage(id, by) {
    const next = reorder(pages, id, by)
    if (next === pages) return
    pagesRef.current = next
    setPages(next)
  }

  // The stream is held open across pages on purpose — see cameraStream.js — so
  // something has to close it when the scanner is actually finished with.
  useEffect(() => () => releaseCamera(), [])

  function startNew() {
    pagesRef.current = []
    setPages([]); setCaseRecord(null); setResult(null); setDuplicate(null)
    setError(''); setNotice(''); setStep('capture'); setShowCamera(true)
  }

  useEffect(() => {
    if (!readWhenReady || !pages.length || busy) return
    setReadWhenReady(false)
    processScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readWhenReady, pages.length, busy])

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

      // "I scanned a page the other day and it scanned well then it froze with
      // no buttons to proceed/cancel."
      //
      // This is how. The review screen draws only when there is a case to
      // review — `step === 'review' && caseRecord` — and this moved to that
      // step on any answer that merely lacked an error. A reply with no case
      // in it left the app on a screen that renders nothing: no heading, no
      // buttons, no way back, with the scan still in hand.
      //
      // A reply without a case is a failed read, whatever the status code said.
      if (!data.case) {
        throw new Error('The scan came back empty. Try the photograph again — '
          + 'more light, and the whole sheet in frame.')
      }

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

  // Resolving used to clear the flag and the reasons, which moved the row out of
  // "Needs review" and into "Extracted items" further down the page. The next
  // flagged row then slid up into the space it had just left — so the screen
  // barely changed, and it read as the tap not having registered and the same
  // item still being in front of you.
  //
  // The row stays exactly where it is now and turns green. `resolved` is what
  // keeps it in the section; `manualReview` still comes off, because that is what
  // decides whether the item may be emailed. The reasons are kept so it is still
  // possible to see what had been wrong with it.
  function resolveItem(id) {
    setCaseRecord(c => ({
      ...c,
      items: c.items.map(it => it.id === id ? { ...it, manualReview: false, resolved: true } : it)
    }))
  }

  /** Puts a row back into review, for a tap that landed on the wrong card. */
  function unresolveItem(id) {
    setCaseRecord(c => ({
      ...c,
      items: c.items.map(it => it.id === id ? { ...it, manualReview: true, resolved: false } : it)
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
  async function confirmAndSend({ testOnly = false, separate = false } = {}) {
    setBusy(true); setError(''); setNotice('')
    try {
      const saveRes = await fetch('/api/usage/agent?action=save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          case: caseRecord,
          pages: filingPages(pages),
          // Only from "It's a different operation" on the already-filed panel.
          confirmSeparate: separate,
          // A surgeon the portal does not know, confirmed as new on review.
          newSurgeonConfirmed: Boolean(caseRecord.newSurgeonConfirmed)
        })
      })
      const saved = await saveRes.json()
      // Already filed (api/_usageDuplicate.js): nothing was filed or sent.
      // The panel on this screen says what was, and what to do instead.
      if (saved.error === 'duplicate' && saved.duplicate) {
        setDuplicate(saved.duplicate)
        setBusy(false)
        return
      }
      if (saved.error) throw new Error(saved.error)
      // This scan is now that case. Any later save of it — the real send after
      // a test, a second tap — updates the case rather than making another.
      setCaseRecord(c => ({ ...c, id: saved.record.id, createdAt: saved.record.createdAt }))
      setDuplicate(null)

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
          pages: filingPages(pages)
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

  // Takes a case scanned twice off the record (kept, marked removed — see
  // handleRemoveDuplicate). Never touches Dropbox or what was emailed.
  async function removeDuplicate(h) {
    const sure = window.confirm(`Remove ${h.folderName} as a duplicate?\n\n`
      + 'It comes off the usage history and resupply matching. Its Dropbox folder and any emails already sent are not changed.')
    if (!sure) return
    try {
      const res = await fetch('/api/usage/agent?action=remove-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ usageId: h.id, reason: 'duplicate scan' })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setNotice(`${h.folderName} removed as a duplicate.`)
      loadHistory()
    } catch (err) {
      setError('Could not remove it: ' + err.message)
    }
  }

  async function resendFailed({ held = false } = {}) {
    const failedKeys = (result?.emails || []).filter(e => !e.ok && Boolean(e.held) === held).map(e => e.key)
    if (!failedKeys.length) return
    setBusy(true)
    try {
      const res = await fetch('/api/usage/agent?action=email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          usageId: result.record.id,
          only: failedKeys,
          // Only from the "Send anyway" button: the rep has seen that this
          // distributor already had this patient's usage today.
          confirmRepeat: held,
          // Still in memory unless the app has been reloaded, in which case the
          // retry sends the sheet without the scan and says so.
          pages: filingPages(pages)
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
      <div style={{ minHeight: '100%', background: colour.canvas, fontFamily: '-apple-system,sans-serif' }}>
        <Header
          title={desktop ? 'Filed usage' : 'Usage Scanning'}
          subtitle={desktop
            ? 'Every usage form the team has scanned and sent'
            : `${user?.name?.split(' ')[0] || 'Rep'} · scan a usage form to file and send it`}>
          {switcher}
        </Header>
        <div style={{ padding: 16 }}>
          {error && <Banner tone="danger">{error}</Banner>}
          {notice && <Banner tone="success">{notice}</Banner>}
          {!desktop && (
            <NewScanButton label="New usage scan" onClick={startNew} />
          )}
          {/* Said once, plainly, rather than offering a button that cannot
              work. A laptop has no camera pointed at a usage form. */}
          {desktop && (
            <div style={{
              background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12,
              padding: '13px 15px', marginBottom: 16, fontSize: 13, color: MUTED,
              lineHeight: 1.5
            }}>
              Scanning happens on a phone. This is everything that has been
              filed, so you can check it from a desk.
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Recent scans</div>
          {historyLoading && <div style={{ textAlign: 'center', padding: 30, color: MUTED, fontSize: 14 }}>Loading…</div>}
          {!historyLoading && history.length === 0 && (
            <div style={{ background: 'white', borderRadius: 12, padding: 32, textAlign: 'center', color: MUTED, fontSize: 14 }}>
              No usage scans yet.
            </div>
          )}
          {history.map(h => {
            const failed = (h.emailsSent || []).filter(e => !e.ok && !e.held && !e.notice).length
            const heldBack = (h.emailsSent || []).filter(e => e.held && !e.notice).length
            const sent = (h.emailsSent || []).filter(e => e.ok).length
            if (amending === h.id) {
              return <AmendUsage key={h.id} usageId={h.id} user={user}
                onClose={() => setAmending(null)} onDone={loadHistory} />
            }
            if (boostFor === h.id) {
              return <BoostForm key={h.id} usageId={h.id} user={user} toPage={fileToPage}
                sentAt={h.boostFormSentAt} onClose={() => setBoostFor(null)} onSent={loadHistory} />
            }
            return (
              <div key={h.id} style={{ background: 'white', borderRadius: 12, padding: '13px 15px', marginBottom: 10, border: `1px solid ${BORDER}` }}>
                {/* Tap the usage to see its files (Brent, 9 Nov 2026). */}
                <button type="button" data-open-usage={h.id} onClick={() => setFilesFor(v => (v === h.id ? null : h.id))}
                  aria-expanded={filesFor === h.id}
                  style={{ display: 'block', width: '100%', padding: 0, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, wordBreak: 'break-all' }}>{h.folderName}</div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                    {h.itemCount} item{h.itemCount === 1 ? '' : 's'} · {h.repName || '—'}
                    <span style={{ color: TEAL, fontWeight: 600 }}>{filesFor === h.id ? ' · Hide files' : ' · Files'}</span>
                  </div>
                </button>
                {filesFor === h.id && <CaseFiles usage={h} user={user} />}
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: '#e6f4f2', color: TEAL }}>
                    {h.filesSaved?.length || 0} file{(h.filesSaved?.length || 0) === 1 ? '' : 's'} in Dropbox
                  </span>
                  {sent > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: '#eaf4fc', color: BLUE }}>{sent} emailed</span>}
                  {failed > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: '#fdecea', color: '#c0392b' }}>{failed} failed</span>}
                  {heldBack > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: AMBER, color: AMBER_TEXT }}>{heldBack} held — already sent</span>}
                  {h.amendments > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: '#fff3cd', color: '#856404' }}>Amended{h.amendments > 1 ? ` ×${h.amendments}` : ''}</span>}
                  {/* Something missed after it had gone — Aimee's cross link. */}
                  {(user?.isAdmin || (h.createdByEmail && h.createdByEmail === user?.email)) && (
                    <button type="button" onClick={() => removeDuplicate(h)}
                      style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', minHeight: 32, borderRadius: 20, cursor: 'pointer', border: `1px solid ${BORDER}`, background: 'white', color: '#c0392b' }}>
                      Remove duplicate
                    </button>
                  )}
                  {h.hasBoost && (
                    <button type="button" onClick={() => setBoostFor(h.id)} data-boost-form-open
                      style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', minHeight: 32, borderRadius: 20, cursor: 'pointer', border: `1px solid ${BORDER}`, background: 'white', color: NAVY }}>
                      {h.boostFormSentAt ? 'Boost form ✓' : 'Boost form'}
                    </button>
                  )}
                  <button type="button" onClick={() => setAmending(h.id)}
                    style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '4px 12px', minHeight: 32, borderRadius: 20, cursor: 'pointer', border: `1px solid ${BORDER}`, background: 'white', color: NAVY }}>
                    Amend
                  </button>
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
      <div style={{ minHeight: '100%', background: colour.canvas, fontFamily: '-apple-system,sans-serif' }}>
        <Header title="Add pages" subtitle="Photograph or upload every page of the usage form">
          {/* Only before the first page: switching kind mid-scan would drop it. */}
          {pages.length === 0 && switcher}
        </Header>
        <div style={{ padding: 16 }}>
          {error && <Banner tone="danger">{error}</Banner>}

          <input ref={uploadRef} type="file" accept="image/*,application/pdf" multiple style={{ fontSize: 16, display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />

          <ScanPages pages={pages} busy={busy}
            scanLabel="Scan the usage form"
            onScan={() => setShowCamera(true)}
            onUpload={() => uploadRef.current?.click()}
            onRemove={removePage}
            onMove={movePage}
            onRead={processScan} />
          <button onClick={() => setStep('history')}
            style={{
              width: '100%', minHeight: 44, background: 'transparent', border: 'none',
              fontSize: 13.5, color: MUTED, fontWeight: 600, cursor: 'pointer'
            }}>
            Past scans
          </button>
        </div>

        {showCamera && (
          <CameraSheet
            pageCount={pages.length}
            onCapture={page => addPages([pageFromPreview(page, pages.length + 1)])}
            onDone={() => setShowCamera(false)}
            // Straight from the scanner's review into reading, rather than back
            // to a screen with a button that says the same thing.
            onRead={() => { setShowCamera(false); setReadWhenReady(true) }}
            onCancel={() => setShowCamera(false)}
            onFallback={() => { setShowCamera(false); uploadRef.current?.click() }}
          />
        )}
      </div>
    )
  }

  // ── Processing ───────────────────────────────────────────
  if (step === 'processing') {
    return (
      <div style={{ minHeight: '100%', background: NAVY, fontFamily: '-apple-system,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
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
    const { inReview, outstanding, clean, excluded, sendable } = partitionItems(caseRecord.items)

    return (
      <div style={{ minHeight: '100%', background: colour.canvas, fontFamily: '-apple-system,sans-serif' }}>
        <Header title="Review extracted usage" subtitle="Check every field before filing and sending" />
        <div style={{ padding: 16 }}>
          {error && <Banner tone="danger">{error}</Banner>}
          {notice && <Banner tone="warning">{notice}</Banner>}
          {/* A count that goes down. Previously this said how many items needed
              review and never changed as they were dealt with, so there was
              nothing on the page that answered "how many are left?". */}
          {inReview.length > 0 && (
            <Banner tone={outstanding.length === 0 ? 'info' : 'warning'}>
              {outstanding.length === 0 ? (
                <><strong>All {inReview.length} flagged item{inReview.length === 1 ? '' : 's'} resolved.</strong> Nothing is being held back.</>
              ) : (
                <>
                  <strong>{outstanding.length} of {inReview.length} still need{outstanding.length === 1 ? 's' : ''} review.</strong> Flagged rows are not emailed until you resolve them.
                  <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                    {inReview.map(it => (
                      <div key={it.id} title={it.manualReview ? 'Still to review' : 'Resolved'}
                        style={{ flex: 1, height: 5, borderRadius: 3, background: it.manualReview ? 'rgba(133,100,4,0.25)' : TEAL }} />
                    ))}
                  </div>
                </>
              )}
            </Banner>
          )}

          <div style={{ background: 'white', borderRadius: 12, padding: 14, marginBottom: 14, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Folder & subject</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: BLUE, wordBreak: 'break-all', marginBottom: 14 }}>{folderPreview(caseRecord)}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Patient surname" value={caseRecord.patientSurname} onChange={v => updateCase('patientSurname', v)} />
              <Field label="Surgery date" type="date" value={caseRecord.date} onChange={v => updateCase('date', v)} />
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
              <Field label="Surgeon surname" value={caseRecord.surgeonSurname} onChange={v => updateCase('surgeonSurname', v)} />
              {caseRecord.surgeonSurname && !SURGEON_KNOWN(caseRecord.surgeonSurname) && (
                <div data-surgeon-unknown style={{ fontSize: 12, color: AMBER_TEXT, lineHeight: 1.5, margin: '-4px 0 10px' }}>
                  "{caseRecord.surgeonSurname}" is not one of our surgeons. Pick the surgeon:
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
                    {SURGEON_KEYS.map(k => (
                      <button key={k} type="button" onClick={() => updateCase('surgeonSurname', k === 'JPW' ? 'Peters-Willke' : k)}
                        style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', minHeight: 32, borderRadius: 16, cursor: 'pointer', border: `1px solid ${BORDER}`, background: 'white', color: NAVY }}>
                        {k}
                      </button>
                    ))}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: NAVY }}>
                    <input type="checkbox" checked={Boolean(caseRecord.newSurgeonConfirmed)} onChange={e => updateCase('newSurgeonConfirmed', e.target.checked)}
                      style={{ width: 18, height: 18, fontSize: 16 }} />
                    No — this is a new surgeon, make them a folder
                  </label>
                </div>
              )}
              {caseRecord.namesSwapped && (
                <div data-names-swapped style={{ fontSize: 12, color: AMBER_TEXT, lineHeight: 1.5, margin: '-4px 0 10px' }}>
                  The form was read with the patient and surgeon the wrong way round — they have been swapped back. Check both.
                </div>
              )}
              <Field label="Procedure" value={caseRecord.procedure} onChange={v => updateCase('procedure', v)} />
              <Field label="Hospital" value={caseRecord.hospital} onChange={v => updateCase('hospital', v)}
                options={[{ key: '', label: 'Select…' }, { key: 'CLV', label: 'CLV — Calvary' }, { key: 'RHH', label: 'Royal Hobart' }]} />
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Rep: <strong style={{ color: NAVY }}>{caseRecord.repName}</strong>
              {caseRecord.repNameOnForm && caseRecord.repNameOnForm !== caseRecord.repName && ` · form reads "${caseRecord.repNameOnForm}"`}
            </div>
          </div>

          {[
            [outstanding.length ? `Needs review — ${outstanding.length} left` : 'Reviewed', inReview, true],
            ['Extracted items', clean, false],
            ['Excluded', excluded, false]
          ].map(([title, list, isFlagged]) => (
            list.length === 0 ? null : (
              <div key={title}>
                <div style={{ fontSize: 11, fontWeight: 700, color: isFlagged ? AMBER_TEXT : MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '16px 0 10px' }}>
                  {title} ({list.length})
                </div>
                {list.map((item, n) => {
                  // Three states, not two: still flagged, resolved, or an
                  // ordinary row. The middle one is the whole point — the tap has
                  // to leave something on screen.
                  const needsWork = isFlagged && item.manualReview
                  const done = isFlagged && item.resolved
                  return (
                  <div key={item.id} style={{ background: needsWork ? AMBER : done ? DONE : 'white', borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${needsWork ? 'rgba(133,100,4,0.25)' : done ? DONE_LINE : BORDER}`, opacity: item.excluded ? 0.6 : 1 }}>
                    {isFlagged && (
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: done ? TEAL : AMBER_TEXT }}>
                          {done ? '✓ Resolved' : item.reviewReasons?.length > 0 ? `⚠ ${item.reviewReasons.join(' · ')}` : '⚠ Needs review'}
                        </div>
                        {/* Which of them this is, so a page of near-identical
                            amber cards is countable. */}
                        <div style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{n + 1} of {list.length}</div>
                      </div>
                    )}
                    {needsWork && itemGaps(item).length > 0 && (
                      <div data-item-gaps style={{ fontSize: 12, color: AMBER_TEXT, marginBottom: 8 }}>
                        Still missing: {itemGaps(item).join(' · ')} — the distributor resupplies by code and size.
                        {suggestedCode(item) && (
                          <button type="button" data-use-code onClick={() => updateItem(item.id, 'referenceCode', suggestedCode(item))}
                            style={{ marginLeft: 6, padding: '3px 8px', borderRadius: 6, border: `1px solid ${TEAL}`, background: 'white', color: TEAL, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                            Use {suggestedCode(item)}
                          </button>
                        )}
                      </div>
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
                      {needsWork && (() => {
                        // A rod or screw with no size cannot be resolved; a line
                        // with no code can, but only by saying so (Brent, 9 Nov 2026).
                        const gaps = itemGaps(item)
                        const blocked = !item.distributorKey || !item.productName || gaps.some(g => g !== 'no product code')
                        return (
                          <button onClick={() => resolveItem(item.id)} disabled={blocked} data-resolve-item
                            style={{ flex: 1, padding: 10, background: blocked ? '#d9cfae' : TEAL, color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: blocked ? 'default' : 'pointer' }}>
                            {gaps.includes('no product code') ? '✓ Resolve without a code' : '✓ Mark resolved'}
                          </button>
                        )
                      })()}
                      {done && (
                        <button onClick={() => unresolveItem(item.id)}
                          style={{ flex: 1, padding: 10, background: 'transparent', color: TEAL, border: `1px solid ${DONE_LINE}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                          Undo resolve
                        </button>
                      )}
                      <button onClick={() => toggleExcluded(item.id)}
                        style={{ flex: 1, padding: 10, background: 'transparent', color: item.excluded ? TEAL : '#c0392b', border: `1px solid ${item.excluded ? 'rgba(24,154,133,0.35)' : 'rgba(192,57,43,0.3)'}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        {item.excluded ? 'Include' : 'Exclude'}
                      </button>
                    </div>
                  </div>
                  )
                })}
              </div>
            )
          ))}

          {duplicate && (
            <AlreadyFiled duplicate={duplicate} busy={busy}
              onDiscard={() => { startNew(); setShowCamera(false); setStep(desktop ? 'history' : 'capture') }}
              onAmend={() => { setAmending(duplicate.earlier.id); setDuplicate(null); setStep('history'); loadHistory() }}
              onSeparate={() => confirmAndSend({ separate: true })} />
          )}
          <button onClick={() => confirmAndSend()} disabled={busy || sendable.length === 0 || Boolean(duplicate)}
            style={{ width: '100%', padding: 15, background: (busy || sendable.length === 0) ? '#c8d2dc' : TEAL, color: 'white', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: (busy || sendable.length === 0) ? 'default' : 'pointer', margin: '18px 0 10px' }}>
            {busy ? 'Saving and sending…' : `Confirm — file to Dropbox & email${sendable.length ? ` (${sendable.length} item${sendable.length === 1 ? '' : 's'})` : ''}`}
          </button>
          {/* Testing the scanner should not mean emailing a distributor. This
              sends the identical message and attachment to whoever is signed in,
              and to nobody else — the address comes from the session, so there is
              no way to type one in. */}
          <button onClick={() => confirmAndSend({ testOnly: true })} disabled={busy || sendable.length === 0 || Boolean(duplicate)}
            style={{ width: '100%', padding: 13, background: 'transparent', border: `1px solid ${TEAL}`, borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: TEAL, cursor: (busy || sendable.length === 0) ? 'default' : 'pointer', marginBottom: 10 }}>
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
    // A notice (no Boost tracking form in the scan) is said, not offered as a
    // send — there is nothing to send anyway.
    const failed = result.emails.filter(e => !e.ok && !e.held && !e.notice)
    const held = result.emails.filter(e => e.held && !e.notice)
    return (
      <div style={{ minHeight: '100%', background: colour.canvas, fontFamily: '-apple-system,sans-serif' }}>
        <Header
          title={result.test ? 'Test sent to you only' : (failed.length ? 'Filed, with email issues' : held.length ? 'Filed — one already sent' : 'Usage filed and sent')}
          subtitle={result.record.folderName} />
        <div style={{ padding: 16 }}>
          {result.test && (
            <Banner tone="warning">
              Test only. Everything went to {result.sentTo} and nothing to any distributor —
              and the case is not recorded as sent, so the real send is still there to do.
            </Banner>
          )}
          {error && <Banner tone="danger">{error}</Banner>}
          {result.emailError && <Banner tone="danger">{result.emailError}</Banner>}
          {result.heldBackCount > 0 && (
            <Banner tone="warning">{result.heldBackCount} unresolved item{result.heldBackCount === 1 ? ' was' : 's were'} saved to the sheet but not emailed.</Banner>
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

          {/* The text for the registrar.
              
              A draft, never a send. The app does not know which registrar was
              in the room and their number is not on the booking, so this
              writes the message and hands it to the phone's own messaging app
              — where somebody picks the person and reads it before it goes.
              
              Copy as well as the link, because a rep standing in a corridor
              may want it in WhatsApp rather than a text, and the clipboard
              reaches both. */}
          {/* A Boost case: its tracking form is scanned on its own and goes to
              the Boost team only (Brent, 9 Nov 2026). */}
          {!result.test && (result.record?.items || []).some(i => i.distributorKey === 'device_boost' && !i.excluded) && (
            <BoostForm usageId={result.record.id} user={user} toPage={fileToPage}
              sentAt={(result.emails.find(e => e.key === 'boost_tracking' && e.ok && !e.test) || {}).sentAt
                || ((result.record.emailsSent || []).find(e => e && e.key === 'boost_tracking' && e.ok && !e.test) || {}).sentAt} />
          )}
          {caseRecord && (
            <RegistrarText key={caseRecord.id || caseRecord.folderName}
              caseRecord={caseRecord} booking={result.attendance?.booking || null} />
          )}

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
                    {e.key === 'boost_tracking' ? 'Tracking form only' : `${e.itemCount} item${e.itemCount === 1 ? '' : 's'}`}
                    {e.ok ? (e.test ? ` · to you` : ` · ${e.to.length} recipient${e.to.length === 1 ? '' : 's'}`) : ''}
                  </div>
                  {!e.ok && <div style={{ fontSize: 11, color: e.held ? AMBER_TEXT : '#c0392b', marginTop: 3, lineHeight: 1.45 }}>{e.error}</div>}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: e.ok ? TEAL : '#c0392b', whiteSpace: 'nowrap' }}>
                  {e.ok ? (e.test ? '✓ Test sent' : '✓ Sent') : e.notice ? 'Not sent' : e.held ? 'Held' : '✕ Failed'}
                </span>
              </div>
            ))}
          </div>

          {held.length > 0 && (
            <button onClick={() => resendFailed({ held: true })} disabled={busy}
              style={{ width: '100%', padding: 14, background: 'white', color: AMBER_TEXT, border: `1px solid ${AMBER_TEXT}`, borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}>
              {busy ? 'Sending…' : `Send to ${held.map(e => e.name).join(', ')} anyway`}
            </button>
          )}
          {failed.length > 0 && (
            <button onClick={() => resendFailed()} disabled={busy}
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

  // ── Nothing above matched ──
  //
  // There was a bare `return null` here, which is what turned a missing case
  // into a frozen screen: every guarded branch declined to draw and the
  // component rendered nothing at all. The specific cause is fixed above, but
  // a screen that *can* render nothing is one unforeseen state away from doing
  // it again — and this one is held in a theatre corridor with a signed form
  // in the other hand.
  //
  // So the last word is always a way out. It keeps the pages: starting again
  // should not mean photographing the sheet a second time.
  return (
    <div style={{ padding: 20, maxWidth: 520, margin: '0 auto' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 8 }}>
        Something went wrong reading that
      </div>
      <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.5, marginBottom: 18 }}>
        {error || 'The scan did not come back. Your photographs are still here.'}
      </div>
      <button onClick={() => { setError(''); setStep(pages.length ? 'capture' : 'history') }}
        style={{
          width: '100%', padding: 14, background: TEAL, color: 'white',
          border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
          cursor: 'pointer', marginBottom: 10
        }}>
        {pages.length
          ? `Back to the ${pages.length === 1 ? 'photograph' : 'photographs'}`
          : 'Back'}
      </button>
      <button onClick={startNew}
        style={{
          width: '100%', padding: 12, background: 'transparent',
          border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 13,
          color: MUTED, cursor: 'pointer'
        }}>
        Start again
      </button>
    </div>
  )
}
