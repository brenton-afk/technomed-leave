import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { STAFF } from '../../staffConfig.js'
import { describe, recorderActive } from '../../projects/liveMeeting.js'

// ─── The live meeting (Brent, 11 Nov 2026) ───────────────────────────────────
// "A real time live meeting, where you automatically update the projects page
// in real time for us." One phone records; every STRETCH_MS what was said is
// written out and read against the open tasks (api/_liveMeeting.js), and what
// it implies appears here, on every phone with the panel open, as a card.
// Nothing reaches the projects page until someone taps Accept. Typing a note
// does the same as speaking, for a noisy room or a meeting nobody records.

const STRETCH_MS = 40000
const POLL_MS = 5000

const btn = primary => ({
  ...text('bodyStrong'), minHeight: 44, padding: `0 ${space.md}px`, borderRadius: radius.control,
  border: primary ? 'none' : `1px solid ${colour.line}`, background: primary ? colour.accent : colour.surface,
  color: primary ? colour.surface : colour.ink, cursor: 'pointer'
})
const input = { ...text('body'), fontSize: 16, minHeight: 44, padding: `0 ${space.sm}px`, borderRadius: radius.control, border: `1px solid ${colour.line}`, background: colour.surface, color: colour.ink, boxSizing: 'border-box', maxWidth: '100%' }

const timeOf = iso => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Hobart' }) : '')

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('Could not read the recording'))
    r.readAsDataURL(blob)
  })
}

function SuggestionCard({ s, onAct, busy }) {
  const [task, setTask] = useState(s.task || '')
  const [assignee, setAssignee] = useState(s.assignee || 'Unassigned')
  const [due, setDue] = useState(s.due_date || '')
  const editable = s.kind === 'new' || s.kind === 'update'
  const tint = s.kind === 'done' ? colour.accent : s.kind === 'new' ? colour.navy : colour.warning
  return (
    <div data-live-suggestion={s.kind} style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderLeft: `4px solid ${tint}`, borderRadius: radius.card, padding: space.md, display: 'flex', flexDirection: 'column', gap: space.sm }}>
      <div style={{ ...text('caption'), color: tint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {s.kind === 'new' ? 'New task' : s.kind === 'done' ? 'Mark done' : 'Change a task'}
      </div>
      {s.kind === 'new'
        ? <input aria-label="Task" value={task} onChange={e => setTask(e.target.value)} style={{ ...input, width: '100%' }} />
        : <div style={{ ...text('bodyStrong'), color: colour.ink, overflowWrap: 'anywhere' }}>{s.task}</div>}
      {s.kind === 'update' && s.was && (
        <div style={{ ...text('caption'), color: colour.inkFaint }}>Was {s.was.assignee || 'Unassigned'}{s.was.due_date ? `, due ${s.was.due_date}` : ''}</div>
      )}
      {editable && (
        <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap' }}>
          <select aria-label="Who" value={assignee} onChange={e => setAssignee(e.target.value)} style={input}>
            <option value="Unassigned">Unassigned</option>
            {STAFF.map(p => <option key={p.email} value={p.name}>{p.firstName || p.name}</option>)}
          </select>
          <input aria-label="Due" type="date" value={due} onChange={e => setDue(e.target.value)} style={input} />
        </div>
      )}
      {s.why && <div style={{ ...text('caption'), color: colour.inkFaint }}>Heard: {s.why}</div>}
      <div style={{ display: 'flex', gap: space.xs }}>
        <button type="button" disabled={busy} style={{ ...btn(true), flex: 1 }}
          onClick={() => onAct(s.id, 'accept', s.kind === 'new' ? { task, assignee, due_date: due } : s.kind === 'update' ? { assignee, due_date: due } : {})}>
          {busy ? 'Saving…' : 'Accept'}
        </button>
        <button type="button" disabled={busy} style={btn(false)} onClick={() => onAct(s.id, 'skip')}>Skip</button>
      </div>
    </div>
  )
}

