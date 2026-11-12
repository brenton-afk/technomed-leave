// ─── The live meeting, server side (Brent, 11 Nov 2026) ──────────────────────
// See src/projects/liveMeeting.js for what it is for. One meeting is live at a
// time, kept whole under `meeting:live`; every change to it is made under a
// short lock so two phones accepting at once cannot lose each other's tap.
// Audio is never stored: each stretch goes to AssemblyAI, the words come back
// and are kept on the meeting the way a recorded meeting's transcript already is.

import { redis, redisSetBody, getWorklist, getProjects } from './_redis.js'
import { privateIds } from './_privateBoard.js'
import { askClaude } from './_anthropic.js'
import { STAFF } from '../src/staffConfig.js'
import { openTaskBrief, cleanSuggestions, suggestionPrompt, reviewPrompt, readJsonObject } from '../src/projects/liveMeeting.js'

export const LIVE_KEY = 'meeting:live'
const LOCK_KEY = 'meeting:live:lock'
const TASKS_FRESH_MS = 5 * 60 * 1000
const MAX_LINES = 400

const nowStamp = () => new Date().toISOString()
const hobartToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Hobart' }).format(new Date())

export async function getLive() {
  const raw = await redis('get', LIVE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

async function putLive(live) {
  await redisSetBody(LIVE_KEY, JSON.stringify(live))
}

/** Runs `change(live)` under the lock and saves what it returns. */
export async function changeLive(change) {
  let got = false
  for (let i = 0; i < 20 && !got; i++) {
    got = await redis('set', LOCK_KEY, '1', 'NX', 'PX', '8000') === 'OK'
    if (!got) await new Promise(r => setTimeout(r, 150))
  }
  if (!got) { const e = new Error('Someone else is updating the meeting — try again'); e.code = 'busy'; throw e }
  try {
    const live = await getLive()
    const next = await change(live)
    if (next) await putLive(next)
    return next
  } finally {
    await redis('del', LOCK_KEY).catch(() => {})
  }
}

/** The open tasks the meeting may talk about — never a private-board one. */
export async function readOpenTasks() {
  const [{ items }, projects] = await Promise.all([getWorklist(), getProjects().catch(() => null)])
  // Projects unreadable: which are private is unknown, so every task on a
  // project is held back (the same rule as api/_privateBoard.js).
  const hidden = projects ? privateIds(projects) : { has: id => Boolean(id) }
  return openTaskBrief(items, hidden)
}

export async function startLive({ title, by, byEmail, agenda = [] }) {
  const openTasks = await readOpenTasks().catch(() => [])
  return changeLive(live => {
    // A meeting still being read or reviewed is not overwritten by a new one.
    if (live && live.status !== 'ended') return live
    return {
      id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'live',
      title: String(title || 'Team meeting').slice(0, 120),
      date: hobartToday(),
      startedAt: nowStamp(), startedBy: by, startedByEmail: byEmail,
      agenda: agenda.slice(0, 20).map(a => String(a).slice(0, 120)),
      lines: [], suggestions: [], openTasks, tasksAt: nowStamp(),
      recorder: null
    }
  })
}

/**
 * One stretch of the meeting: the words go on the transcript and the model
 * suggests what they change. The slow parts (transcription, the model) run
 * before the lock is taken.
 */
export async function addStretch({ textIn, by, recording = false, today = hobartToday() }) {
  const words = String(textIn || '').trim()
  let live = await getLive()
  if (!live || live.status !== 'live') { const e = new Error('No meeting is live'); e.code = 'none'; throw e }
  if (!words) {
    // Silence still says the phone is recording.
    if (recording) await changeLive(l => (l && l.id === live.id ? { ...l, recorder: { name: by, lastAt: nowStamp() } } : null))
    return { added: [] }
  }

  let openTasks = live.openTasks || []
  let refreshed = false
  if (Date.now() - Date.parse(live.tasksAt || 0) > TASKS_FRESH_MS) {
    openTasks = await readOpenTasks().catch(() => openTasks)
    refreshed = true
  }
  const staffNames = STAFF.map(s => s.name)
  const recent = (live.lines || []).slice(-8).map(l => l.text).join('\n')

  let raw = null
  let aiError = ''
  try {
    const answer = await askClaude({
      feature: 'live-meeting',
      whenUnavailable: 'Suggestions are paused for a moment — the words are still being kept.',
      timeoutMs: 30000,
      request: {
        model: process.env.LIVE_MEETING_MODEL || 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: suggestionPrompt({ chunk: words, recent, openTasks, staffNames, today, agenda: live.agenda || [] }) }]
      }
    })
    raw = readJsonObject((answer.content || []).find(b => b.type === 'text')?.text)
  } catch (err) {
    aiError = err.message
  }

  let added = []
  await changeLive(l => {
    if (!l || l.id !== live.id || l.status !== 'live') return null
    const at = nowStamp()
    added = raw ? cleanSuggestions(raw, { openTasks, staffNames, existing: l.suggestions || [], at }) : []
    return {
      ...l,
      lines: [...(l.lines || []), { at, by, text: words.slice(0, 4000), typed: !recording }].slice(-MAX_LINES),
      suggestions: [...(l.suggestions || []), ...added],
      ...(refreshed ? { openTasks, tasksAt: at } : {}),
      ...(recording ? { recorder: { name: by, lastAt: at } } : {})
    }
  })
  return { added, aiError: aiError || undefined }
}

