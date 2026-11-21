import React, { useEffect, useRef, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'
import { Mic } from '../voice/VoiceSheet.jsx'
import { readMoveRequest, PLACE_NAMES } from '../../kit/moveRequest.js'
import { displayName } from '../../kit/brands.js'

// ─── Say a move (Brent, 21 Nov 2026) ─────────────────────────────────────────
// "I want to move the Diplomat torque and reduction tray from RHH to Calvary."
// Tap the microphone, say it, tap again — or type it. The words are read
// against the kit room's own names (src/kit/moveRequest.js) and the best
// match is offered with the places; Move it opens the ordinary move sheet with
// that tray and destination chosen, so the email step still decides.

const MAX_SECONDS = 20
const canRecord = () => typeof window !== 'undefined'
  && typeof window.MediaRecorder === 'function' && Boolean(navigator.mediaDevices?.getUserMedia)

export default function SayMove({ kits, user, onClose, onMove }) {
  useBackLayer(true, onClose)
  const [said, setSaid] = useState('')
  const [phase, setPhase] = useState('idle') // idle | recording | working
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [to, setTo] = useState('')
  const chunks = useRef([])
  const recorder = useRef(null)
  const stream = useRef(null)
  const release = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null }
  useEffect(() => () => { if (recorder.current?.state === 'recording') recorder.current.stop(); release() }, [])
  useEffect(() => {
    if (phase !== 'recording') return undefined
    const tick = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(tick)
  }, [phase])
  useEffect(() => { if (phase === 'recording' && seconds >= MAX_SECONDS) finish() }) // eslint-disable-line react-hooks/exhaustive-deps

  const reading = said.trim() ? readMoveRequest(said, kits) : null
  useEffect(() => { setTo(reading?.to || '') }, [said]) // eslint-disable-line react-hooks/exhaustive-deps

  async function begin() {
    setError('')
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '')
      const rec = new MediaRecorder(stream.current, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 })
      chunks.current = []
      rec.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data) }
      rec.onstop = send
      recorder.current = rec
      rec.start()
      setSeconds(0); setPhase('recording')
    } catch {
      release(); setError('The microphone is not available. Check the app has permission, or type it.'); setPhase('idle')
    }
  }
  function finish() {
    setPhase('working')
    if (recorder.current?.state === 'recording') recorder.current.stop()
    release()
  }
  async function send() {
    try {
      const blob = new Blob(chunks.current, { type: chunks.current[0]?.type || 'audio/webm' })
      const audio = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] || '')
        r.onerror = () => reject(new Error('Could not read that recording'))
        r.readAsDataURL(blob)
      })
      const res = await fetch('/api/guides?kits=hear', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token || ''}` },
        body: JSON.stringify({ audio, contentType: blob.type })
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'That did not go through.')
      if (!json.text) throw new Error('Nothing could be heard. Try again, closer to the phone.')
      setSaid(json.text)
    } catch (err) { setError(err.message || 'That did not go through.') }
    setPhase('idle')
  }

  const kitOf = c => kits.find(k => k.id === c.kitId)
  const recording = phase === 'recording'
  const choices = reading?.choices || []
  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div role="dialog" aria-label="Say a move" className="tm-sheet" data-say-move style={{
          background: colour.surface, width: '100%', maxWidth: 520, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.md, maxHeight: '85dvh', overflowY: 'auto', overflowX: 'hidden'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
            <div style={{ flex: 1, ...text('title'), color: colour.ink }}>Say a move</div>
            <button onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, borderRadius: radius.control, border: 'none', background: colour.canvas, cursor: 'pointer', ...text('heading') }}>✕</button>
          </div>
          <div style={{ ...text('caption'), color: colour.inkMuted }}>
            For example: “Move the Diplomat torque and reduction tray from RHH to Calvary.”
          </div>
          {canRecord() && (
            <button type="button" data-say-mic onClick={recording ? finish : begin} disabled={phase === 'working'}
              aria-label={recording ? 'Stop and read it' : 'Say the move'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: `${space.md}px`,
                borderRadius: radius.pill, cursor: phase === 'working' ? 'default' : 'pointer', ...text('bodyStrong'),
                ...(recording ? { background: colour.danger, color: '#fff', border: 'none' } : face.primary)
              }}>
              <Mic size={22} />
              {recording ? `Listening… ${seconds}s · tap when done` : phase === 'working' ? 'Reading…' : 'Tap and say it'}
            </button>
          )}
          <input value={said} onChange={e => setSaid(e.target.value)} placeholder="…or type it" aria-label="The move, in words" data-say-text
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', ...text('field'), border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }} />
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger }}>{error}</div>}

          {reading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                <span style={{ ...text('caption'), color: colour.inkMuted }}>To</span>
                {['CLV', 'RHH', 'office'].map(p => (
                  <button key={p} onClick={() => setTo(p)} aria-pressed={to === p} data-say-to={p}
                    style={{ ...text('caption'), fontWeight: 600, padding: '6px 12px', borderRadius: radius.pill, cursor: 'pointer', ...(to === p ? face.navy : face.secondary) }}>
                    {PLACE_NAMES[p]}
                  </button>
                ))}
              </div>
              {!choices.length && (
                <div style={{ ...text('caption'), color: colour.inkMuted }}>No tray or kit matches those words. Try the system and the tray's name.</div>
              )}
              {choices.map((c, i) => {
                const kit = kitOf(c)
                return (
                  <div key={`${c.kitId}-${c.label}`} data-say-choice style={{
                    display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px`,
                    border: i === 0 ? `1.5px solid ${colour.accent}` : border.hairline, borderRadius: radius.control,
                    background: i === 0 ? colour.accentSoft : colour.surface
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...text('bodyStrong'), color: colour.ink }}>{c.label}</div>
                      <div style={{ ...text('caption'), color: colour.inkMuted }}>
                        {displayName(c.system)} · now at {PLACE_NAMES[c.at] || c.at}{to ? ` → ${PLACE_NAMES[to]}` : ''}
                      </div>
                    </div>
                    <button disabled={!kit} onClick={() => onMove(kit, c.trays, to)} data-say-go
                      style={{ ...text('caption'), fontWeight: 700, padding: '8px 14px', borderRadius: radius.pill, cursor: 'pointer', ...(i === 0 ? face.primary : face.secondary) }}>
                      Move it
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Overlay>
  )
}
