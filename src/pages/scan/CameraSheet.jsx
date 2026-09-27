import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { loadOpenCv, openCvReady } from '../../scanner/opencvLoader.js'
import { detectDocument } from '../../scanner/documentDetect.js'
import { DocumentTracker } from '../../scanner/documentTracker.js'
import { flattenCapture } from '../../scanner/flatten.js'
import { acquireCamera, cameraOpen, setTorch, hasTorch, torchOn as torchIsOn, turnTorchOff }
  from '../../scanner/cameraStream.js'

// ─── The scanner ──────────────────────────────────────────────────────────────
// Live outline, auto-capture, then a chance to correct the corners before the
// page joins the stack.
//
// Detection runs at 240x180 and on every third frame. Both numbers are lower than
// they look like they should be, and both are deliberate: a page border survives
// downscaling and a form's printed table rules do not, so the small frame is
// *more* accurate as well as four times faster. The spare time goes into
// smoothing, which is what the outline actually needed.

const TEAL = '#189a85'

/** Plain words for the failure, then the browser's own, which is the diagnostic. */
function describeCameraError(err) {
  const detail = [err?.name, err?.message].filter(Boolean).join(': ') || 'no detail given'
  // iOS blocked getUserMedia outright in home-screen apps for years and is still
  // inconsistent about it, so it is worth naming rather than leaving as a mystery.
  const standalone = typeof navigator !== 'undefined'
    && (navigator.standalone === true
      || (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches))

  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
    return standalone
      ? `Camera access was refused. Home-screen apps on iOS often cannot open the camera — try the same page in Safari. (${detail})`
      : `Camera access was blocked. Allow it for this site in your browser settings, or use the photo library instead. (${detail})`
  }
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
    return `No usable camera was found on this device. (${detail})`
  }
  if (err?.name === 'NotReadableError') {
    return `The camera is in use by something else. Close other camera apps and try again. (${detail})`
  }
  return `Could not open the camera. (${detail})`
}
const DETECT_WIDTH = 240
// Every other frame. Detection at 240x180 measures under a millisecond
// (`npm run bench:scanner`), so a third of the frames was buying very little and
// costing a third of the outline's latency — every skipped frame is one more
// frame the drawn outline is behind the page.
const FRAME_INTERVAL = 2
const MAX_IMAGE_DIM = 1568

/** The outline, drawn as SVG over the video. */
/** The bracket at one corner, turned towards the two edges that meet there. */
function bracket(c, prev, next, len = 5) {
  const toward = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y
    const d = Math.hypot(dx, dy) || 1
    // Never longer than a third of the side, or the brackets meet on a small
    // page and the whole thing reads as a plain rectangle again.
    const reach = Math.min(len, d / 3)
    return `${from.x + dx / d * reach},${from.y + dy / d * reach}`
  }
  return `M ${toward(c, prev)} L ${c.x},${c.y} L ${toward(c, next)}`
}

/**
 * The tracked outline, drawn every frame rather than every detection.
 *
 * Detection runs at perhaps ten frames a second — it is several OpenCV passes
 * over the frame — and the outline used to be redrawn only when one finished.
 * That is what made it feel laggy: the video moves at sixty, the box moved at
 * ten, and a box that lurches behind the picture reads as broken however good
 * the detection underneath it is.
 *
 * So the last detection is a *target*, and this eases towards it on every
 * animation frame, writing straight to the DOM. No React render per frame: at
 * sixty a second that costs more than the detection does.
 */