/** A suggestion settled: accepted (with what was written to the board) or skipped. */
export async function settleSuggestion(id, patch) {
  let found = null
  await changeLive(l => {
    // Accepted during the meeting or in the review after it.
    if (!l || l.status === 'ended') return null
    const suggestions = (l.suggestions || []).map(s => {
      if (s.id !== id) return s
      found = { ...s, ...patch }
      return found
    })
    return found ? { ...l, suggestions } : null
  })
  return found
}

/** Claims a waiting suggestion so a double tap, or two phones, act on it once. */
export async function claimSuggestion(id) {
  return await redis('set', `meeting:live:claim:${id}`, '1', 'NX', 'EX', '86400') === 'OK'
}
export async function releaseSuggestion(id) {
  await redis('del', `meeting:live:claim:${id}`).catch(() => {})
}

export async function endLive() {
  let ended = null
  await changeLive(l => {
    if (!l) return null
    ended = { ...l, status: 'ended', endedAt: nowStamp() }
    return null
  })
  if (ended) await redis('del', LIVE_KEY)
  return ended
}

/** What a phone needs to draw the panel — never the open-task list itself. */
export function forScreen(live) {
  if (!live) return null
  const { openTasks, ...rest } = live
  // The recording's address is the server's business only.
  if (rest.final) rest.final = { ...rest.final, audioUrl: undefined, transcriptId: undefined }
  return rest
}

// ─── The whole meeting, read at the end (Brent, 12 Nov 2026) ─────────────────
// "Record the transcript and then have the transcript and discussion feed back
// into the projects page … then the report can be produced from the updated
// projects page." When the meeting ends, the phone that recorded it uploads
// the whole recording once (Vercel Blob, deleted again as soon as AssemblyAI
// has it as words); AssemblyAI writes it out with speakers; Claude reads it
// whole against every open task and offers one review list — new, done,
// changed, and a progress note for each task discussed — plus a summary.
// A transcript from elsewhere (Jamie, a Word file) goes through the same step.
// Nothing reaches the projects page until someone accepts it.

const REVIEW_LOCK = 'meeting:live:reviewing'
const CHECK_EVERY_MS = 4000

