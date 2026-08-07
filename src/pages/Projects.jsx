import React, { useState, useEffect, useRef } from 'react'
import { upload } from '@vercel/blob/client'
import { STAFF } from '../staffConfig.js'

const PRIORITY_COLORS = { urgent: '#c0392b', normal: '#1a7a6e', low: '#6b7a8d' }
const PRIORITY_LABELS = { urgent: 'Urgent', normal: 'Normal', low: 'Low' }
const STATUS_COLUMNS = [
  { key: 'open', label: 'Open', icon: '○' },
  { key: 'in_progress', label: 'In progress', icon: '◐' },
  { key: 'done', label: 'Done', icon: '●' }
]

function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function Projects({ user }) {
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

  const [worklist, setWorklist] = useState([])
  const [loadingBoard, setLoadingBoard] = useState(true)

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  useEffect(() => { loadWorklist() }, [])

  async function loadWorklist() {
    setLoadingBoard(true)
    try {
      const res = await fetch('/api/meetings/agent?action=worklist')
      const data = await res.json()
      setWorklist(data.items || [])
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
        handleUploadUrl: '/api/meetings/agent?action=blob-upload'
      })

      setPhase('transcribing')
      const startRes = await fetch('/api/meetings/agent?action=start-transcription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: uploaded.url })
      })
      const startData = await startRes.json()
      if (startData.error) throw new Error(startData.error)

      const transcript = await pollTranscription(startData.transcriptId)

      setPhase('analyzing')
      const analyzeRes = await fetch('/api/meetings/agent?action=analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          const res = await fetch(`/api/meetings/agent?action=status&id=${transcriptId}`)
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
        headers: { 'Content-Type': 'application/json' },
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

  function cycleStatus(item) {
    const idx = STATUS_COLUMNS.findIndex(c => c.key === item.status)
    const next = STATUS_COLUMNS[(idx + 1) % STATUS_COLUMNS.length].key
    updateStatus(item.id, next)
  }

  async function updateStatus(id, status) {
    setWorklist(items => items.map(it => it.id === id ? { ...it, status } : it))
    try {
      await fetch('/api/meetings/agent?action=worklist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status })
      })
    } catch (err) {
      console.error(err)
    }
  }

  async function deleteItem(id) {
    setWorklist(items => items.filter(it => it.id !== id))
    try {
      await fetch(`/api/meetings/agent?action=worklist&id=${id}`, { method: 'DELETE' })
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f3f7', fontFamily: '-apple-system,sans-serif' }}>
      <div style={{ background: '#042746', paddingTop: 56, paddingLeft: 20, paddingRight: 20, paddingBottom: 20 }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height: 40, width: 'auto', marginBottom: 4 }} />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>Projects</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>Meeting notes & action items</div>
      </div>

      <div style={{ padding: 16 }}>
        {error && (
          <div style={{ background: '#fdecea', color: '#c0392b', padding: '12px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Recording panel */}
        {(phase === 'idle' || phase === 'recording') && (
          <div style={{ background: 'white', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid rgba(26,43,74,0.08)' }}>
            {phase === 'idle' && (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#042746', marginBottom: 10 }}>New meeting</div>
                <input
                  type="text"
                  value={meetingTitle}
                  onChange={e => setMeetingTitle(e.target.value)}
                  placeholder="e.g. Spine team weekly"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }}
                />
                <input
                  type="date"
                  value={meetingDate}
                  onChange={e => setMeetingDate(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: 12, color: '#6b7a8d', marginBottom: 12, lineHeight: 1.5 }}>
                  Keep this screen open and your phone unlocked for the whole meeting — recording stops if the screen locks.
                </div>
                <button onClick={startRecording} style={{ width: '100%', padding: 13, background: '#c0392b', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  ● Start recording
                </button>
              </>
            )}
            {phase === 'recording' && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: 13, color: '#6b7a8d', marginBottom: 6 }}>{meetingTitle || 'Untitled meeting'}</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: '#042746', fontVariantNumeric: 'tabular-nums', marginBottom: 16 }}>
                  <span style={{ color: '#c0392b' }}>●</span> {formatElapsed(elapsed)}
                </div>
                <button onClick={stopRecording} style={{ width: '100%', padding: 13, background: '#042746', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  ■ Stop & send to agent
                </button>
              </div>
            )}
          </div>
        )}

        {['uploading', 'transcribing', 'analyzing', 'sending'].includes(phase) && (
          <div style={{ background: 'white', borderRadius: 12, padding: 32, marginBottom: 16, textAlign: 'center', border: '1px solid rgba(26,43,74,0.08)' }}>
            <div style={{ fontSize: 14, color: '#042746', fontWeight: 600, marginBottom: 4 }}>
              {phase === 'uploading' && 'Uploading recording…'}
              {phase === 'transcribing' && 'Transcribing the meeting…'}
              {phase === 'analyzing' && 'Drafting minutes and action items…'}
              {phase === 'sending' && 'Sending minutes to the team…'}
            </div>
            <div style={{ fontSize: 12, color: '#6b7a8d' }}>This can take a few minutes for longer meetings.</div>
          </div>
        )}

        {phase === 'reviewing' && (
          <div style={{ background: 'white', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid rgba(26,43,74,0.08)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#042746', marginBottom: 6 }}>Review before sending</div>
            <div style={{ fontSize: 13, color: '#6b7a8d', lineHeight: 1.5, marginBottom: 14 }}>{summary}</div>

            {draftItems.length === 0 && (
              <div style={{ fontSize: 13, color: '#6b7a8d', textAlign: 'center', padding: '16px 0' }}>No action items found in this meeting.</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {draftItems.map(it => (
                <div key={it._localId} style={{ background: '#f8f9fc', borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      value={it.task}
                      onChange={e => updateDraft(it._localId, 'task', e.target.value)}
                      style={{ flex: 1, padding: '8px 10px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 6, fontSize: 13, fontWeight: 500 }}
                    />
                    <button onClick={() => removeDraft(it._localId)} style={{ background: 'none', border: 'none', color: '#aab0bb', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    <select value={it.assignee} onChange={e => updateDraft(it._localId, 'assignee', e.target.value)}
                      style={{ padding: '6px 8px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 6, fontSize: 12 }}>
                      <option value="Unassigned">Unassigned</option>
                      {STAFF.map(s => <option key={s.email} value={s.name}>{s.name}</option>)}
                    </select>
                    <select value={it.priority} onChange={e => updateDraft(it._localId, 'priority', e.target.value)}
                      style={{ padding: '6px 8px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 6, fontSize: 12, color: PRIORITY_COLORS[it.priority] }}>
                      {Object.keys(PRIORITY_LABELS).map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select>
                    <input type="date" value={it.due_date} onChange={e => updateDraft(it._localId, 'due_date', e.target.value)}
                      style={{ padding: '6px 8px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 6, fontSize: 12 }} />
                  </div>
                  {it.notes && <div style={{ fontSize: 11, color: '#6b7a8d', marginTop: 6 }}>{it.notes}</div>}
                </div>
              ))}
            </div>

            <button onClick={sendToTeam} style={{ width: '100%', padding: 13, background: '#1a7a6e', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 14 }}>
              Send minutes & action items to team
            </button>
            <button onClick={resetFlow} style={{ width: '100%', padding: 10, background: 'transparent', color: '#6b7a8d', border: 'none', fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
              Discard
            </button>
          </div>
        )}

        {phase === 'sent' && (
          <div style={{ background: 'white', borderRadius: 12, padding: 24, marginBottom: 16, textAlign: 'center', border: '1px solid rgba(26,43,74,0.08)' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#042746', marginBottom: 4 }}>Minutes sent</div>
            <div style={{ fontSize: 13, color: '#6b7a8d', marginBottom: 16 }}>
              {sentResult?.itemCount || 0} action item{sentResult?.itemCount === 1 ? '' : 's'} added to the worklist and emailed to the team.
            </div>
            <button onClick={resetFlow} style={{ padding: '10px 20px', background: '#042746', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Record another meeting
            </button>
          </div>
        )}

        {/* Worklist board */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#042746' }}>Worklist</div>
          <div style={{ fontSize: 11, color: '#6b7a8d' }}>{worklist.length} item{worklist.length === 1 ? '' : 's'}</div>
        </div>

        {loadingBoard ? (
          <div style={{ textAlign: 'center', padding: 30, color: '#aab0bb', fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {STATUS_COLUMNS.map(col => {
              const items = worklist.filter(w => w.status === col.key)
              return (
                <div key={col.key} style={{ background: 'white', borderRadius: 12, border: '1px solid rgba(26,43,74,0.08)', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(26,43,74,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12 }}>{col.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#042746', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{col.label}</span>
                    <span style={{ fontSize: 11, color: '#aab0bb', marginLeft: 'auto' }}>{items.length}</span>
                  </div>
                  <div style={{ padding: 10 }}>
                    {items.length === 0 && <div style={{ fontSize: 12, color: '#aab0bb', textAlign: 'center', padding: '10px 0' }}>Nothing here</div>}
                    {items.map(it => (
                      <div key={it.id} onClick={() => cycleStatus(it)} style={{ background: '#f8f9fc', borderRadius: 8, padding: 10, marginBottom: 8, cursor: 'pointer', borderLeft: `3px solid ${PRIORITY_COLORS[it.priority] || '#6b7a8d'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#042746' }}>{it.task}</div>
                          <button onClick={e => { e.stopPropagation(); deleteItem(it.id) }} style={{ background: 'none', border: 'none', color: '#aab0bb', fontSize: 13, cursor: 'pointer', padding: '0 0 0 8px' }}>✕</button>
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7a8d', marginTop: 4 }}>
                          {it.assignee}{it.due_date ? ` · Due ${formatDate(it.due_date)}` : ''}
                        </div>
                        <div style={{ fontSize: 10, color: '#aab0bb', marginTop: 4 }}>from {it.sourceMeetingTitle} · {formatDate(it.sourceMeetingDate)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