export function Outline({ view, countdown }) {
  const svgRef = useRef(null)
  const fillRef = useRef(null)
  const lineRef = useRef(null)
  const cornerRef = useRef(null)
  const shown = useRef(null)      // where the outline is drawn right now
  const target = useRef(null)     // where the last detection says it should be

  target.current = view?.corners
    ? { corners: view.corners, opacity: view.opacity ?? 1 }
    : null

  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const svg = svgRef.current
      if (!svg) return

      const to = target.current
      if (!to) {
        shown.current = null
        svg.style.opacity = '0'
        return
      }

      // Eased towards, not snapped to. The tracker has already rejected the
      // jitter; this is only about the gap between detections.
      if (!shown.current || shown.current.length !== to.corners.length) {
        shown.current = to.corners.map(c => ({ ...c }))
      } else {
        for (let i = 0; i < to.corners.length; i++) {
          shown.current[i].x += (to.corners[i].x - shown.current[i].x) * 0.35
          shown.current[i].y += (to.corners[i].y - shown.current[i].y) * 0.35
        }
      }

      const pts = shown.current.map(c => `${c.x * 100},${c.y * 100}`)
      const scaled = shown.current.map(c => ({ x: c.x * 100, y: c.y * 100 }))
      const joined = pts.join(' ')

      svg.style.opacity = String(to.opacity)
      fillRef.current?.setAttribute('points', joined)
      lineRef.current?.setAttribute('points', joined)
      cornerRef.current?.setAttribute('d', scaled
        .map((c, i) => bracket(c, scaled[(i + 3) % 4], scaled[(i + 1) % 4]))
        .join(' '))
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const firing = countdown > 0

  // Only the lock state goes through React, and only when it changes.
  useEffect(() => {
    fillRef.current?.style.setProperty('fill-opacity', firing ? '0.18' : '0.06')
    lineRef.current?.style.setProperty('stroke-width', firing ? '1.2' : '0.7')
    cornerRef.current?.style.setProperty('stroke-width', firing ? '2.2' : '1.6')
  }, [firing])

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"
      ref={svgRef}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        transition: 'opacity 180ms ease-out',
        pointerEvents: 'none'
      }}>
      <defs>
        {/* The page is lit from the front and the bench behind it is not, so the
            line has to carry its own contrast rather than borrow any. */}
        <filter id="outline-glow" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="0" stdDeviation="0.7" floodColor="#000" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* White, not teal. A coloured outline reads as a decoration laid over the
          picture; white reads as the edge of the thing itself, which is what
          every scanner worth copying does. The fill is a barely-there wash that
          lifts on lock, so the moment of recognition is visible without the
          outline changing colour and shouting about it. */}
      <polygon ref={fillRef} fill="#fff" fillOpacity={0.06}
        style={{ transition: 'fill-opacity 160ms ease-out' }} />
      <polygon ref={lineRef} fill="none" stroke="#fff"
        strokeWidth={0.7} strokeLinejoin="round" strokeLinecap="round"
        filter="url(#outline-glow)"
        style={{ transition: 'stroke-width 160ms ease-out' }} />
      {/* Corner brackets rather than dots. They say which way the page is
          oriented, and they hold their shape while the quad moves. */}
      <path ref={cornerRef} fill="none" stroke="#fff" strokeWidth={1.6}
        strokeLinecap="round" strokeLinejoin="round"
        filter="url(#outline-glow)"
        style={{ transition: 'stroke-width 160ms ease-out' }} />
    </svg>
  )
}

/** The ring that fills while auto-capture is counting down. */
function Countdown({ progress }) {
  if (progress <= 0) return null
  const circumference = 2 * Math.PI * 31
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true"
      style={{ position: 'absolute', inset: -3, pointerEvents: 'none' }}>
      {/* White, like the outline it sits inside. Anything drawn over the camera
          is part of the viewfinder; the brand colour belongs to the app's own
          chrome, and mixing the two is what made this look like a widget pasted
          on top of a video. */}
      <circle cx="38" cy="38" r="31" fill="none" stroke="#fff" strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        transform="rotate(-90 38 38)"
        style={{ transition: 'stroke-dashoffset 120ms linear' }} />
    </svg>
  )
}

/**
 * The captured page, with its corners draggable over the original photograph.
 *
 * Draggable on the *unwarped* image, because that is the only place a wrong
 * corner can be seen to be wrong. Correcting it on the flattened result would
 * mean dragging a point whose relationship to the paper is exactly what is in
 * question.
 */
