import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import { STAFF } from '../../staffConfig.js'
import { describe, recorderActive } from '../../projects/liveMeeting.js'
import { upload } from '@vercel/blob/client'
import { startRecorder, stopRecorder, recorderState, onRecorder, STRETCH_MS } from '../../projects/meetingRecorder.js'

// ─── The live meeting (Brent, 11 Nov 2026) ───────────────────────────────────
// "A real time live meeting, where you automatically update the projects page
// in real time for us." One phone records; every STRETCH_MS what was said is
// written out and read against the open tasks (api/_liveMeeting.js), and what
// it implies appears here, on every phone with the panel open, as a card.
// Nothing reaches the projects page until someone taps Accept. Typing a note
// does the same as speaking, for a noisy room or a meeting nobody records.
//
// Since 12 Nov 2026 (Brent: "record the transcript and then have the
// transcript and discussion feed back into the projects page"): the recorder
// lives in projects/meetingRecorder.js and keeps going when this panel closes
// or the person moves around the portal (RecordingBar shows it). Ending the
// meeting uploads the whole recording once and reads it whole
// (action=live-final): one review list — new, done, changed, and a progress
// note per task discussed — with Accept all, then File the meeting. A
// transcript from Jamie or a Word/PDF file goes through the same review.

const POLL_MS = 5000

