// ─── The meeting recorder, kept above every screen (Brent, 12 Nov 2026) ──────
// "We need to be able to put the recorder on and still navigate the pages on
// the computer." The recorder used to live inside the live-meeting panel and
// stopped when the panel closed. It lives here instead, at module level, so
// it runs while anyone moves around the portal; a bar across the top of the
// app (RecordingBar) shows it and opens the panel again.
//
// Two recorders share the microphone:
//  - one restarted every STRETCH_MS, so each piece is a file the transcriber
//    can open alone — the live suggestions during the meeting;
//  - one running the whole time, whose pieces join into the one recording
//    uploaded at the end and read whole, with speakers.
// On a phone the screen is kept awake (Wake Lock), because a phone that locks
// stops recording; if the microphone does stop, `warning` says so.

export const STRETCH_MS = 40000
const FULL_SLICE_MS = 10000

const state = {
  on: false, startedAt: 0, warning: '', sending: 0, error: '',
  stream: null, stretch: null, full: null, fullParts: [], timer: null, wake: null,
  onStretch: null, queue: Promise.resolve(), mime: ''
}
const listeners = new Set()

export function recorderState() {
  return { on: state.on, startedAt: state.startedAt, warning: state.warning, sending: state.sending, error: state.error }
}
export function onRecorder(fn) { listeners.add(fn); return () => listeners.delete(fn) }
const emit = () => { const s = recorderState(); listeners.forEach(fn => { try { fn(s) } catch { /* a screen gone */ } }) }

export function pickMime(isSupported = t => window.MediaRecorder?.isTypeSupported?.(t)) {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => { try { return isSupported(t) } catch { return false } }) || ''
}

async function keepAwake() {
  try { state.wake = await navigator.wakeLock?.request?.('screen') } catch { state.wake = null }
}
function onVisibility() {
  if (!state.on) return
  if (document.visibilityState === 'visible') {
    keepAwake()
    const live = state.stream?.getAudioTracks?.().some(t => t.readyState === 'live')
    if (!live) { state.warning = 'The microphone stopped while the screen was away — tap Record to carry on.'; emit() }
  }
}

function nextStretch() {
  if (!state.on || !state.stream) return
  const rec = new MediaRecorder(state.stream, state.mime ? { mimeType: state.mime } : undefined)
  const parts = []
  rec.ondataavailable = e => { if (e.data?.size) parts.push(e.data) }
  rec.onstop = () => {
    const blob = new Blob(parts, { type: rec.mimeType || state.mime })
    if (state.onStretch && blob.size > 2000) {
      state.sending++; emit()
      state.queue = state.queue.then(() => state.onStretch(blob)).catch(err => { state.error = err?.message || String(err) })
        .finally(() => { state.sending--; emit() })
    }
    nextStretch()
  }
  rec.start()
  state.stretch = rec
  state.timer = setTimeout(() => { if (rec.state === 'recording') rec.stop() }, STRETCH_MS)
}

/** Starts recording. `onStretch(blob)` is sent each forty-second piece. */
export async function startRecorder({ onStretch } = {}) {
  if (state.on) return recorderState()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  Object.assign(state, { on: true, startedAt: Date.now(), warning: '', error: '', stream, onStretch, fullParts: [], mime: pickMime() })
  stream.getAudioTracks().forEach(t => { t.onended = () => { state.warning = 'The microphone stopped — tap Record to carry on.'; emit() } })
  const full = new MediaRecorder(stream, state.mime ? { mimeType: state.mime } : undefined)
  full.ondataavailable = e => { if (e.data?.size) state.fullParts.push(e.data) }
  full.start(FULL_SLICE_MS)
  state.full = full
  nextStretch()
  keepAwake()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('beforeunload', warnLeaving)
  emit()
  return recorderState()
}

function warnLeaving(e) { if (state.on) { e.preventDefault(); e.returnValue = '' } }

/**
 * Stops recording and hands back the whole meeting as one file, once the last
 * live piece has been sent.
 */
export async function stopRecorder() {
  if (!state.on && !state.full) return null
  state.on = false
  clearTimeout(state.timer)
  const fullDone = new Promise(resolve => {
    if (!state.full || state.full.state === 'inactive') return resolve()
    state.full.onstop = () => resolve()
    state.full.stop()
  })
  if (state.stretch?.state === 'recording') state.stretch.stop()
  await fullDone
  state.stream?.getTracks().forEach(t => t.stop())
  try { await state.wake?.release?.() } catch { /* already gone */ }
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('beforeunload', warnLeaving)
  try { await state.queue } catch { /* reported */ }
  const blob = state.fullParts.length ? new Blob(state.fullParts, { type: (state.full?.mimeType || state.mime || 'audio/webm') }) : null
  Object.assign(state, { stream: null, stretch: null, full: null, fullParts: [], wake: null, startedAt: 0, sending: 0 })
  emit()
  return blob
}

/** "12:34" since the recording started. Pure. */
export function elapsed(startedAt, now = Date.now()) {
  if (!startedAt) return '0:00'
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
