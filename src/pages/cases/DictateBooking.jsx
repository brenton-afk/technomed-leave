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
// Speech recognition has never heard of Petrusma, Ibbett or Bewg, and gets them
// wrong in the one field where being wrong matters most. So the transcript and
// the reading taken from it are both shown, side by side: a mangled surname is
// obvious as a quotation and invisible once it sits in a form box.
//
// Having shown both, there is no reason to make somebody re-enter them. The
// first version only filled the form and called that a review — which from the
// outside looked exactly like tapping a button and nothing happening. Now the
// reading is on screen to be read, and either it is right and you book it, or
// it is not and you open it in the form.

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
  // The three a booking cannot be made without. Anything missing and the only
  // way on is through the form, where it can be filled in.
  const ready = Boolean(heard?.fields?.patient && heard?.fields?.surgeon && heard?.fields?.date)

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
          {/* What it understood, not only what it heard. Without this, "Use
              this" asked you to approve a reading you had not been shown — and
              then only filled the form, which read as nothing happening. */}
          <div style={{
            marginTop: space.xs, border: `1px solid ${colour.line}`,
            borderRadius: radius.control, overflow: 'hidden'
          }}>
            {[
              ['Patient', heard.fields.patient],
              ['Surgeon', heard.fields.surgeon],
              ['Date', heard.fields.date],
              ['Hospital', heard.fields.hospital],
              ['Procedure', heard.fields.procedure],
              ['Kit', heard.fields.kit]
            ].map(([label, value]) => (
              <div key={label} style={{
                display: 'flex', gap: space.sm, padding: `4px ${space.sm}px`,
                borderBottom: `1px solid ${colour.lineSoft}`
              }}>
                <span style={{ ...text('caption'), color: colour.inkFaint, width: 76, flexShrink: 0 }}>
                  {label}
                </span>
                <span style={{
                  ...text('body'),
                  color: value ? colour.ink : colour.inkFainter
                }}>{value || 'not said'}</span>
              </div>
            ))}
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
          <>
            {/* Two ways on, because the reading above is either right or it is
                not. "Use this" alone filled the form and looked like nothing
                had happened. */}
            <button type="button" onClick={() => onFilled(heard.fields)} style={{
              flex: 1, padding: space.sm, borderRadius: radius.control,
              border: `1px solid ${colour.line}`, background: 'transparent',
              color: colour.inkMuted, ...text('bodyStrong'), cursor: 'pointer'
            }}>
              Check it first
            </button>
            <button type="button"
              disabled={!ready}
              onClick={() => onFilled(heard.fields, { andCreate: true })}
              style={{
                flex: 2, padding: space.sm, border: 'none', borderRadius: radius.control,
                background: ready ? colour.accentDeep : colour.inkFainter,
                color: 'white', ...text('bodyStrong'), cursor: ready ? 'pointer' : 'default'
              }}>
              {/* Not "Add to calendar": the sheet's own footer button says that,
                  and two of them on screen at once is a guess about which one
                  acts on what. */}
              Book it
            </button>
          </>
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
