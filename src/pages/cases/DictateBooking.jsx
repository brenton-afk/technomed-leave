import React, { useState, useRef, useEffect, useCallback } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'

// ─── Speaking a booking instead of typing it ─────────────────────────────────
// The realistic moment: somebody in a corridor at RHH has just been told about a
// case, has a phone in one hand and nowhere to sit down. Typing six fields is
// not going to happen, and the booking ends up as a WhatsApp message to Brent
// instead — which is how Cramond's booking arrived.
//
// So: hold the button, say the whole thing in one go, let go. The fields fill
// in and you check them.
//
// It fills the form rather than making the booking, and that is not timidity.
// Speech recognition has never heard of Petrusma, Ibbett or Bewg, and gets them
// wrong in the one field where being wrong matters most. What comes back is
// always shown next to what was actually heard, so a mangled surname is obvious
// rather than sitting in a box looking confident.

const MAX_SECONDS = 60

/** The recorder's own view of itself, kept beside the stream rather than in state. */
function useRecorder() {
  const chunks = useRef([])
  const recorder = useRef(null)
  const stream = useRef(null)

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    // Released explicitly. A live microphone the user cannot see is its own
    // problem, and iOS leaves the indicator on until the track ends.
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
  }, [])

  // Whatever happens — unmount, an error, a navigation — the microphone closes.
  useEffect(() => stop, [stop])

  return { chunks, recorder, stream, stop }
}

export default function DictateBooking({ user, onFilled, onClose }) {
  const { chunks, recorder, stream, stop } = useRecorder()
  const [phase, setPhase] = useState('idle')   // idle | recording | working | error
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [heard, setHeard] = useState(null)

  useEffect(() => {
    if (phase !== 'recording') return
    const tick = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(tick)
  }, [phase])

  // A recording nobody stopped is a recording that will not transcribe. Sixty
  // seconds is far longer than a booking takes to say.
  useEffect(() => {
    if (phase === 'recording' && seconds >= MAX_SECONDS) finish()
  }, [phase, seconds]) // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError('')
    setHeard(null)
    setSeconds(0)
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      // Almost always a denied permission, and the fix is in iOS Settings
      // rather than anywhere in the app, so say where to go.
      setPhase('error')
      setError('The app cannot reach the microphone. Allow it in Settings → Safari → Microphone, then try again.')
      return
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '')
    chunks.current = []
    recorder.current = new MediaRecorder(stream.current,
      mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined)
    recorder.current.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data) }
    recorder.current.onstop = () => send()
    recorder.current.start()
    setPhase('recording')
  }

  function finish() {
    setPhase('working')
    stop()
  }

  async function send() {
    const blob = new Blob(chunks.current, { type: recorder.current?.mimeType || 'audio/webm' })
    if (blob.size < 2000) {
      setPhase('error')
      setError('That was too short to make out. Hold the button while you speak.')
      return
    }

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

      const res = await fetch('/api/calendar/today?action=dictate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
        },
        body: JSON.stringify({ audio: base64, contentType: blob.type })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That recording could not be read')

      setHeard(data)
      setPhase('idle')
    } catch (err) {
      setPhase('error')
      setError(err.message)
    }
  }

  const busy = phase === 'working'

  return (
    <div style={{
      border: `1px solid ${colour.line}`, borderRadius: radius.card,
      padding: space.md, marginBottom: space.md, background: colour.surface
    }}>
      {!heard && (
        <>
          <div style={{ ...text('bodyStrong'), color: colour.ink, marginBottom: 2 }}>
            Say the booking
          </div>
          <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
            Patient, surgeon, hospital, date, what is being done and the kit — in any order.
          </div>
        </>
      )}

      {error && (
        <div style={{
          ...text('caption'), color: colour.danger, background: colour.dangerSoft,
          border: `1px solid ${colour.dangerLine}`, borderRadius: radius.control,
          padding: space.sm, marginBottom: space.sm, whiteSpace: 'pre-wrap'
        }}>{error}</div>
      )}

      {heard && (
        <div style={{ marginBottom: space.sm }}>
          <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: 2 }}>
            What it heard
          </div>
          {/* Always shown. A surname the transcription mangled is obvious here
              and invisible once it is sitting in a form field. */}
          <div style={{
            ...text('body'), color: colour.ink, background: colour.canvas,
            border: `1px solid ${colour.line}`, borderRadius: radius.control,
            padding: space.sm
          }}>
            “{heard.transcript}”
          </div>
          {heard.unclear && (
            <div style={{
              ...text('caption'), color: colour.ink, background: colour.warningSoft,
              border: `1px solid ${colour.warningLine}`, borderRadius: radius.control,
              padding: space.sm, marginTop: space.xs
            }}>
              {heard.unclear}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: space.sm, alignItems: 'center' }}>
        {phase === 'recording'
          ? (
            <button type="button" onClick={finish} style={{
              flex: 1, padding: space.sm, border: 'none', borderRadius: radius.control,
              background: colour.danger, color: 'white', ...text('bodyStrong'), cursor: 'pointer'
            }}>
              ■ Stop · {seconds}s
            </button>
          )
          : (
            <button type="button" onClick={start} disabled={busy} style={{
              flex: 1, padding: space.sm, borderRadius: radius.control,
              border: `1px solid ${busy ? colour.line : colour.accent}`,
              background: busy ? 'transparent' : colour.accent,
              color: busy ? colour.inkFaint : 'white',
              ...text('bodyStrong'), cursor: busy ? 'default' : 'pointer'
            }}>
              {busy ? 'Working it out…' : heard ? '🎤 Say it again' : '🎤 Start speaking'}
            </button>
          )}

        {heard && phase !== 'recording' && !busy && (
          <button type="button" onClick={() => onFilled(heard.fields)} style={{
            flex: 1, padding: space.sm, border: 'none', borderRadius: radius.control,
            background: colour.accentDeep, color: 'white', ...text('bodyStrong'), cursor: 'pointer'
          }}>
            Use this
          </button>
        )}

        {onClose && phase !== 'recording' && (
          <button type="button" onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            ...text('caption'), color: colour.inkFaint, padding: space.sm
          }}>Cancel</button>
        )}
      </div>
    </div>
  )
}
