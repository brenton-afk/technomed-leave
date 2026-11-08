import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Page, Header, Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { upload } from '@vercel/blob/client'
import { STAFF, isSameStaff } from '../staffConfig.js'
import {
  GENERAL, normaliseProject, projectIdOf
} from '../projects/model.js'
import Workspace from './projects/Workspace.jsx'
import ProjectBoard from './projects/ProjectBoard.jsx'
import TaskSheet from './projects/TaskSheet.jsx'
import { DIVISIONS } from '../projects/model.js'
import { useIsDesktop } from '../design/viewport.js'
import Suggested from './projects/Suggested.jsx'
import {
  PRIORITY_COLOURS as PRIORITY_COLORS, PRIORITY_LABELS,
  formatDate, todayISO, tintOf
} from './projects/shared.js'

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function Projects({ user, onBack }) {
  // Every call below carries this. The endpoint behind them holds meeting
  // recordings, their transcripts and the shared worklist, and until now none
  // of it asked who was calling.
  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}
  // recording state machine: idle | recording | uploading | transcribing | analyzing | reviewing | sending | sent
  const [phase, setPhase] = useState('idle')
  const [meetingTitle, setMeetingTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [meetingId, setMeetingId] = useState(null)
  const [summary, setSummary] = useState('')
  const [draftItems, setDraftItems] = useState([])
  const [sentResult, setSentResult] = useState(null)
  const [truncated, setTruncated] = useState(false)

  // ── Dumping things in ──
  //
  // "Could she dump a transcript from a meeting into that section and have the
  // Claude agent build out a task and action list and allocate to staff?"
  //
  // It could already, in the sense that mattered: the extraction takes raw
  // text and matches names against the real staff list. What it had no way of
  // was getting text in without holding the meeting again into a phone. So a
  // meeting is now one of three ways in, not the only one.
  const [pasted, setPasted] = useState('')
  const [reading, setReading] = useState('')
  const pasteFileRef = useRef(null)

  // A task that came from nobody's meeting — the thing agreed in the car.
  const [typed, setTyped] = useState({ task: '', assignee: 'Unassigned', priority: 'normal', due_date: '' })
  const [addingTask, setAddingTask] = useState(false)

  const [worklist, setWorklist] = useState([])
  const [loadingBoard, setLoadingBoard] = useState(true)
  // Rows that could not be read back. Named rather than dropped: one of them
  // is somebody's task, and a board that quietly loses it is worse than one
  // that admits it.
  const [unreadable, setUnreadable] = useState([])

  // ── The project layer ──
  //
  // "We want it similar to monday.com as a true project page."
  //
  // Three screens of one set of data, and one of them pushed on top: the
  // projects and how far through each one is; my own list across all of them;
  // and the ways work gets in. A project opened replaces all three, which is
  // the only arrangement that fits a phone.
  const [projects, setProjects] = useState([])
  const [view, setView] = useState('projects')
  const [openId, setOpenId] = useState(null)
  const [openTaskId, setOpenTaskId] = useState(null)
  const [savingProject, setSavingProject] = useState(false)
  const today = todayISO()
  const wide = useIsDesktop()
  // Which of the phone's tabs is open, remembered with the rest of the
  // workspace's choices (tm_projects_view). Opens on your own list.
  const [phoneTab, setPhoneTab] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tm_projects_view') || '{}').phoneTab || 'todo' } catch { return 'todo' }
  })
  const choosePhoneTab = key => {
    setPhoneTab(key)
    try {
      const saved = JSON.parse(localStorage.getItem('tm_projects_view') || '{}') || {}
      localStorage.setItem('tm_projects_view', JSON.stringify({ ...saved, phoneTab: key }))
    } catch { /* private mode */ }
  }

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  useEffect(() => { loadWorklist() }, [])

  /**
   * The whole board, in one request.
   *
   * Projects and tasks together: progress, counts and which-column all need
   * both, and two round trips from a phone on hospital wifi is the difference
   * between instant and visibly slow.
   */
  async function loadWorklist() {
    setLoadingBoard(true)
    try {
      const res = await fetch('/api/meetings/agent?action=board', { headers: auth })
      const data = await res.json()
      setWorklist(data.items || [])
      setProjects((data.projects || []).map(normaliseProject).filter(Boolean))
      setUnreadable(data.unreadable || [])
    } catch (err) {
      console.error(err)
    }
    setLoadingBoard(false)
  }

  async function startRecording() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '')
      const recorder = new MediaRecorder(stream, mimeType
        ? { mimeType, audioBitsPerSecond: 32000 }
        : { audioBitsPerSecond: 32000 })
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = handleRecordingStopped
      mediaRecorderRef.current = recorder
      recorder.start()
      setPhase('recording')
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch (err) {
      setError('Could not access the microphone. Check permissions and try again.')
    }
  }

  function stopRecording() {
    clearInterval(timerRef.current)
    mediaRecorderRef.current?.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  async function handleRecordingStopped() {
    const recorder = mediaRecorderRef.current
    const blob = new Blob(chunksRef.current, { type: recorder?.mimeType || 'audio/webm' })

    setPhase('uploading')
    try {
      const uploaded = await upload(`meetings/${Date.now()}.webm`, blob, {
        access: 'public',
        handleUploadUrl: '/api/meetings/agent?action=blob-upload',
        // The SDK builds its own request, so the session cannot ride on a
        // header. This is the field that exists for it, and the server checks
        // it before handing out an upload token.
        clientPayload: JSON.stringify({ token: user?.token || null })
      })

      setPhase('transcribing')
      const startRes = await fetch('/api/meetings/agent?action=start-transcription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ audioUrl: uploaded.url })
      })
      const startData = await startRes.json()
      if (startData.error) throw new Error(startData.error)

      const transcript = await pollTranscription(startData.transcriptId)

      setPhase('analyzing')
      const analyzeRes = await fetch('/api/meetings/agent?action=analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          transcript,
          meetingTitle: meetingTitle.trim() || 'Untitled meeting',
          meetingDate,
          recordedByEmail: user?.email || null
        })
      })
      const analyzeData = await analyzeRes.json()
      if (analyzeData.error) throw new Error(analyzeData.error)

      setMeetingId(analyzeData.meetingId)
      setTruncated(Boolean(analyzeData.truncated))
      setSummary(analyzeData.summary)
      setDraftItems(analyzeData.actionItems.map((it, i) => ({ ...it, _localId: `item-${i}` })))
      setPhase('reviewing')
    } catch (err) {
      setError(err.message || 'Something went wrong processing the recording.')
      setPhase('idle')
    }
  }

  function pollTranscription(transcriptId) {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const res = await fetch(`/api/meetings/agent?action=status&id=${transcriptId}`, { headers: auth })
          const data = await res.json()
          if (data.status === 'completed') return resolve(data.transcript)
          if (data.status === 'error') return reject(new Error(data.error || 'Transcription failed'))
          setTimeout(poll, 4000)
        } catch (err) {
          reject(err)
        }
      }
      poll()
    })
  }

  function updateDraft(id, field, value) {
    setDraftItems(items => items.map(it => it._localId === id ? { ...it, [field]: value } : it))
  }

  function removeDraft(id) {
    setDraftItems(items => items.filter(it => it._localId !== id))
  }

  async function sendToTeam() {
    setPhase('sending')
    setError('')
    try {
      const res = await fetch('/api/meetings/agent?action=finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          meetingId,
          actionItems: draftItems.map(({ _localId, ...rest }) => rest)
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSentResult(data)
      setPhase('sent')
      loadWorklist()
    } catch (err) {
      setError(err.message || 'Could not send the minutes.')
      setPhase('reviewing')
    }
  }

  function resetFlow() {
    setPhase('idle')
    setMeetingTitle('')
    setMeetingId(null)
    setSummary('')
    setDraftItems([])
    setSentResult(null)
    setError('')
  }

  /**
   * One task changed, on screen first and on the server after.
   *
   * Optimistic because every one of these is a tap on a card — moving a column,
   * ticking something off — and a board that waits for hospital wifi before it
   * redraws feels broken rather than careful. The reload at the end is what
   * makes it honest: if the server disagreed, the board corrects itself.
   */
  const patchTask = useCallback(async (task, fields) => {
    setWorklist(items => items.map(it => (it.id === task.id ? { ...it, ...fields } : it)))
    try {
      const res = await fetch('/api/meetings/agent?action=task', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ id: task.id, ...fields })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      setWorklist(items => items.map(it => (it.id === task.id ? body.item : it)))
    } catch (err) {
      setError(err.message || 'That change did not save.')
      await loadWorklist()
    }
  }, [auth])

  const moveTask = useCallback((task, column) => {
    const row = worklist.find(it => it.id === task.id) || task
    patchTask(row, { column })
  }, [worklist, patchTask])

  /** An update on the thread. Not optimistic — it needs the server's stamp. */
  const commentOnTask = useCallback(async (task, textSaid) => {
    try {
      const res = await fetch('/api/meetings/agent?action=task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ id: task.id, text: textSaid })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      setWorklist(items => items.map(it => (it.id === task.id ? body.item : it)))
    } catch (err) {
      setError(err.message || 'That update did not save.')
    }
  }, [auth])

  const archiveTask = useCallback((task, on) => patchTask(task, { archive: on }), [patchTask])

  /** Really gone. The sheet asks twice before it calls this. */
  async function deleteItem(id) {
    setWorklist(items => items.filter(it => it.id !== id))
    setOpenTaskId(null)
    try {
      await fetch(`/api/meetings/agent?action=task&id=${id}`, { method: 'DELETE', headers: auth })
    } catch (err) {
      console.error(err)
    }
  }

  async function createProject(fields) {
    setSavingProject(true)
    setError('')
    try {
      const res = await fetch('/api/meetings/agent?action=project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(fields)
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      setProjects(list => [...list, normaliseProject(body.project)])
      setOpenId(body.project.id)
    } catch (err) {
      setError(err.message || 'Could not make that project.')
    }
    setSavingProject(false)
  }

  async function patchProject(id, fields) {
    setError('')
    try {
      const res = await fetch('/api/meetings/agent?action=project', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ id, ...fields })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      setProjects(list => list.map(p => (p.id === id ? normaliseProject(body.project) : p)))
      return true
    } catch (err) {
      setError(err.message || 'That did not save.')
      return false
    }
  }

  /**
   * A column added, renamed or removed.
   *
   * The removal reloads rather than patching in place: it moves every task that
   * was in the column, and guessing which ones on the client is how a board
   * ends up showing work that is no longer where it says it is.
   */
  async function changeColumn(method, body) {
    setError('')
    try {
      const res = await fetch('/api/meetings/agent?action=column', {
        method,
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ id: openId, ...body })
      })
      const out = await res.json()
      if (out.error) throw new Error(out.error)
      setProjects(list => list.map(p => (p.id === openId ? normaliseProject(out.project) : p)))
      if (method === 'DELETE') await loadWorklist()
    } catch (err) {
      setError(err.message || 'That column change did not save.')
    }
  }

  /**
   * Text in, action list out.
   *
   * The same analyse step the recording uses, which is the point: a pasted
   * transcript and a recorded one reach the review screen by the same road,
   * so there is one place where an item is checked before it lands on
   * somebody's day.
   */
  async function readFromText(text, titleFallback) {
    const words = String(text || '').trim()
    if (!words) { setError('Paste something first, or pick a file.'); return }

    setError('')
    setPhase('analyzing')
    try {
      const res = await fetch('/api/meetings/agent?action=analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          transcript: words,
          meetingTitle: meetingTitle.trim() || titleFallback || 'Pasted notes',
          meetingDate,
          recordedByEmail: user?.email || null
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setMeetingId(data.meetingId)
      setTruncated(Boolean(data.truncated))
      setSummary(data.summary)
      setDraftItems(data.actionItems.map((it, i) => ({ ...it, _localId: `item-${i}` })))
      setPasted('')
      setPhase('reviewing')
    } catch (err) {
      setError(err.message || 'Could not read that.')
      setPhase('idle')
    }
  }

  /** A dropped or chosen file, turned into text on the server. */
  async function readFromFile(file) {
    if (!file) return
    setError('')
    setReading(file.name)
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
        reader.onerror = () => reject(new Error('Could not open that file'))
        reader.readAsDataURL(file)
      })

      const res = await fetch('/api/meetings/agent?action=read-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ filename: file.name, mediaType: file.type, data })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      setReading('')
      // Named after the file, because "Pasted notes" is no use in a month when
      // somebody is looking for what was agreed.
      await readFromText(body.text, file.name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      setReading('')
      setError(err.message || 'Could not read that file.')
    }
  }

  /** One task, straight to the worklist. Whoever typed it is the review. */
  async function addTypedTask() {
    if (!typed.task.trim() || addingTask) return
    setAddingTask(true)
    setError('')
    try {
      const res = await fetch('/api/meetings/agent?action=add-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ ...typed, projectId: openId || '', addedByEmail: user?.email || null })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      setTyped({ task: '', assignee: 'Unassigned', priority: 'normal', due_date: '' })
      await loadWorklist()
    } catch (err) {
      setError(err.message || 'Could not add that task.')
    }
    setAddingTask(false)
  }

  /** A task from the workspace's one-line add. */
  async function addFromWorkspace(fields, cleared) {
    if (addingTask) return
    setAddingTask(true)
    setError('')
    try {
      const res = await fetch('/api/meetings/agent?action=add-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ priority: 'normal', ...fields, addedByEmail: user?.email || null })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      cleared?.()
      await loadWorklist()
    } catch (err) {
      setError(err.message || 'Could not add that task.')
    }
    setAddingTask(false)
  }

  // Mine is "assigned to me", not "I added it". Somebody who pastes a
  // transcript is not thereby responsible for everything in it.
  // Matched tolerantly: an item assigned before Mat was renamed from "Matthew
  // Usher" in October is still his, and a to-do list that quietly drops half
  // somebody's work is worse than no to-do list.
  const me = STAFF.find(p => p.email === user?.email)
  const mine = worklist
    .filter(it => !it.archived)
    .filter(it => me ? isSameStaff(it.assignee, me) : it.assignee === user?.name)
  const mineCount = mine.filter(it => it.status !== 'done').length

  // ── What the render needs ──

  /** Every project a task can belong to, General included. */
  const allProjects = [...projects, GENERAL]
  const projectFor = task =>
    allProjects.find(p => p.id === projectIdOf(task)) || GENERAL

  /** The board on screen, or nothing when the list is. */
  const board = openId ? allProjects.find(p => p.id === openId) || null : null
  const openTask = openTaskId ? worklist.find(it => it.id === openTaskId) : null

  // Mid-flow beats whatever tab was last tapped. Switching away from a meeting
  // that is recording would stop it, which is not what tapping "Projects"
  // means by any reading.
  const capturing = phase !== 'idle'
  const at = capturing ? 'capture' : view

  return (
    <Page>
      {/* A phone gets the short band — the page under it is the list (Brent,
          6 Nov 2026: "way too busy"). */}
      <Header eyebrow={wide ? 'Team' : undefined} title="Projects" compact={!wide}
        subtitle={board ? board.name : wide ? 'Projects, tasks and what was agreed' : undefined}
        onBack={board ? () => setOpenId(null) : onBack} />

      <div className="tm-measure" style={{ padding: 16 }}>
        {error && (
          <div style={{ background: colour.dangerSoft, color: colour.danger, padding: '12px 14px', borderRadius: 10, marginBottom: 12, fontSize: 14 }}>
            {error}
          </div>
        )}

        {at === 'capture' && (<>
        {/* Recording panel */}
        {(phase === 'idle' || phase === 'recording') && (
          <div style={{ background: 'white', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid rgba(26,43,74,0.08)' }}>
            {phase === 'idle' && (
              <>
                <div style={{ fontSize: 16, fontWeight: 700, color: colour.navy, marginBottom: 10 }}>New meeting</div>
                <input
                  type="text"
                  value={meetingTitle}
                  onChange={e => setMeetingTitle(e.target.value)}
                  placeholder="e.g. Spine team weekly"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 8, fontSize: 16, marginBottom: 8, boxSizing: 'border-box' }}
                />
                <input
                  type="date"
                  value={meetingDate}
                  onChange={e => setMeetingDate(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 8, fontSize: 16, marginBottom: 12, boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: 12.5, color: colour.inkFaint, marginBottom: 12, lineHeight: 1.5 }}>
                  Keep this screen open and your phone unlocked for the whole meeting — recording stops if the screen locks.
                </div>
                <button onClick={startRecording} style={{ width: '100%', padding: 13, background: colour.danger, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  ● Start recording
                </button>

                {/* ── Or give it the words some other way ──
                    
                    "Could she dump a transcript from a meeting into that
                    section and have the Claude agent build out a task and
                    action list and allocate to staff within the portal?"
                    
                    The same road from here on: text goes to the same analyse
                    step the recording uses, and lands on the same review
                    screen, so there is one place an item is checked before it
                    reaches somebody's day. */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  margin: '16px 0 12px', color: colour.inkFainter, fontSize: 12.5
                }}>
                  <span style={{ flex: 1, height: 1, background: 'rgba(26,43,74,0.1)' }} />
                  or paste what was said
                  <span style={{ flex: 1, height: 1, background: 'rgba(26,43,74,0.1)' }} />
                </div>

                <textarea
                  value={pasted}
                  onChange={e => setPasted(e.target.value)}
                  rows={5}
                  placeholder="Paste a transcript, your notes, or an email — anything that says what was agreed and who is doing it."
                  style={{
                    width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                    border: '1px solid rgba(26,43,74,0.15)', borderRadius: 8,
                    fontSize: 16, fontFamily: 'inherit', resize: 'vertical',
                    marginBottom: 8
                  }} />

                <input ref={pasteFileRef} type="file"
                  accept=".txt,.md,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  style={{ fontSize: 16, display: 'none' }}
                  onChange={e => { readFromFile(e.target.files?.[0]); e.target.value = '' }} />

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => readFromText(pasted)}
                    disabled={!pasted.trim()}
                    style={{
                      flexGrow: 1, flexShrink: 1, flexBasis: 0, padding: 13,
                      background: pasted.trim() ? colour.accent : '#c8d2dc',
                      color: 'white', border: 'none', borderRadius: 8,
                      fontSize: 14, fontWeight: 600,
                      cursor: pasted.trim() ? 'pointer' : 'default'
                    }}>
                    Build the action list
                  </button>
                  <button onClick={() => pasteFileRef.current?.click()}
                    disabled={Boolean(reading)}
                    style={{
                      flexShrink: 0, padding: '13px 16px', background: 'transparent',
                      border: '1px solid rgba(26,43,74,0.15)', borderRadius: 8,
                      fontSize: 14, fontWeight: 600, color: colour.navy,
                      cursor: reading ? 'default' : 'pointer'
                    }}>
                    {reading ? 'Reading…' : 'Or a file'}
                  </button>
                </div>
                <div style={{ fontSize: 12.5, color: colour.inkFainter, marginTop: 6 }}>
                  .txt, .docx or .pdf
                </div>
              </>
            )}
            {phase === 'recording' && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: 14, color: colour.inkFaint, marginBottom: 6 }}>{meetingTitle || 'Untitled meeting'}</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: colour.navy, fontVariantNumeric: 'tabular-nums', marginBottom: 16 }}>
                  <span style={{ color: colour.danger }}>●</span> {formatElapsed(elapsed)}
                </div>
                <button onClick={stopRecording} style={{ width: '100%', padding: 13, background: colour.navy, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  ■ Stop & send to agent
                </button>
              </div>
            )}
          </div>
        )}

        {['uploading', 'transcribing', 'analyzing', 'sending'].includes(phase) && (
          <div style={{ background: 'white', borderRadius: 12, padding: 32, marginBottom: 16, textAlign: 'center', border: '1px solid rgba(26,43,74,0.08)' }}>
            <div style={{ fontSize: 14, color: colour.navy, fontWeight: 600, marginBottom: 4 }}>
              {phase === 'uploading' && 'Uploading recording…'}
              {phase === 'transcribing' && 'Transcribing the meeting…'}
              {phase === 'analyzing' && 'Drafting minutes and action items…'}
              {phase === 'sending' && 'Sending minutes to the team…'}
            </div>
            <div style={{ fontSize: 12.5, color: colour.inkFaint }}>This can take a few minutes for longer meetings.</div>
          </div>
        )}

        {phase === 'reviewing' && (
          <div style={{ background: 'white', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid rgba(26,43,74,0.08)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: colour.navy, marginBottom: 6 }}>Review before sending</div>
            {/* A list that is quietly shorter than the meeting is worse than
                an error: nobody goes looking for the items that are not
                there. This is what "unterminated string in JSON at position
                6964" should have said. */}
            {truncated && (
              <div style={{
                background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
                borderRadius: 8, padding: '10px 12px', marginBottom: 12,
                fontSize: 12.5, color: colour.ink, lineHeight: 1.5
              }}>
                That was a long one and the agent ran out of room, so the end of
                the list may be missing. What is here is complete — check the
                last few against your notes, and paste the rest separately if
                anything is short.
              </div>
            )}
            <div style={{ fontSize: 14, color: colour.inkFaint, lineHeight: 1.5, marginBottom: 14 }}>{summary}</div>

            {draftItems.length === 0 && (
              <div style={{ fontSize: 14, color: colour.inkFaint, textAlign: 'center', padding: '16px 0' }}>No action items found in this meeting.</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {draftItems.map(it => (
                <div key={it._localId} style={{ background: '#f8f9fc', borderRadius: 8, padding: 12 }}>
                  {/* "The same action comes up at the weekly meeting three
                      weeks running." Flagged against what is still open, and
                      never merged: two tasks that read alike are sometimes two
                      different jobs, and the person reading both can tell
                      where the app cannot. Dismiss it by deleting the draft —
                      which is the ✕ already beside it. */}
                  {it.possibleRepeatOf && (
                    <div style={{
                      background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
                      borderRadius: 6, padding: '7px 9px', marginBottom: 8,
                      fontSize: 12.5, color: colour.ink, lineHeight: 1.45
                    }}>
                      Already on the list:{' '}
                      <strong style={{ fontWeight: 700 }}>{it.possibleRepeatOf.task}</strong>
                      {it.possibleRepeatOf.assignee && it.possibleRepeatOf.assignee !== 'Unassigned'
                        ? ` · ${it.possibleRepeatOf.assignee}` : ''}
                      {it.possibleRepeatOf.sourceMeetingDate
                        ? ` · from ${formatDate(it.possibleRepeatOf.sourceMeetingDate)}` : ''}
                      . Still open — delete this one if it is the same job.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      value={it.task}
                      onChange={e => updateDraft(it._localId, 'task', e.target.value)}
                      style={{ flex: 1, padding: '8px 10px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 6, fontSize: 16, fontWeight: 500 }}
                    />
                    <button onClick={() => removeDraft(it._localId)} style={{ background: 'none', border: 'none', color: '#aab0bb', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    <select value={it.assignee} onChange={e => updateDraft(it._localId, 'assignee', e.target.value)}
                      style={{ padding: '6px 8px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 6, fontSize: 16 }}>
                      <option value="Unassigned">Unassigned</option>
                      {STAFF.map(s => <option key={s.email} value={s.name}>{s.name}</option>)}
                    </select>
                    <select value={it.priority} onChange={e => updateDraft(it._localId, 'priority', e.target.value)}
                      style={{ padding: '6px 8px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 6, fontSize: 16, color: PRIORITY_COLORS[it.priority] }}>
                      {Object.keys(PRIORITY_LABELS).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select>
                    <input type="date" value={it.due_date} onChange={e => updateDraft(it._localId, 'due_date', e.target.value)}
                      style={{ padding: '6px 8px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 6, fontSize: 16 }} />
                  </div>
                  {it.notes && <div style={{ fontSize: 12.5, color: colour.inkFaint, marginTop: 6 }}>{it.notes}</div>}
                </div>
              ))}
            </div>

            <button onClick={sendToTeam} style={{ width: '100%', padding: 13, background: '#1a7a6e', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 14 }}>
              Send minutes & action items to team
            </button>
            <button onClick={resetFlow} style={{ width: '100%', padding: 10, background: 'transparent', color: colour.inkFaint, border: 'none', fontSize: 14, cursor: 'pointer', marginTop: 4 }}>
              Discard
            </button>
          </div>
        )}

        {phase === 'sent' && (
          <div style={{ background: 'white', borderRadius: 12, padding: 24, marginBottom: 16, textAlign: 'center', border: '1px solid rgba(26,43,74,0.08)' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: colour.navy, marginBottom: 4 }}>Minutes sent</div>
            <div style={{ fontSize: 14, color: colour.inkFaint, marginBottom: 16 }}>
              {sentResult?.itemCount || 0} action item{sentResult?.itemCount === 1 ? '' : 's'} added to the worklist and emailed to the team.
            </div>
            <button onClick={resetFlow} style={{ padding: '10px 20px', background: colour.navy, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Record another meeting
            </button>
          </div>
        )}
        </>)}

        {/* ── Where you are ──

            Three screens of one set of data. Projects answers "what is going
            on"; Mine is the four things that are actually yours, which is what
            somebody between cases came for; Capture is how work gets in. A
            project opened replaces all three — a phone has room for one. */}
        {/* "Unterminated string in JSON at position 6964" used to take the
            whole page with it. Now it costs one row, and says which. */}
        {unreadable.length > 0 && (
          <div style={{
            background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
            borderRadius: radius.control, padding: `${space.sm}px ${space.md}px`,
            marginBottom: space.md, ...text('caption'), color: colour.ink, lineHeight: 1.5
          }}>
            {unreadable.length === 1 ? 'One item' : `${unreadable.length} items`} could
            not be read and {unreadable.length === 1 ? 'is' : 'are'} not shown below.
            Everything else on this page is complete. Send this to Brenton:{' '}
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>
              {unreadable.join(', ')}
            </span>
          </div>
        )}

        {/* On a phone, one row of three: your list, the projects, a meeting.
            It used to be two rows of tabs, one inside the other. */}
        {!board && !wide && (
          <div role="tablist" aria-label="Projects" style={{ display: 'flex', gap: 4, background: colour.lineSoft, borderRadius: radius.control, padding: 4, marginBottom: space.md }}>
            {[['todo', 'My To Do'], ['projects', 'Projects'], ['capture', 'Meeting']].map(([key, label]) => {
              const on = key === 'capture' ? at === 'capture' : at === 'projects' && phoneTab === key
              return (
                <button key={key} type="button" role="tab" aria-selected={on}
                  onClick={() => { if (key === 'capture') setView('capture'); else { setView('projects'); choosePhoneTab(key) } }}
                  style={{
                    ...text('bodyStrong'), flex: 1, minHeight: 44, border: 'none', borderRadius: radius.control - 2, cursor: 'pointer',
                    background: on ? colour.surface : 'transparent', color: on ? colour.ink : colour.inkFaint
                  }}>{label}</button>
              )
            })}
          </div>
        )}

        {!board && wide && (
          <div style={{ display: 'flex', gap: 6, marginBottom: space.md }} role="tablist">
            {[
              ['projects', `Projects and tasks${mineCount ? ` · ${mineCount} yours` : ''}`],
              ['capture', 'Capture a meeting']
            ].map(([key, label]) => (
              <button key={key} role="tab" aria-selected={at === key}
                onClick={() => setView(key)}
                style={{
                  ...text('bodyStrong'),
                  flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 38,
                  borderRadius: radius.control, cursor: 'pointer',
                  border: at === key ? 'none' : `1px solid ${colour.line}`,
                  background: at === key ? colour.navy : colour.surface,
                  color: at === key ? 'white' : colour.inkFaint
                }}>{label}</button>
            ))}
          </div>
        )}

        {loadingBoard && !board && (
          <div style={{ ...text('body'), textAlign: 'center', padding: space.xxl, color: colour.inkFainter }}>
            Loading…
          </div>
        )}

        {/* ── One project ── */}
        {board && (
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.md
            }}>
              <span aria-hidden="true" style={{
                width: 10, height: 10, borderRadius: radius.pill,
                background: tintOf(board.colour).solid, flexShrink: 0
              }} />
              <span style={{ ...text('title'), color: colour.ink, flex: 1, minWidth: 0 }}>
                {board.name}
              </span>
              {!board.fixed && (
                <select value={board.division || ''} aria-label="Division"
                  onChange={e => patchProject(board.id, { division: e.target.value })}
                  style={{
                    ...text('field'), border: `1px solid ${colour.line}`, borderRadius: radius.control,
                    padding: '4px 8px', background: colour.surface, color: colour.inkMuted, maxWidth: 170
                  }}>
                  <option value="">Whole business</option>
                  {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              {!board.fixed && (
                <button type="button"
                  onClick={async () => {
                    const ok = await patchProject(board.id, { archive: !board.archived })
                    if (ok && !board.archived) setOpenId(null)
                  }}
                  style={{
                    ...text('caption'), background: 'none', border: `1px solid ${colour.line}`,
                    borderRadius: radius.control, padding: '6px 10px',
                    color: colour.inkFaint, cursor: 'pointer'
                  }}>
                  {board.archived ? 'Bring back' : 'Archive'}
                </button>
              )}
            </div>

            {/* A task straight onto this board. Whoever typed it is the
                review — there is nothing for a model to extract from a
                sentence somebody has already written as a task. */}
            <div style={{
              background: colour.surface, borderRadius: radius.card,
              border: `1px solid ${colour.line}`, padding: space.md, marginBottom: space.md
            }}>
              <input
                value={typed.task}
                onChange={e => setTyped(t => ({ ...t, task: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addTypedTask() }}
                placeholder="Add a task…"
                style={{
                  ...text('field'), width: '100%', boxSizing: 'border-box',
                  padding: `${space.sm}px ${space.md}px`,
                  border: `1px solid ${colour.line}`, borderRadius: radius.control
                }} />
              {typed.task.trim() && (
                <div style={{ display: 'flex', gap: 6, marginTop: space.sm, flexWrap: 'wrap' }}>
                  <select value={typed.assignee}
                    onChange={e => setTyped(t => ({ ...t, assignee: e.target.value }))}
                    aria-label="Who has it"
                    style={{
                      ...text('field'), flexGrow: 1, flexShrink: 1, flexBasis: 0,
                      padding: '8px 10px', border: `1px solid ${colour.line}`, borderRadius: 6
                    }}>
                    <option value="Unassigned">Unassigned</option>
                    {STAFF.map(p => <option key={p.email} value={p.name}>{p.name}</option>)}
                  </select>
                  <input type="date" value={typed.due_date} aria-label="Due"
                    onChange={e => setTyped(t => ({ ...t, due_date: e.target.value }))}
                    style={{
                      ...text('field'), flexShrink: 0, padding: '8px 10px',
                      border: `1px solid ${colour.line}`, borderRadius: 6
                    }} />
                  <button onClick={addTypedTask} disabled={addingTask}
                    style={{
                      ...text('bodyStrong'), flexShrink: 0, padding: '8px 16px',
                      background: colour.accent, color: 'white', border: 'none',
                      borderRadius: 6, cursor: addingTask ? 'default' : 'pointer'
                    }}>
                    {addingTask ? 'Adding…' : 'Add'}
                  </button>
                </div>
              )}
            </div>

            <ProjectBoard
              project={board} items={worklist} wide={wide} today={today}
              onOpen={t => setOpenTaskId(t.id)}
              onMove={moveTask}
              onRenameColumn={(key, label) => changeColumn('PATCH', { key, label })}
              onAddColumn={label => changeColumn('POST', { label })}
              onRemoveColumn={key => changeColumn('DELETE', { key })} />
          </div>
        )}

        {/* ── Everything, as one workspace ── */}
        {/* Suggested to-dos from email and the portal's own checks, above the
            list on a phone and the table on a desktop alike. Draws nothing for
            anyone not on the trial. See projects/Suggested.jsx. */}
        {!board && at === 'projects' && !loadingBoard && (
          <Suggested user={user} today={today} onAdded={loadWorklist} />
        )}
        {!board && at === 'projects' && !loadingBoard && (
          <Workspace
            projects={projects} items={worklist} user={user} today={today} wide={wide}
            onOpenProject={p => setOpenId(p.id)}
            onOpenTask={t => setOpenTaskId(t.id)}
            onMove={moveTask}
            onCreateProject={createProject}
            busyProject={savingProject}
            onAdd={addFromWorkspace}
            adding={addingTask}
            phoneTab={phoneTab} />
        )}
      </div>

      {/* One task, opened. Over the top rather than pushed, because you come
          back to the same place on the same board every time. */}
      {openTask && (
        <Overlay>
          {/* Overlay is only a portal — it puts this at the end of
              document.body and positions nothing. Without a fixed backdrop the
              sheet renders below #root, which is exactly the height of the
              viewport, so it opens off-screen and the tap looks dead. jsdom has
              no layout, so nothing here would have caught it but the guard in
              sheets.test.jsx. */}
          <div onClick={() => setOpenTaskId(null)} style={{
            position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)',
            zIndex: 3000, display: 'flex', alignItems: 'flex-end',
            justifyContent: 'center', overflowY: 'auto', overflowX: 'hidden'
          }}>
          <div onClick={e => e.stopPropagation()} className="tm-sheet"
            style={{ width: '100%', maxWidth: 520, padding: space.md }}>
            <TaskSheet
              task={openTask}
              project={projectFor(openTask)}
              projects={[...projects.filter(p => !p.archived), GENERAL]}
              onChange={patchTask}
              onComment={commentOnTask}
              onArchive={archiveTask}
              onDelete={t => deleteItem(t.id)}
              onClose={() => setOpenTaskId(null)} />
          </div>
          </div>
        </Overlay>
      )}
    </Page>
  )
}
