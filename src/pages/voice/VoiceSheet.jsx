import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { describePlan, stripWake, hasWakeWord } from '../../voice/command.js'

// ─── Hold, speak, read, tap ──────────────────────────────────────────────────
// "Like a speak function that says 'Hey TM Portal, I want to add a booking', or
// 'Hey TM portal, I want to add a reminder', 'Hey TM portal I want to update
// the list order for tomorrow'."
//
// ── Why it shows the words as well as the plan ──
//
// Speech recognition has never heard of Petrusma, Ibbett or Bewg, and gets them
// wrong in the one field where being wrong matters most. A mangled surname is
// obvious as a quotation and invisible once it sits in a form box, so both are
// on screen: what was heard, and what that was taken to mean. The same reasoning
// as the booking dictation, which learned it the hard way.
//
// ── Why it never acts on its own ──
//
// Brent chose confirm-first for all four commands, including the two that are
// cheap to undo. It is the right call: the expensive failure is not a wrong
// reminder, it is a wrong patient surname on a calendar the whole team reads.

const MAX_SECONDS = 30

/** The recorder, kept beside the stream rather than in state. */
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

  useEffect(() => stop, [stop])
  return { chunks, recorder, stream, stop }
}

function Mic({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" />
      <path d="M12 17.5V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function VoiceSheet({ user, onClose, onPlan, weekdayOf }) {
  const { chunks, recorder, stream, stop } = useRecorder()
  const [phase, setPhase] = useState('idle')   // idle | recording | working | ready | error
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [heard, setHeard] = useState(null)

  useEffect(() => {
    if (phase !== 'recording') return
    const tick = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(tick)
  }, [phase])

  // A recording nobody stopped is a recording that never transcribes.
  useEffect(() => {
    if (phase === 'recording' && seconds >= MAX_SECONDS) finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, phase])

  async function begin() {
    setError('')
    setHeard(null)
    try {
      const got = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = got
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '')
      const rec = new MediaRecorder(got, mimeType
        ? { mimeType, audioBitsPerSecond: 32000 }
        : { audioBitsPerSecond: 32000 })
      chunks.current = []
      rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data) }
      rec.onstop = send
      recorder.current = rec
      rec.start()
      setSeconds(0)
      setPhase('recording')
    } catch {
      setError('The microphone is not available. Check the app has permission.')
      setPhase('error')
    }
  }

  function finish() {
    setPhase('working')
    stop()
  }

  async function send() {
    try {
      const blob = new Blob(chunks.current, { type: chunks.current[0]?.type || 'audio/webm' })
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
        reader.onerror = () => reject(new Error('Could not read that recording'))
        reader.readAsDataURL(blob)
      })

      const res = await fetch('/api/calendar/today?action=voice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
        },
        body: JSON.stringify({ audio: base64, contentType: blob.type })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      setHeard(body)
      setPhase('ready')
    } catch (err) {
      setError(err.message || 'That did not go through.')
      setPhase('error')
    }
  }

  const command = heard?.command
  const plan = command ? describePlan(command, { weekdayOf }) : null
  const unclear = command?.intent === 'unclear'

  return (
    <Overlay>
      {/* Overlay only portals to document.body and positions nothing. Without
          a fixed backdrop this lands below #root and off-screen. */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.6)', zIndex: 4000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        overflowY: 'auto', overflowX: 'hidden'
      }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Speak a command"
          className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 460,
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
            padding: space.lg
          }}>

          <div style={{
            display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.md
          }}>
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>
              {phase === 'ready' ? 'Is this right?' : 'Say what you want'}
            </span>
            {/* "There can't be situations when you get stuck in a part of the
                app." Always here, on every phase. */}
            <button type="button" onClick={onClose} aria-label="Close"
              style={{
                ...text('body'), background: 'none', border: 'none',
                color: colour.inkFaint, cursor: 'pointer', padding: 0
              }}>✕</button>
          </div>

          {phase === 'idle' && (
            <>
              <div style={{ ...text('body'), color: colour.inkMuted, marginBottom: space.lg }}>
                Hold the button and say it in one go — “Hey TM Portal, I want to
                update the list order for tomorrow”. The wake words are optional.
              </div>
              <button type="button" onClick={begin}
                style={{
                  ...text('bodyStrong'), width: '100%', minHeight: 56,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: space.sm, border: 'none', borderRadius: radius.card,
                  background: colour.accent, color: 'white', cursor: 'pointer'
                }}>
                <Mic /> Start speaking
              </button>
            </>
          )}

          {phase === 'recording' && (
            <>
              <div style={{
                textAlign: 'center', ...text('display'), color: colour.ink,
                fontVariantNumeric: 'tabular-nums', marginBottom: space.md
              }}>
                <span style={{ color: colour.danger }}>●</span>{' '}
                {String(seconds).padStart(2, '0')}s
              </div>
              <button type="button" onClick={finish}
                style={{
                  ...text('bodyStrong'), width: '100%', minHeight: 56,
                  border: 'none', borderRadius: radius.card,
                  background: colour.navy, color: 'white', cursor: 'pointer'
                }}>
                Done
              </button>
            </>
          )}

          {phase === 'working' && (
            <div style={{
              ...text('body'), color: colour.inkFaint, textAlign: 'center',
              padding: `${space.xxl}px 0`
            }}>
              Listening to what you said…
            </div>
          )}

          {phase === 'error' && (
            <>
              <div style={{
                ...text('body'), color: colour.danger, background: colour.dangerSoft,
                border: `1px solid ${colour.dangerLine}`, borderRadius: radius.control,
                padding: space.md, marginBottom: space.md
              }}>{error}</div>
              <button type="button" onClick={() => setPhase('idle')}
                style={{
                  ...text('bodyStrong'), width: '100%', minHeight: 48,
                  border: `1px solid ${colour.line}`, borderRadius: radius.card,
                  background: colour.surface, color: colour.ink, cursor: 'pointer'
                }}>Try again</button>
            </>
          )}

          {phase === 'ready' && (
            <>
              {/* What was heard, as a quotation. A mangled surname is obvious
                  here and invisible once it sits in a form box. */}
              <div style={{ ...text('micro'), color: colour.inkFaint, marginBottom: 4 }}>
                Heard
              </div>
              <div style={{
                ...text('body'), color: colour.inkMuted, fontStyle: 'italic',
                background: colour.surface, border: `1px solid ${colour.line}`,
                borderRadius: radius.control, padding: space.md, marginBottom: space.lg
              }}>
                “{stripWake(heard.transcript) || heard.transcript}”
                {hasWakeWord(heard.transcript) && (
                  <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 4 }}>
                    Wake words heard and ignored.
                  </span>
                )}
              </div>

              <div style={{ ...text('micro'), color: colour.inkFaint, marginBottom: 4 }}>
                {unclear ? 'Could not tell' : 'Will do'}
              </div>
              <div style={{
                background: colour.surface, border: `1px solid ${unclear ? colour.warningLine : colour.line}`,
                borderRadius: radius.control, padding: space.md, marginBottom: space.lg
              }}>
                <div style={{ ...text('bodyStrong'), color: colour.ink }}>{plan.title}</div>
                {plan.lines.map((line, i) => (
                  <div key={i} style={{ ...text('body'), color: colour.inkMuted }}>{line}</div>
                ))}
                {!unclear && command.confidence === 'low' && (
                  <div style={{ ...text('caption'), color: colour.warning, marginTop: 6 }}>
                    Not certain about this one — worth a careful read.
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: space.sm }}>
                <button type="button" onClick={() => { setPhase('idle'); setHeard(null) }}
                  style={{
                    ...text('bodyStrong'), flexGrow: 1, flexShrink: 1, flexBasis: 0,
                    minHeight: 50, border: `1px solid ${colour.line}`,
                    borderRadius: radius.card, background: colour.surface,
                    color: colour.inkMuted, cursor: 'pointer'
                  }}>
                  {unclear ? 'Say it again' : 'Not right'}
                </button>
                {!unclear && (
                  <button type="button" onClick={() => onPlan(heard)}
                    style={{
                      ...text('bodyStrong'), flexGrow: 1, flexShrink: 1, flexBasis: 0,
                      minHeight: 50, border: 'none', borderRadius: radius.card,
                      background: colour.accent, color: 'white', cursor: 'pointer'
                    }}>
                    {command.intent === 'booking' ? 'Open the form' : 'Do it'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Overlay>
  )
}

export { Mic }