const btn = primary => ({
  ...text('bodyStrong'), minHeight: 44, padding: `0 ${space.md}px`, borderRadius: radius.control,
  ...(primary ? face.primary : face.secondary), cursor: 'pointer'
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
  const [noteText, setNoteText] = useState(s.note || '')
  const editable = s.kind === 'new' || s.kind === 'update'
  const tint = s.kind === 'done' ? colour.accent : s.kind === 'new' ? colour.navy : s.kind === 'note' ? colour.inkMuted : colour.warning
  return (
    <div data-live-suggestion={s.kind} style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderLeft: `4px solid ${tint}`, borderRadius: radius.card, padding: space.md, display: 'flex', flexDirection: 'column', gap: space.sm }}>
      <div style={{ ...text('caption'), color: tint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {s.kind === 'new' ? 'New task' : s.kind === 'done' ? 'Mark done' : s.kind === 'note' ? 'Progress note' : 'Change a task'}
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
      {s.kind === 'note' && (
        <textarea aria-label="Note" value={noteText} onChange={e => setNoteText(e.target.value)} rows={2}
          style={{ ...input, width: '100%', minHeight: 64, padding: space.sm, resize: 'vertical' }} />
      )}
      {s.why && <div style={{ ...text('caption'), color: colour.inkFaint }}>Heard: {s.why}</div>}
      <div style={{ display: 'flex', gap: space.xs }}>
        <button type="button" disabled={busy} style={{ ...btn(true), flex: 1 }}
          onClick={() => onAct(s.id, 'accept', s.kind === 'new' ? { task, assignee, due_date: due } : s.kind === 'update' ? { assignee, due_date: due } : s.kind === 'note' ? { note: noteText } : {})}>
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
  const [rec, setRec] = useState(recorderState())
  const [ended, setEnded] = useState(null)
  const [showWords, setShowWords] = useState(false)
  const [pasted, setPasted] = useState('')
  const [importing, setImporting] = useState(false)
  useEffect(() => onRecorder(setRec), [])
  const recording = rec.on

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

  const startRecording = async () => {
    setError('')
    try {
      await startRecorder({
        onStretch: async blob => {
          const audio = await toBase64(blob)
          await call('live-say', 'POST', { audio, contentType: (blob.type || 'audio/webm').split(';')[0] })
          load()
        }
      })
    } catch {
      setError('The microphone could not be opened — allow it for this site, or type notes below.')
    }
  }

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
  const acceptAll = async list => {
    setBusy('all'); setError('')
    let failed = 0
    for (const s of list) {
      try { await call('live-act', 'POST', { id: s.id, decision: 'accept', edits: {} }) } catch { failed++ }
    }
    if (failed) setError(`${failed} could not be added — they are still on the list.`)
    onChanged?.(); await load(); setBusy('')
  }

  /** Stops the recording, sends the whole meeting to be read, and waits for the review. */
  const finish = async () => {
    if (!window.confirm('End the meeting and read the whole of it? You will get one list of changes to accept.')) return
    setBusy('finish'); setError('')
    try {
      const blob = await stopRecorder()
      let audioUrl = ''
      if (blob && blob.size > 20000) {
        const ext = /mp4/.test(blob.type) ? 'm4a' : 'webm'
        const uploaded = await upload(`meetings/${live?.id || 'live'}.${ext}`, blob, {
          access: 'public', handleUploadUrl: '/api/meetings/agent?action=blob-upload',
          clientPayload: JSON.stringify({ token: user?.token || null })
        })
        audioUrl = uploaded.url
      }
      setLive((await call('live-final', 'POST', audioUrl ? { audioUrl } : {})).live)
    } catch (err) { setError(`${err.message} — what the live stretches heard can still be read: tap “Read what was heard”.`) }
    setBusy('')
  }
  const readHeard = async () => {
    setBusy('finish'); setError('')
    try { setLive((await call('live-final', 'POST', {})).live) } catch (err) { setError(err.message) }
    setBusy('')
  }
  const retry = async () => {
    setBusy('finish'); setError('')
    try { setLive((await call('live-final', 'POST', { retry: true })).live) } catch (err) { setError(err.message) }
    setBusy('')
  }

  const fileMeeting = async () => {
    const left = (live?.suggestions || []).filter(s => s.status === 'waiting').length
    if (!window.confirm(left ? `File the meeting? ${left} item${left === 1 ? ' is' : 's are'} not accepted and will not be added.` : 'File the meeting? Accepted items stay on the projects page.')) return
    if (recording) await stopRecorder()
    setBusy('end'); setError('')
    try { setEnded((await call('live', 'DELETE')).ended); setLive(null); onChanged?.() } catch (err) { setError(err.message) }
    setBusy('')
  }

  async function readFile(file) {
    setImporting(true); setError('')
    try {
      if (/\.txt$/i.test(file.name) || file.type === 'text/plain') { setPasted(await file.text()); return }
      const data = await toBase64(file)
      const out = await call('read-file', 'POST', { filename: file.name, mediaType: file.type, data })
      setPasted(out.text || '')
    } catch (err) { setError(err.message) } finally { setImporting(false) }
  }
  const importTranscript = async () => {
    if (!pasted.trim()) return
    setBusy('finish'); setError('')
    try { setLive((await call('live-final', 'POST', { transcript: pasted, title })).live); setPasted('') } catch (err) { setError(err.message) }
    setBusy('')
  }

  const final = live?.final
  const reading = final && ['transcribing', 'reading'].includes(final.status)
  const inReview = live?.status === 'review'
  const waiting = (live?.suggestions || []).filter(s => s.status === 'waiting').reverse()
  const accepted = (live?.suggestions || []).filter(s => s.status === 'accepted').reverse()
  const someoneElse = live && !recording && recorderActive(live) ? live.recorder.name : ''
  const card = { background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md, display: 'flex', flexDirection: 'column', gap: space.sm }

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
            {live?.status === 'live' && <span style={{ ...text('caption'), fontWeight: 700, color: colour.surface, background: colour.danger, borderRadius: radius.pill, padding: `2px ${space.sm}px` }}>LIVE</span>}
            <button type="button" onClick={onClose} aria-label="Close" style={btn(false)}>✕</button>
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
              <div style={{ ...text('caption'), color: colour.inkFaint }}>
                Best on a phone in the middle of the table, plugged in, with this screen left open. On a computer it keeps recording while you use the rest of the portal.
              </div>
            </div>
          )}

          {live === null && (
            <div data-live-import style={card}>
              <div style={{ ...text('heading'), color: colour.ink }}>Recorded somewhere else?</div>
              <div style={{ ...text('body'), color: colour.inkMuted }}>Paste a transcript from Jamie (or any notes), or choose a .txt, Word or PDF file. It is read the same way: one list of changes to accept.</div>
              <textarea aria-label="Transcript" value={pasted} onChange={e => setPasted(e.target.value)} rows={5} placeholder="Paste the transcript here"
                style={{ ...input, width: '100%', minHeight: 120, padding: space.sm, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap' }}>
                <label style={{ ...btn(false), display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  {importing ? 'Reading…' : 'Choose a file'}
                  <input type="file" accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f) }} style={{ display: 'none', fontSize: 16 }} />
                </label>
                <button type="button" onClick={importTranscript} disabled={!pasted.trim() || Boolean(busy)} style={btn(true)}>{busy === 'finish' ? 'Reading the meeting…' : 'Read it'}</button>
              </div>
            </div>
          )}

          {live && reading && (
            <div data-live-reading style={{ ...card, background: colour.accentSoft, border: 'none' }}>
              <div style={{ ...text('bodyStrong'), color: colour.ink }}>{final.status === 'transcribing' ? 'Writing out the whole meeting…' : 'Reading the meeting against the projects…'}</div>
              <div style={{ ...text('caption'), color: colour.inkMuted }}>A minute or two for an hour's meeting. You can close this and come back — it carries on.</div>
            </div>
          )}
          {live && final && ['unread', 'failed'].includes(final.status) && (
            <div role="alert" style={{ ...card, borderColor: colour.dangerLine }}>
              <div style={{ ...text('body'), color: colour.danger }}>{final.error || 'The meeting could not be read.'}</div>
              {final.status === 'unread' ? <button type="button" onClick={retry} disabled={Boolean(busy)} style={btn(true)}>Try reading it again</button>
                : <button type="button" onClick={readHeard} disabled={Boolean(busy)} style={btn(true)}>Read what was heard</button>}
            </div>
          )}
          {live && inReview && (
            <div data-live-summary style={card}>
              <div style={{ ...text('heading'), color: colour.ink }}>The meeting</div>
              {final?.summary && <div style={{ ...text('body'), color: colour.ink, whiteSpace: 'pre-wrap' }}>{final.summary}</div>}
              {final?.error && <div style={{ ...text('caption'), color: colour.warning }}>{final.error}</div>}
              <div style={{ ...text('caption'), color: colour.inkFaint }}>Accept what is right below, then File the meeting — the meeting report then comes from the updated projects page.</div>
            </div>
          )}

          {live && (<>
            {live.status === 'live' && (
              <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', alignItems: 'center' }}>
                {!recording && (
                  <button type="button" onClick={startRecording} disabled={typeof window !== 'undefined' && !window.MediaRecorder} style={btn(true)}>● Record</button>
                )}
                <span style={{ ...text('caption'), color: rec.warning ? colour.danger : colour.inkFaint }}>
                  {rec.warning || (recording ? (rec.sending ? 'Recording · reading the last stretch…' : `Recording — live suggestions every ${STRETCH_MS / 1000} seconds. You can close this; it keeps recording.`)
                    : someoneElse ? `${someoneElse} is recording` : 'Not recording — type notes below')}
                </span>
              </div>
            )}

            {live.status === 'live' && (
            <div style={{ display: 'flex', gap: space.xs }}>
              <input aria-label="Add a note" placeholder="Type what was agreed…" value={note}
                onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote() }}
                style={{ ...input, flex: 1, minWidth: 0 }} />
              <button type="button" onClick={addNote} disabled={busy === 'note' || !note.trim()} style={btn(false)}>{busy === 'note' ? '…' : 'Add'}</button>
            </div>
            )}

            <section style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
                <div style={{ ...text('heading'), color: colour.ink, flex: 1 }}>To accept · {waiting.length}</div>
                {waiting.length > 1 && <button type="button" onClick={() => acceptAll(waiting)} disabled={Boolean(busy)} style={btn(true)}>{busy === 'all' ? 'Adding…' : `Accept all ${waiting.length}`}</button>}
              </div>
              {!waiting.length && <div style={{ ...text('caption'), color: colour.inkFaint }}>{inReview ? 'Nothing left to accept.' : 'Suggestions appear here as the meeting goes.'}</div>}
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

            {live.status === 'live' && (
              <button type="button" onClick={finish} disabled={Boolean(busy)} style={{ ...btn(true), background: colour.danger }}>
                {busy === 'finish' ? 'Sending the recording…' : 'End the meeting and read it'}
              </button>
            )}
            {(inReview || live.status === 'live') && (
              <button type="button" onClick={fileMeeting} disabled={Boolean(busy) || reading} style={{ ...btn(inReview), ...(inReview ? {} : { color: colour.inkMuted }) }}>
                {busy === 'end' ? 'Filing…' : inReview ? 'File the meeting' : 'End without reading it'}
              </button>
            )}
          </>)}
        </div>
      </div>
    </Overlay>
  )
}