export default function LiveMeeting({ user, onClose, onChanged }) {
  const auth = { Authorization: `Bearer ${user?.token || ''}`, 'Content-Type': 'application/json' }
  const [live, setLive] = useState(undefined)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [title, setTitle] = useState('Staff meeting')
  const [busy, setBusy] = useState('')
  const [recording, setRecording] = useState(false)
  const [sending, setSending] = useState(0)
  const [ended, setEnded] = useState(null)
  const [showWords, setShowWords] = useState(false)
  const rec = useRef({ stream: null, recorder: null, timer: null, queue: Promise.resolve(), on: false })

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/meetings/agent?action=live', { headers: auth })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the meeting')
      setLive(body.live || null)
    } catch (err) { setError(err.message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])

  // Every few seconds while the panel is open and on screen: this is the room's
  // shared screen, so a minute's lag would be a different meeting.
  useEffect(() => {
    load()
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const id = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  const call = async (action, method, body) => {
    const res = await fetch(`/api/meetings/agent?action=${action}`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error || 'That did not work')
    return out
  }

  const start = async () => {
    setBusy('start'); setError('')
    try { setLive((await call('live', 'POST', { title })).live) } catch (err) { setError(err.message) }
    setBusy('')
  }

  const sendStretch = blob => {
    rec.current.queue = rec.current.queue.then(async () => {
      if (!blob || blob.size < 2000) return
      setSending(n => n + 1)
      try {
        const audio = await toBase64(blob)
        await call('live-say', 'POST', { audio, contentType: (blob.type || 'audio/webm').split(';')[0] })
        await load()
      } catch (err) { setError(err.message) }
      setSending(n => n - 1)
    })
  }

  // MediaRecorder is stopped and started again each stretch, so every piece
  // sent is a whole file a transcriber can open on its own.
  const nextRecorder = () => {
    const r = rec.current
    if (!r.on || !r.stream) return
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || ''
    const recorder = new MediaRecorder(r.stream, type ? { mimeType: type } : undefined)
    const parts = []
    recorder.ondataavailable = e => { if (e.data?.size) parts.push(e.data) }
    recorder.onstop = () => { sendStretch(new Blob(parts, { type: recorder.mimeType || type })); nextRecorder() }
    recorder.start()
    r.recorder = recorder
    r.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, STRETCH_MS)
  }

  const startRecording = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      rec.current = { ...rec.current, stream, on: true }
      setRecording(true)
      nextRecorder()
    } catch {
      setError('The microphone could not be opened — allow it for this site, or type notes below.')
    }
  }

  const stopRecording = () => {
    const r = rec.current
    r.on = false
    clearTimeout(r.timer)
    if (r.recorder?.state === 'recording') r.recorder.stop()
    r.stream?.getTracks().forEach(t => t.stop())
    r.stream = null
    setRecording(false)
  }

  useEffect(() => () => stopRecording(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const addNote = async () => {
    const said = note.trim()
    if (!said) return
    setBusy('note'); setError('')
    try { await call('live-say', 'POST', { text: said }); setNote(''); await load() } catch (err) { setError(err.message) }
    setBusy('')
  }

  const act = async (id, decision, edits) => {
    setBusy(id); setError('')
    try { await call('live-act', 'POST', { id, decision, edits }); if (decision === 'accept') onChanged?.() } catch (err) { setError(err.message) }
    await load()
    setBusy('')
  }

  const end = async () => {
    if (!window.confirm('End the meeting for everyone? Accepted items stay on the projects page.')) return
    stopRecording()
    setBusy('end'); setError('')
    try { await rec.current.queue } catch { /* already reported */ }
    try { setEnded((await call('live', 'DELETE')).ended); setLive(null); onChanged?.() } catch (err) { setError(err.message) }
    setBusy('')
  }

  const waiting = (live?.suggestions || []).filter(s => s.status === 'waiting').reverse()
  const accepted = (live?.suggestions || []).filter(s => s.status === 'accepted').reverse()
  const someoneElse = live && !recording && recorderActive(live) ? live.recorder.name : ''

  return (
    <Overlay>
      <div role="dialog" aria-label="Live meeting" data-live-meeting style={{
        position: 'fixed', inset: 0, zIndex: 3500, background: colour.canvas, overflowY: 'auto', overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: space.md, display: 'flex', flexDirection: 'column', gap: space.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...text('title'), color: colour.ink }}>{live ? live.title : 'Live meeting'}</div>
              {live && <div style={{ ...text('caption'), color: colour.inkFaint }}>Started {timeOf(live.startedAt)} by {live.startedBy || 'someone'}</div>}
            </div>
            {live && <span style={{ ...text('caption'), fontWeight: 700, color: colour.surface, background: colour.danger, borderRadius: radius.pill, padding: `2px ${space.sm}px` }}>LIVE</span>}
            <button type="button" onClick={() => { stopRecording(); onClose() }} aria-label="Close" style={btn(false)}>✕</button>
          </div>

          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger }}>{error}</div>}
          {live === undefined && !error && <div style={{ ...text('body'), color: colour.inkFaint }}>Loading…</div>}

          {ended && (
            <div style={{ background: colour.accentSoft, borderRadius: radius.card, padding: space.md }}>
              <div style={{ ...text('bodyStrong'), color: colour.ink }}>Meeting ended</div>
              <div style={{ ...text('body'), color: colour.ink }}>{ended.summary}</div>
              {ended.waiting > 0 && <div style={{ ...text('caption'), color: colour.inkFaint }}>{ended.waiting} suggestion{ended.waiting === 1 ? ' was' : 's were'} left unanswered and not added.</div>}
              <div style={{ ...text('caption'), color: colour.inkFaint }}>It is in the meeting report as “{ended.title}”.</div>
            </div>
          )}

          {live === null && (
            <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md, display: 'flex', flexDirection: 'column', gap: space.sm }}>
              <div style={{ ...text('body'), color: colour.ink }}>
                One phone records the room. Every forty seconds what was said is read against the open tasks, and suggestions appear here for everyone. Nothing goes on the projects page until someone taps Accept.
              </div>
              <input aria-label="Meeting name" value={title} onChange={e => setTitle(e.target.value)} style={{ ...input, width: '100%' }} />
              <button type="button" onClick={start} disabled={Boolean(busy)} style={btn(true)}>{busy === 'start' ? 'Starting…' : 'Start the live meeting'}</button>
            </div>
          )}

          {live && (<>
            <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', alignItems: 'center' }}>
              {recording
                ? <button type="button" onClick={stopRecording} style={{ ...btn(false), borderColor: colour.danger, color: colour.danger }}>● Stop recording</button>
                : <button type="button" onClick={startRecording} disabled={typeof window !== 'undefined' && !window.MediaRecorder} style={btn(true)}>Record on this phone</button>}
              <span style={{ ...text('caption'), color: colour.inkFaint }}>
                {recording ? (sending ? 'Listening · reading the last stretch…' : 'Listening — suggestions every 40 seconds')
                  : someoneElse ? `${someoneElse}’s phone is recording` : 'Not recording — type notes below'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: space.xs }}>
              <input aria-label="Add a note" placeholder="Type what was agreed…" value={note}
                onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote() }}
                style={{ ...input, flex: 1, minWidth: 0 }} />
              <button type="button" onClick={addNote} disabled={busy === 'note' || !note.trim()} style={btn(false)}>{busy === 'note' ? '…' : 'Add'}</button>
            </div>

            <section style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
              <div style={{ ...text('heading'), color: colour.ink }}>To accept · {waiting.length}</div>
              {!waiting.length && <div style={{ ...text('caption'), color: colour.inkFaint }}>Suggestions appear here as the meeting goes.</div>}
              {waiting.map(s => <SuggestionCard key={s.id} s={s} onAct={act} busy={busy === s.id} />)}
            </section>

            {accepted.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
                <div style={{ ...text('heading'), color: colour.ink }}>On the projects page · {accepted.length}</div>
                {accepted.map(s => (
                  <div key={s.id} style={{ ...text('body'), color: colour.ink, borderBottom: border.hairlineSoft, padding: `${space.xs}px 0` }}>
                    <span aria-hidden="true" style={{ color: colour.accent, fontWeight: 700 }}>✓ </span>{describe(s)}
                    <span style={{ ...text('caption'), color: colour.inkFaint }}> · {s.decidedBy}</span>
                  </div>
                ))}
              </section>
            )}

            <button type="button" onClick={() => setShowWords(v => !v)} style={{ ...btn(false), alignSelf: 'flex-start' }}>
              {showWords ? 'Hide what was heard' : `What was heard (${(live.lines || []).length})`}
            </button>
            {showWords && (
              <div data-live-words style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
                {[...(live.lines || [])].reverse().slice(0, 40).map((l, i) => (
                  <div key={i} style={{ ...text('caption'), color: colour.ink, overflowWrap: 'anywhere' }}>
                    <span style={{ color: colour.inkFaint }}>{timeOf(l.at)}{l.typed ? ` · ${l.by}` : ''} — </span>{l.text}
                  </div>
                ))}
              </div>
            )}

            <button type="button" onClick={end} disabled={Boolean(busy)} style={{ ...btn(false), color: colour.danger }}>
              {busy === 'end' ? 'Ending…' : 'End the meeting'}
            </button>
          </>)}
        </div>
      </div>
    </Overlay>
  )
}
