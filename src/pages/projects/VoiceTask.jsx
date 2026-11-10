import React, { useEffect, useRef, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { Mic } from '../voice/VoiceSheet.jsx'
import { stripWake } from '../../voice/command.js'

// ─── Add a to-do by voice (Brent, 11 Nov 2026) ───────────────────────────────
// "Add a voice command option to the My To Do list page so you can add a task
// by voice." Tap the microphone, say it — "remind Toni to chase the Signus
// invoice by Friday" — tap again. The same reader as the old voice sheet
// (`action=voice`) turns it into a to-do; this only fills the quick-add box,
// its who and its due date. Nothing is added until Add is tapped: what was
// heard is shown beside it, because speech recognition mangles names.

const MAX_SECONDS = 30

/** What a voice reply fills the quick-add with. Pure, for the tests. */
export function voiceDraft(reply) {
  const todo = reply?.command?.intent === 'todo' ? reply.command.todo : null
  if (todo?.task) {
    return { task: todo.task, assignee: todo.assignee || 'Unassigned', due: todo.due_date || '' }
  }
  // Not read as a to-do: the words themselves are still the task.
  const said = stripWake(reply?.transcript || '') || String(reply?.transcript || '')
  return { task: said.trim(), assignee: 'Unassigned', due: '' }
}

export const canRecord = () => typeof window !== 'undefined'
  && typeof window.MediaRecorder === 'function' && Boolean(navigator.mediaDevices?.getUserMedia)

export default function VoiceTask({ user, onHeard }) {
  const [phase, setPhase] = useState('idle') // idle | recording | working
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const chunks = useRef([])
  const recorder = useRef(null)
  const stream = useRef(null)

  const release = () => {
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
  }
  useEffect(() => () => { if (recorder.current?.state === 'recording') recorder.current.stop(); release() }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    const tick = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(tick)
  }, [phase])
  useEffect(() => {
    if (phase === 'recording' && seconds >= MAX_SECONDS) finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, phase])

  async function begin() {
    setError('')
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '')
      const rec = new MediaRecorder(stream.current, mimeType
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
      release()
      setError('The microphone is not available. Check the app has permission.')
      setPhase('idle')
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
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
        reader.onerror = () => reject(new Error('Could not read that recording'))
        reader.readAsDataURL(blob)
      })
      const res = await fetch('/api/calendar/today?action=voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
        body: JSON.stringify({ audio, contentType: blob.type })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      const draft = voiceDraft(body)
      if (!draft.task) throw new Error('Nothing could be heard. Try again, closer to the phone.')
      onHeard({ ...draft, transcript: body.transcript || '' })
    } catch (err) {
      setError(err.message || 'That did not go through.')
    }
    setPhase('idle')
  }

  if (!canRecord()) return null
  const recording = phase === 'recording'
  return (
    <>
      <button type="button" data-voice-task
        onClick={recording ? finish : begin} disabled={phase === 'working'}
        aria-label={recording ? 'Stop and read the task' : 'Add a task by voice'}
        title={recording ? 'Tap to finish' : 'Say the task'}
        style={{
          flex: '0 0 auto', minHeight: 40, minWidth: 40, padding: recording ? `0 ${space.md}px` : 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          border: `1px solid ${recording ? colour.danger : colour.line}`, borderRadius: radius.pill,
          background: recording ? colour.danger : colour.surface,
          color: recording ? 'white' : colour.accent, cursor: phase === 'working' ? 'default' : 'pointer',
          ...text('caption'), fontWeight: 700
        }}>
        <Mic size={20} />
        {recording && <span>{seconds}s · Done</span>}
        {phase === 'working' && <span style={{ color: colour.inkFaint, padding: `0 ${space.xs}px` }}>Reading…</span>}
      </button>
      {error && (
        <span role="alert" style={{ ...text('caption'), color: colour.danger, flexBasis: '100%', padding: `0 ${space.sm}px` }}>{error}</span>
      )}
    </>
  )
}
