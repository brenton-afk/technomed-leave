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
import { openTaskBrief, cleanSuggestions, suggestionPrompt, readJsonObject } from '../src/projects/liveMeeting.js'

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
    if (live && live.status === 'live') return live
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
    if (!l || l.status !== 'live') return null
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
  return rest
}