async function assembly(path, init = {}) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not configured')
  const res = await fetch(`https://api.assemblyai.com/v2/${path}`, { ...init, headers: { authorization: apiKey, 'content-type': 'application/json', ...(init.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Transcription failed (${res.status})`)
  return data
}

/** AssemblyAI's speakers as lines a person (and the model) can read. Pure. */
export function speakerTranscript(data) {
  return data?.utterances?.length
    ? data.utterances.map(u => `Speaker ${u.speaker}: ${u.text}`).join('\n')
    : String(data?.text || '')
}

/** What the live stretches heard, as one transcript — the fallback. Pure. */
export function linesTranscript(live) {
  return (live?.lines || []).map(l => `${l.typed ? `${l.by} (typed)` : 'Room'}: ${l.text}`).join('\n')
}

async function runReview(live, transcript, { today = hobartToday(), ask = askClaude } = {}) {
  const openTasks = await readOpenTasks().catch(() => live.openTasks || [])
  const staffNames = STAFF.map(s => s.name)
  const answer = await ask({
    feature: 'meeting-review',
    whenUnavailable: 'The meeting could not be read right now — try again in a minute. The transcript is kept.',
    timeoutMs: 100000,
    request: {
      model: process.env.MEETING_REVIEW_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: reviewPrompt({ transcript, openTasks, staffNames, today, agenda: live.agenda || [], title: live.title }) }]
    }
  })
  const raw = readJsonObject((answer.content || []).find(b => b.type === 'text')?.text) || {}
  return { openTasks, raw }
}

/** Puts the review on the meeting: the summary, and its items to accept. */
async function finishReview(liveId, { transcript, source, openTasks, raw, error = '' }) {
  const staffNames = STAFF.map(s => s.name)
  return changeLive(l => {
    if (!l || l.id !== liveId) return null
    const at = nowStamp()
    const added = cleanSuggestions(raw, { openTasks, staffNames, existing: l.suggestions || [], at, max: 60, phase: 'review' })
    return {
      ...l, status: 'review', openTasks, tasksAt: at,
      suggestions: [...(l.suggestions || []), ...added],
      final: { ...(l.final || {}), status: 'ready', source, transcript: String(transcript).slice(0, 200000), summary: String(raw?.summary || '').slice(0, 2000), readyAt: at, ...(error ? { error } : {}) }
    }
  })
}

/**
 * Ends the recording side of the meeting and starts the whole-meeting read:
 * from the uploaded recording, from a pasted transcript (which may start a
 * meeting of its own), or from what the live stretches heard.
 */
export async function startFinal({ audioUrl = '', transcript = '', title = '', by = '', byEmail = '', vocabulary = [] }) {
  let live = await getLive()
  if (!live && transcript) live = await startLive({ title: title || 'Imported meeting', by, byEmail })
  if (!live) { const e = new Error('No meeting is live'); e.code = 'none'; throw e }
  if (live.final?.status === 'transcribing' || live.final?.status === 'reading') return live

  if (audioUrl) {
    const started = await assembly('transcript', { method: 'POST', body: JSON.stringify({
      audio_url: audioUrl, speaker_labels: true, punctuate: true, format_text: true,
      word_boost: [...new Set(vocabulary)].slice(0, 1000), boost_param: 'default'
    }) })
    return changeLive(l => (l && l.id === live.id
      ? { ...l, status: 'finishing', final: { status: 'transcribing', transcriptId: started.id, audioUrl, source: 'recording', at: nowStamp() } }
      : null))
  }
  const text = String(transcript || '').trim() || linesTranscript(live)
  if (!text.trim()) { const e = new Error('Nothing was recorded or typed in this meeting'); e.code = 'empty'; throw e }
  await changeLive(l => (l && l.id === live.id ? { ...l, status: 'finishing', final: { status: 'reading', source: transcript ? 'import' : 'live', at: nowStamp() } } : null))
  try {
    const { openTasks, raw } = await runReview(live, text)
    return finishReview(live.id, { transcript: text, source: transcript ? 'import' : 'live', openTasks, raw })
  } catch (err) {
    await changeLive(l => (l && l.id === live.id ? { ...l, status: 'live', final: { status: 'failed', error: err.message, at: nowStamp() } } : null))
    throw err
  }
}

/**
 * Moves the end-of-meeting read on, called whenever a screen asks for the
 * meeting: checks the transcription, and once it is words, reads the meeting.
 * One screen does the reading; the others wait for it.
 */
export async function advanceFinal({ removeAudio = async () => {} } = {}) {
  const live = await getLive()
  const f = live?.final
  if (!f || f.status !== 'transcribing') return live
  if (Date.now() - Date.parse(f.checkedAt || 0) < CHECK_EVERY_MS) return live
  if (await redis('set', REVIEW_LOCK, '1', 'NX', 'EX', '150') !== 'OK') return live
  try {
    await changeLive(l => (l && l.id === live.id ? { ...l, final: { ...l.final, checkedAt: nowStamp() } } : null))
    const data = await assembly(`transcript/${f.transcriptId}`)
    if (data.status !== 'completed' && data.status !== 'error') return getLive()
    // The audio is no longer needed once it is words — or once it has failed.
    await removeAudio(f.audioUrl).catch(() => {})
    let transcript = data.status === 'completed' ? speakerTranscript(data) : ''
    let error = data.status === 'error' ? 'The recording could not be transcribed — what the live stretches heard was used instead.' : ''
    if (!transcript.trim()) { transcript = linesTranscript(live); error = error || 'The recording had no words in it — what the live stretches heard was used instead.' }
    await changeLive(l => (l && l.id === live.id ? { ...l, final: { ...l.final, status: 'reading' } } : null))
    try {
      const { openTasks, raw } = await runReview(live, transcript)
      await finishReview(live.id, { transcript, source: 'recording', openTasks, raw, error })
    } catch (err) {
      await changeLive(l => (l && l.id === live.id ? { ...l, final: { ...l.final, status: 'unread', transcript, error: err.message } } : null))
    }
    return getLive()
  } finally {
    await redis('del', REVIEW_LOCK).catch(() => {})
  }
}

/** A transcript that came back but could not be read: read it again. */
export async function retryReview() {
  const live = await getLive()
  if (!live?.final?.transcript) { const e = new Error('There is no transcript to read'); e.code = 'none'; throw e }
  const { openTasks, raw } = await runReview(live, live.final.transcript)
  return finishReview(live.id, { transcript: live.final.transcript, source: live.final.source || 'recording', openTasks, raw })
}