export function CropReview({ capture, cv, onConfirm, onRetake, onAddAnother, onCancel, pageCount }) {
  const [corners, setCorners] = useState(
    capture.corners || [{ x: 0.06, y: 0.06 }, { x: 0.94, y: 0.06 }, { x: 0.94, y: 0.94 }, { x: 0.06, y: 0.94 }])
  const [preview, setPreview] = useState(capture.preview)
  const [dirty, setDirty] = useState(false)
  const [dragging, setDragging] = useState(null)
  const frameRef = useRef(null)

  const reflatten = useCallback(() => {
    const { canvas } = flattenCapture(cv, capture.source, corners, { maxDimension: MAX_IMAGE_DIM })
    setPreview(canvas.toDataURL('image/jpeg', 0.85))
    setDirty(false)
  }, [cv, capture.source, corners])

  const move = useCallback((event) => {
    if (dragging == null || !frameRef.current) return
    const box = frameRef.current.getBoundingClientRect()
    const touch = event.touches?.[0] || event
    const next = corners.slice()
    next[dragging] = {
      x: Math.min(1, Math.max(0, (touch.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (touch.clientY - box.top) / box.height))
    }
    setCorners(next)
    setDirty(true)
  }, [dragging, corners])

  useEffect(() => {
    if (dragging == null) return
    const stop = () => setDragging(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
  }, [dragging, move])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 3100, display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        <img src={preview} alt="The page as it will be saved"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>

      <div style={{ padding: '10px 16px', color: 'rgba(255,255,255,0.7)', fontSize: 12.5, textAlign: 'center' }}>
        Drag a corner if the edges are wrong
      </div>

      {/* The original, with the handles on it. */}
      <div ref={frameRef} style={{ position: 'relative', margin: '0 16px', borderRadius: 10, overflow: 'hidden', touchAction: 'none' }}>
        <img src={capture.original} alt="The photograph the page was taken from"
          style={{ width: '100%', display: 'block', opacity: 0.75 }} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <defs>
            <filter id="handle-glow" x="-25%" y="-25%" width="150%" height="150%">
              <feDropShadow dx="0" dy="0" stdDeviation="0.7" floodColor="#000" floodOpacity="0.55" />
            </filter>
          </defs>
          {/* White, like the viewfinder outline it follows on from. This was the
              green: the outline went white and then the screen after it did not,
              so the frame appeared to turn green at the moment of capture. The
              shadow is what keeps it visible against white paper. */}
          <polygon points={corners.map(c => `${c.x * 100},${c.y * 100}`).join(' ')}
            fill="#fff" fillOpacity={0.10} stroke="#fff" strokeWidth={0.9}
            strokeLinejoin="round" filter="url(#handle-glow)" />
        </svg>
        {corners.map((c, i) => (
          <button key={i}
            aria-label={`Corner ${i + 1}`}
            onPointerDown={() => setDragging(i)}
            style={{
              position: 'absolute',
              left: `calc(${c.x * 100}% - 14px)`,
              top: `calc(${c.y * 100}% - 14px)`,
              width: 28, height: 28, borderRadius: 14,
              background: 'rgba(255,255,255,0.95)', border: '2px solid rgba(4,39,70,0.55)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
              padding: 0, cursor: 'grab', touchAction: 'none'
            }} />
        ))}
      </div>

      {/* Reading is one tap from here, not three. It used to take "Use this
          page", then "Done", then "Read usage document" on the screen behind —
          four taps after framing the page, for the ordinary case of scanning one
          form and reading it. */}
      <div style={{ padding: '16px 16px calc(16px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dirty ? (
          <button onClick={reflatten}
            style={{ width: '100%', padding: '14px 0', background: 'white', color: '#042746', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            Redo crop
          </button>
        ) : (
          <button onClick={() => onConfirm(preview)}
            style={{ width: '100%', padding: '14px 0', background: TEAL, color: 'white', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            {pageCount > 0 ? `Read ${pageCount + 1} pages` : 'Read this page'}
          </button>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onRetake}
            style={{ flex: 1, padding: '12px 0', background: 'transparent', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 10, fontSize: 13.5, cursor: 'pointer' }}>
            Retake
          </button>
          {/* Still here, because a two-page form is normal. It is just no longer
              the thing standing between one page and reading it. */}
          <button onClick={() => onAddAnother(preview)}
            style={{ flex: 1, padding: '12px 0', background: 'transparent', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 10, fontSize: 13.5, cursor: 'pointer' }}>
            Add a page
          </button>
          {/* Out of the scanner altogether. Auto-capture fires on its own, and
              landing in a review with no way back but Retake is a trap. */}
          <button onClick={onCancel}
            style={{ flex: 1, padding: '12px 0', background: 'transparent', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10, fontSize: 13.5, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CameraSheet({ pageCount, onCapture, onDone, onRead, onCancel, onFallback }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const detectCanvasRef = useRef(null)
  const trackerRef = useRef(null)
  const viewRef = useRef(null)
  const rafRef = useRef(0)
  const cvRef = useRef(null)
  const frameCountRef = useRef(0)
  const busyRef = useRef(false)

  const [engine, setEngine] = useState(openCvReady() ? 'ready' : 'loading')
  // The video's own dimensions, so the preview can be shown whole rather than
  // cropped to whatever shape the screen happens to be.
  const [frame, setFrame] = useState(null)
  const [cameraState, setCameraState] = useState(cameraOpen() ? 'ready' : 'opening')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState(null)
  const [autoCapture, setAutoCapture] = useState(true)
  // Read from the stream rather than started at false. The stream outlives this
  // component, so a torch left on and a button initialised to "off" is how the
  // light became impossible to put out: the first tap sent torch:true again.
  const [torchLit, setTorchLit] = useState(() => torchIsOn())
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [flash, setFlash] = useState(false)
  const [pending, setPending] = useState(null)

  /**
   * Attaches the stream whenever a video element appears.
   *
   * A ref callback rather than an effect, because the element goes away and comes
   * back: reviewing a captured page replaces this whole view, and the video that
   * returns afterwards is a new element. An effect that ran once on mount left
   * that new element with no source, so every page after the first showed black.
   */
  const attachVideo = useCallback(node => {
    videoRef.current = node
    if (node && streamRef.current && node.srcObject !== streamRef.current) {
      node.srcObject = streamRef.current
      node.play().catch(() => {})
    }
  }, [])

  // ── The camera. Acquired once for the whole session, never per page. ──
  useEffect(() => {
    let cancelled = false
    acquireCamera().then(stream => {
      if (cancelled) return
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }
      setTorchAvailable(hasTorch())
      setTorchLit(torchIsOn())
      setCameraState('ready')
    }).catch(err => {
      if (cancelled) return
      setCameraState('failed')
      // The name and the message both, verbatim. A camera that will not open is
      // the one failure that cannot be diagnosed from here — it depends on the
      // phone, the browser and whether the app was opened from the home screen —
      // so whoever is holding it needs to be able to read out what it said.
      setError(describeCameraError(err))
    })
    // Deliberately no cleanup that stops the stream. It is released when the
    // scanner is left, not when this component unmounts to show a captured page.
    return () => { cancelled = true }
  }, [attempt])

  // ── The engine. ──
  useEffect(() => {
    let cancelled = false
    loadOpenCv().then(cv => {
      if (cancelled) return
      cvRef.current = cv
      setEngine('ready')
    }).catch(() => {
      if (cancelled) return
      // The outline is guidance. Losing it costs the automatic crop, not the
      // scan, so the shutter stays and the whole photograph is kept.
      setEngine('unavailable')
    })
    return () => { cancelled = true }
  }, [])

  const capture = useCallback((corners) => {
    const video = videoRef.current
    if (!video?.videoWidth || busyRef.current) return
    busyRef.current = true

    const source = document.createElement('canvas')
    source.width = video.videoWidth
    source.height = video.videoHeight
    source.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0)

    const { canvas, flattened } = flattenCapture(cvRef.current, source, corners, { maxDimension: MAX_IMAGE_DIM })
    const shrunk = document.createElement('canvas')
    const scale = Math.min(1, 900 / Math.max(source.width, source.height))
    shrunk.width = Math.round(source.width * scale)
    shrunk.height = Math.round(source.height * scale)
    shrunk.getContext('2d').drawImage(source, 0, 0, shrunk.width, shrunk.height)

    setFlash(true)
    setTimeout(() => setFlash(false), 130)
    setPending({
      source,
      corners: corners || null,
      flattened,
      preview: canvas.toDataURL('image/jpeg', 0.85),
      // Small copy for the corner editor, so dragging is not laid over a
      // full-resolution photograph.
      original: shrunk.toDataURL('image/jpeg', 0.7)
    })
  }, [])

  // ── The light goes out with the camera view. ──
  //
  // The stream is deliberately kept open across pages, so nothing else here
  // stops the torch: leaving the scanner with it on left it burning, and it is
  // not obvious afterwards where the light is coming from — the phone is out of
  // the camera by then. Backgrounding counts as leaving, because the usual way
  // this happens is putting the phone in a pocket.
  useEffect(() => {
    const off = () => { if (document.visibilityState === 'hidden') turnTorchOff() }
    document.addEventListener('visibilitychange', off)
    return () => {
      document.removeEventListener('visibilitychange', off)
      turnTorchOff()
    }
  }, [])

  // ── Detection. Every third frame, at a small size. ──
  useEffect(() => {
    if (cameraState !== 'ready' || engine !== 'ready') return
    let stop = false
    if (!trackerRef.current) trackerRef.current = new DocumentTracker()

    function tick() {
      if (stop) return
      rafRef.current = requestAnimationFrame(tick)
      if (pending) return
      if (++frameCountRef.current % FRAME_INTERVAL) return

      const video = videoRef.current
      if (!video?.videoWidth) return

      if (!detectCanvasRef.current) detectCanvasRef.current = document.createElement('canvas')
      const canvas = detectCanvasRef.current
      const height = Math.max(1, Math.round(DETECT_WIDTH * video.videoHeight / video.videoWidth))
      if (canvas.width !== DETECT_WIDTH || canvas.height !== height) {
        canvas.width = DETECT_WIDTH
        canvas.height = height
      }
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(video, 0, 0, DETECT_WIDTH, height)

      let found = null
      try {
        const { data } = context.getImageData(0, 0, DETECT_WIDTH, height)
        found = detectDocument(cvRef.current, data, DETECT_WIDTH, height)
      } catch {
        found = null
      }

      const next = trackerRef.current.update(found, performance.now())
      viewRef.current = next
      setView(next)

      if (autoCapture && next.readyToCapture && !busyRef.current) capture(next.corners)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { stop = true; cancelAnimationFrame(rafRef.current) }
  }, [cameraState, engine, autoCapture, pending, capture])

  /** Keeps the page and returns to the camera, for a form that runs to two. */
  function keepAndContinue(preview) {
    const page = { preview, flattened: pending.flattened }
    setPending(null)
    busyRef.current = false
    trackerRef.current?.reset()
    setView(null)
    onCapture(page)
  }

  /**
   * Keeps the page and goes straight to reading it.
   *
   * This used to be three more taps: keep the page, close the camera, then find
   * "Read usage document" on the screen behind. For the ordinary case — one
   * form, read it — that was four taps after the page was already framed and
   * recognised.
   */
  function accept(preview) {
    const page = { preview, flattened: pending.flattened }
    setPending(null)
    busyRef.current = false
    trackerRef.current?.reset()
    setView(null)
    onCapture(page)
    onRead?.()
  }

  async function toggleTorch() {
    const wanted = !torchIsOn()
    const worked = await setTorch(wanted)
    setTorchLit(torchIsOn())
    if (!worked) setError('This camera has no light, or the browser will not switch it.')
  }

  const hint = engine === 'unavailable'
    ? 'Edge detection unavailable — the whole photo is kept'
    : engine === 'loading'
      ? 'Ready to shoot — edge detection still loading'
      : (view?.hint || 'Point at the form')

  return (
    <Overlay>
    {/* The review sits on top rather than replacing this view, so the camera is
        never torn down and rebuilt between pages: no black flash, no second
        play(), nothing to re-attach. */}
    {pending && (
      <CropReview capture={pending} cv={cvRef.current}
        pageCount={pageCount}
        onConfirm={accept}
        onAddAnother={keepAndContinue}
        onCancel={onCancel}
        onRetake={() => { setPending(null); busyRef.current = false; trackerRef.current?.reset() }} />
    )}
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 3000, display: 'flex', flexDirection: 'column', visibility: pending ? 'hidden' : 'visible' }}>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Sized to the camera's own aspect, so the whole field of view is on
            screen. Filling the screen instead means cropping the picture, and a
            cropped preview is the same problem as a zoomed one: the form will not
            fit in it. It also lets the outline sit exactly on the video, since
            they share one box. */}
        <div style={{
          position: 'relative',
          aspectRatio: frame ? `${frame.width} / ${frame.height}` : '3 / 4',
          maxWidth: '100%', maxHeight: '100%',
          width: frame ? undefined : '100%',
          background: '#000'
        }}>
          <video ref={attachVideo} autoPlay muted playsInline
            onLoadedMetadata={e => setFrame({ width: e.target.videoWidth, height: e.target.videoHeight })}
            style={{ width: '100%', height: '100%', display: error ? 'none' : 'block', objectFit: 'contain' }} />

          {flash && <div style={{ position: 'absolute', inset: 0, background: 'white', opacity: 0.75 }} />}
          <Outline view={view} countdown={view?.countdown || 0} />
        </div>

        {cameraState === 'opening' && !error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'rgba(255,255,255,0.75)', fontSize: 13.5 }}>
            <div style={{ width: 26, height: 26, borderRadius: 13, border: '2px solid rgba(255,255,255,0.25)', borderTopColor: TEAL, animation: 'tm-spin 700ms linear infinite' }} />
            Opening camera…
            <style>{'@keyframes tm-spin{to{transform:rotate(360deg)}}'}</style>
          </div>
        )}

        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 34 }}>📷</div>
            <div style={{ color: 'white', fontSize: 14, lineHeight: 1.5 }}>{error}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button onClick={() => { setError(''); setCameraState('opening'); setAttempt(n => n + 1) }}
                style={{ padding: '11px 18px', background: 'transparent', color: 'white', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 10, fontSize: 14, cursor: 'pointer' }}>
                Try again
              </button>
              <button onClick={onFallback} style={{ padding: '11px 18px', background: 'white', color: '#042746', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Choose photos instead
              </button>
            </div>
          </div>
        )}

        {/* Never over the picture. The camera works now; the outline is a few
            seconds behind it, and saying so is better than hiding a working
            shutter behind a loading screen. */}
        {engine === 'loading' && cameraState === 'ready' && !error && (
          <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 16, background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.85)', fontSize: 11.5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 6, border: '2px solid rgba(255,255,255,0.25)', borderTopColor: TEAL, animation: 'tm-spin 700ms linear infinite' }} />
            Edge detection loading
            <style>{'@keyframes tm-spin{to{transform:rotate(360deg)}}'}</style>
          </div>
        )}

        {torchAvailable && !error && (
          <button onClick={toggleTorch} aria-label="Torch" aria-pressed={torchLit}
            style={{ position: 'absolute', top: 'calc(14px + env(safe-area-inset-top, 0px))', right: 14, width: 42, height: 42, borderRadius: 21, background: torchLit ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.3)', color: torchLit ? '#042746' : 'white', fontSize: 18, cursor: 'pointer' }}>
            {torchLit ? '🔆' : '🔅'}
          </button>
        )}
      </div>

      {!error && (
        <div style={{ padding: '12px 16px calc(20px + env(safe-area-inset-bottom, 0px))', background: 'rgba(0,0,0,0.55)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.8)' }}>{hint}</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'rgba(255,255,255,0.8)', cursor: 'pointer' }}>
              Auto-capture
              <input type="checkbox" checked={autoCapture}
                onChange={e => setAutoCapture(e.target.checked)}
                style={{ width: 34, height: 20, accentColor: TEAL, cursor: 'pointer' }} />
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1, fontSize: 11.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 }}>
              {pageCount > 0 ? `${pageCount} page${pageCount === 1 ? '' : 's'} captured` : 'Any surface, any angle'}
            </div>

            {/* Always present, whatever auto-capture is doing. */}
            <div style={{ position: 'relative', width: 70, height: 70, flexShrink: 0 }}>
              <Countdown progress={autoCapture ? (view?.countdown || 0) : 0} />
              <button onClick={() => capture(viewRef.current?.corners)}
                disabled={cameraState !== 'ready'} aria-label="Capture page"
                style={{ width: 70, height: 70, borderRadius: 35, background: cameraState === 'ready' ? 'white' : 'rgba(255,255,255,0.35)', border: '4px solid rgba(255,255,255,0.35)', cursor: cameraState === 'ready' ? 'pointer' : 'default' }} />
            </div>

            {pageCount > 0 ? (
              <button onClick={onDone}
                style={{ flex: 1, padding: '12px 0', background: TEAL, color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Done · {pageCount}
              </button>
            ) : (
              <button onClick={onDone}
                style={{ flex: 1, padding: '12px 0', background: 'transparent', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, fontSize: 13, cursor: 'pointer' }}>
                Past scans
              </button>
            )}
          </div>
        </div>
      )}
    </div>
    </Overlay>
  )
}
