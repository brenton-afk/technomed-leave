import { applyUsageFix } from './_usageFixes.js'
import { STAFF } from '../src/staffConfig.js'
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

// Single Upstash REST helper for the whole API surface. Values travel as URL
// path segments, so every argument must be encoded — callers pass raw strings.
export async function redis(command, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not configured')
  }
  const path = args.map(a => encodeURIComponent(a)).join('/')
  const res = await fetch(`${REDIS_URL}/${command}/${path}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  })
  const data = await res.json()
  if (data.error) throw new Error(`Redis ${command} failed: ${data.error}`)
  return data.result
}

// ─── LEAVE APPLICATIONS (existing) ─────────────────────────

// SET with the value in the request body instead of the URL path. Upstash puts
// path-form values in the URL, which caps how much you can store before the
// request line gets too long — use this for anything that can grow (a case with
// dozens of line items, a long transcript).
export async function redisSetBody(key, value) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not configured')
  }
  const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: value
  })
  const data = await res.json()
  if (data.error) throw new Error(`Redis set failed: ${data.error}`)
  return data.result
}

export async function saveApplication(id, application) {
  await redisSetBody(`leave:${id}`, JSON.stringify(application))
  await redis('lpush', 'leave:pending', id)
}

export async function getApplication(id) {
  const data = await redis('get', `leave:${id}`)
  return data ? JSON.parse(data) : null
}

export async function getPendingApplications() {
  const ids = await redis('lrange', 'leave:pending', '0', '-1') || []
  const applications = await Promise.all(ids.map(id => getApplication(id)))
  return applications.filter(Boolean)
}

export async function updateApplicationStatus(id, status, reason = '') {
  const app = await getApplication(id)
  if (!app) throw new Error('Application not found')
  app.status = status
  app.declineReason = reason
  app.updatedAt = new Date().toISOString()
  await redisSetBody(`leave:${id}`, JSON.stringify(app))
  await redis('lrem', 'leave:pending', '0', id)
  await redis('lpush', `leave:${status}`, id)
  return app
}

export async function getAllApplications() {
  const pending = await getPendingApplications()
  const approvedIds = await redis('lrange', 'leave:approved', '0', '49') || []
  const declinedIds = await redis('lrange', 'leave:declined', '0', '49') || []
  const approved = await Promise.all(approvedIds.map(id => getApplication(id)))
  const declined = await Promise.all(declinedIds.map(id => getApplication(id)))
  return {
    pending,
    approved: approved.filter(Boolean),
    declined: declined.filter(Boolean)
  }
}

// ─── MEETINGS ───────────────────────────────────────────────

// In the request body, not the URL. A meeting's transcript and notes run to
// thousands of characters, and through the URL path the value was cut off —
// which is the "Unterminated string in JSON" Erin saw on the Projects page.
export async function saveMeeting(id, meeting) {
  await redisSetBody(`meeting:${id}`, JSON.stringify(meeting))
  await redis('lpush', 'meeting:all', id)
}

export async function getMeeting(id) {
  const data = await redis('get', `meeting:${id}`)
  if (!data) return null
  try {
    return JSON.parse(data)
  } catch {
    // Saved before meetings went through the request body, and cut off on
    // the way in. One damaged record must not take the whole Projects page
    // down with it, so it is left out rather than thrown.
    return null
  }
}

export async function getAllMeetings(limit = 25) {
  const ids = await redis('lrange', 'meeting:all', '0', String(limit - 1)) || []
  const meetings = await Promise.all(ids.map(id => getMeeting(id)))
  return meetings.filter(Boolean)
}

export async function updateMeetingStatus(id, status, actionItems) {
  const meeting = await getMeeting(id)
  if (!meeting) throw new Error('Meeting not found')
  meeting.status = status
  if (actionItems) meeting.actionItems = actionItems
  meeting.updatedAt = new Date().toISOString()
  await redisSetBody(`meeting:${id}`, JSON.stringify(meeting))
  return meeting
}

// ─── WORKLIST (action items) ───────────────────────────────

export async function saveWorklistItem(item) {
  // Body form, not path form: a task carries a thread of updates now, and a
  // long one outgrows what fits in a request line.
  await redisSetBody(`worklist:${item.id}`, JSON.stringify(item))
  await redis('lrem', 'worklist:all', '0', item.id)
  await redis('lpush', 'worklist:all', item.id)
}

export async function getWorklistItem(id) {
  const data = await redis('get', `worklist:${id}`)
  return data ? JSON.parse(data) : null
}

/**
 * One stored row, or nothing.
 *
 * "Unterminated string in JSON at position 6964" took out the whole Projects
 * page. One row that cannot be read should cost one row — a board of thirty
 * tasks that refuses to draw because of one of them is thirty tasks nobody can
 * reach, and the one that broke is not even the one being looked for.
 *
 * Two things could write an unreadable row, and both are now closed: a model
 * answer that ran out of room mid-word (capped at 2,000 tokens, raised in
 * October and salvaged since), and a value long enough to be cut short on its
 * way into Redis — worklist rows went by URL path until they moved to the body
 * form. This is the third line of defence: whatever wrote it, the page opens.
 */
function readRow(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * The worklist, and anything in it that could not be read.
 *
 * `unreadable` is returned rather than swallowed. A board that quietly drops a
 * row is a board that has silently lost somebody's task, which is worse than
 * one that says so — and it is the only way anybody would learn that a row
 * needs repairing.
 */
export async function getWorklist() {
  const ids = await redis('lrange', 'worklist:all', '0', '-1') || []
  const raw = await Promise.all(ids.map(id => redis('get', `worklist:${id}`)))

  const items = []
  const unreadable = []
  raw.forEach((data, i) => {
    if (!data) return
    const row = readRow(data)
    if (row) items.push(row)
    else unreadable.push(ids[i])
  })
  return { items, unreadable }
}

export async function updateWorklistItem(id, updates) {
  const item = await getWorklistItem(id)
  if (!item) throw new Error('Worklist item not found')
  const updated = { ...item, ...updates, updatedAt: new Date().toISOString() }
  await redisSetBody(`worklist:${id}`, JSON.stringify(updated))
  return updated
}

export async function deleteWorklistItem(id) {
  await redis('del', `worklist:${id}`)
  await redis('lrem', 'worklist:all', '0', id)
}

// ─── SENT EMAIL LOG ─────────────────────────────────────────
// Capped rather than kept forever. The question this answers — "did that usage
// go, and when?" — is asked about recent sends; a log that grows without limit
// is a storage bill for data nobody reads.

const EMAIL_LOG_KEEP = 2000

export async function saveEmailLogEntry(entry) {
  await redisSetBody(`email:${entry.id}`, JSON.stringify(entry))
  await redis('lpush', 'email:all', entry.id)
  await redis('ltrim', 'email:all', '0', String(EMAIL_LOG_KEEP - 1))
}

export async function getEmailLog(limit = 200) {
  const ids = await redis('lrange', 'email:all', '0', String(Math.max(0, limit - 1))) || []
  const rows = await Promise.all(ids.map(id => redis('get', `email:${id}`)))
  return rows.map(readRow).filter(Boolean)
}

// ─── PROJECTS ───────────────────────────────────────────────
// A project owns its tasks. Stored the same way the worklist is — one key per
// row, one list of ids — because the whole board is read at once anyway and a
// nine-person company is never going to have the number of projects where
// that stops being the right answer.

export async function saveProject(project) {
  await redisSetBody(`project:${project.id}`, JSON.stringify(project))
  // Removed first so a re-save cannot leave the id in the list twice, which
  // would draw the project twice on the board.
  await redis('lrem', 'project:all', '0', project.id)
  await redis('lpush', 'project:all', project.id)
}

export async function getProject(id) {
  const data = await redis('get', `project:${id}`)
  return data ? JSON.parse(data) : null
}

export async function getProjects() {
  const ids = await redis('lrange', 'project:all', '0', '-1') || []
  const raw = await Promise.all(ids.map(id => redis('get', `project:${id}`)))
  // Same rule as the worklist: one unreadable project must not cost the board.
  return raw.map(readRow).filter(Boolean)
}

export async function deleteProject(id) {
  await redis('del', `project:${id}`)
  await redis('lrem', 'project:all', '0', id)
}

// ─── SURGEON USAGE ──────────────────────────────────────────

export async function saveUsageRecord(record) {
  // Body-form SET: a case with many line items outgrows a URL path.
  await redisSetBody(`usage:${record.id}`, JSON.stringify(record))
  // A case removed as a duplicate stays off the list, whatever saves it later
  // — otherwise an email retry on the removed scan put it straight back.
  if (record.removed) return
  await redis('lrem', 'usage:all', '0', record.id)
  await redis('lpush', 'usage:all', record.id)
}

/**
 * One send per case and distributor at a time. A double tap on Send, or two
 * phones sending the same case, otherwise both reach the distributor.
 */
export async function claimUsageSend(id, key) {
  return (await redis('set', `usage:sending:${id}:${key}`, '1', 'NX', 'EX', '120')) === 'OK'
}

export async function releaseUsageSend(id, key) {
  await redis('del', `usage:sending:${id}:${key}`).catch(() => {})
}

/**
 * Takes a duplicate case out of everything that reads usage — history, Still
 * owed, resupply matching, the duplicate checks — without erasing it. The
 * record stays, marked with who removed it, when and why, under
 * `usage:removed`. Dropbox and the sent-email log are not touched.
 */
export async function removeUsageRecord(id, removed) {
  const data = await redis('get', `usage:${id}`)
  if (!data) return null
  const record = { ...JSON.parse(data), removed }
  await redisSetBody(`usage:${id}`, JSON.stringify(record))
  await redis('lrem', 'usage:all', '0', id)
  await redis('lpush', 'usage:removed', id)
  return record
}

export async function getUsageRecord(id) {
  const data = await redis('get', `usage:${id}`)
  return data ? fixed(JSON.parse(data)) : null
}

// A record saved wrong and corrected since (api/_usageFixes.js) is put right
// the first time it is read, and saved back so it stays right.
async function fixed(record) {
  const { record: out, changed } = applyUsageFix(record)
  if (changed) await redisSetBody(`usage:${out.id}`, JSON.stringify(out)).catch(() => {})
  return out
}

// ─── RESUPPLY ────────────────────────────────────────────────
// One key per resupply document and a list of them per usage case — appended,
// never rewritten. Two people scanning resupplies for the same case at once
// each add their own entry; neither can overwrite the other, which a field on
// the usage record would have allowed. The claim key makes a double tap, or a
// retry after a dropped connection, save once.

/** True the first time an id is claimed, false ever after (for a week). */
export async function claimResupply(id) {
  return (await redis('set', `resupply:claim:${id}`, '1', 'NX', 'EX', '604800')) === 'OK'
}

/** Lets an id go again when saving it failed, so the retry is not told "already saved". */
export async function releaseResupply(id) {
  await redis('del', `resupply:claim:${id}`).catch(() => {})
}

export async function saveResupply(entry) {
  await redisSetBody(`resupply:${entry.id}`, JSON.stringify(entry))
  if (entry.usageId) await redis('rpush', `resupply:case:${entry.usageId}`, entry.id)
  await redis('lpush', 'resupply:all', entry.id)
  await redis('ltrim', 'resupply:all', '0', '499')
}

export async function getResupply(id) {
  const data = await redis('get', `resupply:${id}`)
  return data ? JSON.parse(data) : null
}

/** Every resupply recorded against a usage case, oldest first. */
export async function getCaseResupplies(usageId) {
  const ids = await redis('lrange', `resupply:case:${usageId}`, '0', '-1') || []
  const rows = await Promise.all(ids.map(id => redis('get', `resupply:${id}`)))
  return rows.map(readRow).filter(Boolean)
}

export async function getRecentResupplies(limit = 50) {
  const ids = await redis('lrange', 'resupply:all', '0', String(Math.max(0, limit - 1))) || []
  const rows = await Promise.all(ids.map(id => redis('get', `resupply:${id}`)))
  return rows.map(readRow).filter(Boolean)
}

// ─── Who has checked a filed case ────────────────────────────────────────────
// The one thing the app holds about a Dropbox folder, and deliberately the
// only thing: Dropbox owns the documents, this owns "Toni has been through
// this one". Keyed by the Dropbox path, so moving or renaming a folder loses
// the tick rather than attaching it to the wrong case — which is the safe way
// round for a clinical record.
//
// A patient surname is in that path, so this is the same grade of data as the
// documents themselves. It is never logged.

/** Marks a filed case checked, or clears it when `by` is null. */
export async function setUsageReviewed(path, by) {
  const key = `usageReview:${String(path || '').toLowerCase()}`
  if (!by) {
    await redis('del', key)
    return null
  }
  const entry = { by: String(by).toLowerCase(), at: new Date().toISOString() }
  await redisSetBody(key, JSON.stringify(entry))
  return entry
}

/**
 * Who checked each of these paths, as a map.
 *
 * One round trip for the lot rather than one per case: a patient with eleven
 * years of history would otherwise be eleven sequential calls before anything
 * appeared on screen.
 */
export async function getUsageReviews(paths) {
  const list = (paths || []).filter(Boolean)
  if (!list.length) return {}
  const keys = list.map(p => `usageReview:${String(p).toLowerCase()}`)
  const values = await redis('mget', ...keys)
  const out = {}
  list.forEach((path, i) => {
    const raw = Array.isArray(values) ? values[i] : null
    if (!raw) return
    try { out[path] = JSON.parse(raw) } catch { /* a value we did not write */ }
  })
  return out
}

// ─── TIMESHEETS ─────────────────────────────────────────────

const timesheetKey = (status, email, periodStart) =>
  status === 'draft' ? `timesheet:draft:${email}` : `timesheet:${status}:${email}:${periodStart}`

export async function saveTimesheetDraft(email, draft) {
  await redisSetBody(timesheetKey('draft', email), JSON.stringify(draft))
}

export async function getTimesheetDraft(email) {
  const data = await redis('get', timesheetKey('draft', email))
  return data ? JSON.parse(data) : null
}

export async function clearTimesheetDraft(email) {
  await redis('del', timesheetKey('draft', email))
}

// Submitted and approved records are keyed by period so a fortnight can be
// looked up directly, with an index list for the admin view.
export async function saveTimesheet(status, record) {
  const key = timesheetKey(status, record.email, record.periodStart)
  await redisSetBody(key, JSON.stringify(record))
  await redis('lrem', 'timesheet:index', '0', key)
  await redis('lpush', 'timesheet:index', key)
}

export async function getTimesheet(status, email, periodStart) {
  const data = await redis('get', timesheetKey(status, email, periodStart))
  return data ? JSON.parse(data) : null
}

export async function getAllTimesheets(limit = 100) {
  const keys = await redis('lrange', 'timesheet:index', '0', String(limit - 1)) || []
  const records = await Promise.all(keys.map(async k => {
    const data = await redis('get', k)
    return data ? JSON.parse(data) : null
  }))
  return records.filter(Boolean)
}

export async function getUsageHistory(limit = 50) {
  const ids = await redis('lrange', 'usage:all', '0', String(limit - 1)) || []
  const records = await Promise.all(ids.map(id => getUsageRecord(id)))
  return records.filter(Boolean)
}


// ─── TEAM LEADER RUN-SHEET ─────────────────────────────────
// The duty leader's daily checklist, shared rather than private: the role runs
// on a weekly rotation and the whole point of publishing it is that anyone can
// see the day's duties are done — that the evening sweep happened, that
// tomorrow's lists went out.
//
// Stored as a Redis hash, one field per checklist item, and that is a
// correctness decision rather than a stylistic one. Reading a whole JSON blob,
// adding a tick and writing it back loses a tick whenever two people are on the
// run-sheet at once — which is exactly when it matters, at a handover. HSET
// writes one field, so concurrent ticks on different items cannot collide.

// Kept long enough to answer "did anyone do the evening sweep on the 3rd?" and
// no longer. A run-sheet is a working document, not a record anyone audits.
const RUNSHEET_TTL_SECONDS = 90 * 24 * 60 * 60

const runsheetKey = date => `runsheet:${date}`

/**
 * Every tick for a Hobart day, as `{ [itemId]: { by, at } }`.
 *
 * Upstash returns HGETALL either as a flat [field, value, field, value] array or
 * as an object, depending on the endpoint version. Both are handled because
 * getting it wrong presents as an empty run-sheet, which looks exactly like a
 * day nobody has started.
 */
export async function getRunsheet(date) {
  const raw = await redis('hgetall', runsheetKey(date))
  const ticks = {}
  const record = (field, value) => {
    try { ticks[field] = JSON.parse(value) } catch { /* skip a malformed field */ }
  }
  if (Array.isArray(raw)) {
    for (let i = 0; i + 1 < raw.length; i += 2) record(raw[i], raw[i + 1])
  } else if (raw && typeof raw === 'object') {
    for (const [field, value] of Object.entries(raw)) record(field, value)
  }
  return ticks
}

/** Marks one item done, recording who and when. */
export async function tickRunsheetItem(date, itemId, by, at = new Date().toISOString()) {
  const key = runsheetKey(date)
  await redis('hset', key, itemId, JSON.stringify({ by, at }))
  // Refreshed on every write rather than set once, so a day being worked on
  // cannot expire underneath the person working on it.
  await redis('expire', key, String(RUNSHEET_TTL_SECONDS))
  return { by, at }
}

/** Unticks one item. Mistakes happen, and a checklist you cannot correct gets ignored. */
export async function untickRunsheetItem(date, itemId) {
  await redis('hdel', runsheetKey(date), itemId)
}

// ─── BOOKING REVIEW QUEUE ───────────────────────────────────
// Bookings read out of the mailbox land here, never straight on the calendar.
// A parser that is right nine times in ten still puts a wrong case in front of a
// surgeon once a fortnight, and a wrong booking costs more than a missing one:
// somebody drives to the wrong hospital, or the kit does not arrive. So every
// candidate waits for a person to look at it.
//
// Candidates are kept after they are accepted or dismissed rather than deleted.
// It is the only way to answer "did that booking ever come through?" when a
// hospital says they sent one, and it is how a dismissed case stays dismissed
// when the same email is read again.

const queueKey = id => `bookingQueue:${id}`

/** What is known about an email that has been looked at before. */
export async function bookingEmailRecord(messageId) {
  if (!messageId) return null
  const data = await redis('get', `bookingQueue:seen:${messageId}`)
  return data ? JSON.parse(data) : null
}

/** Whether this email has already been through the queue. */
export async function bookingEmailSeen(messageId) {
  const record = await bookingEmailRecord(messageId)
  return Boolean(record) && !record.failed
}

/** Remembers an email as read, so a re-scan does not queue it twice. */
export async function markBookingEmailSeen(messageId, count = 0, extra = {}) {
  if (!messageId) return
  // `rule: 2` marks a record written once distributors' cover requests were
  // read (see asksForCover). Older records with nothing found are looked at
  // again once, because some of them were cover requests set aside unread.
  await redis('set', `bookingQueue:seen:${messageId}`, JSON.stringify({
    at: new Date().toISOString(), count, rule: 4, ...extra
  }))
}

/**
 * Remembers that an email could not be read, and how many times.
 *
 * Retried rather than abandoned: a model call that fails once usually succeeds
 * next time, and dropping the email would lose a real booking with nothing to
 * show for it. After a few attempts it is left alone so one permanently
 * unreadable email cannot consume a slot on every run forever — and the count is
 * reported either way, so it stays visible rather than becoming a silent gap.
 */
export const MAX_READ_ATTEMPTS = 3

export async function markBookingEmailFailed(messageId, message = '') {
  if (!messageId) return 0
  const previous = await bookingEmailRecord(messageId)
  const attempts = (previous?.attempts || 0) + 1
  await redis('set', `bookingQueue:seen:${messageId}`, JSON.stringify({
    at: new Date().toISOString(),
    failed: attempts < MAX_READ_ATTEMPTS,
    attempts,
    // Kept for diagnosis. Never the email's content — only why reading it broke.
    lastError: String(message).slice(0, 200)
  }))
  return attempts
}

export async function saveBookingCandidate(candidate) {
  await redisSetBody(queueKey(candidate.id), JSON.stringify(candidate))
  // A set, not a list: the same id being saved twice must not queue it twice.
  await redis('sadd', 'bookingQueue:all', candidate.id)
  return candidate
}

export async function getBookingCandidate(id) {
  const data = await redis('get', queueKey(id))
  return data ? JSON.parse(data) : null
}

/**
 * Everything in the queue, newest first.
 *
 * Accepted and dismissed candidates come back too — the caller decides what to
 * show. The queue is small by nature (a week of bookings for one distributor),
 * so there is nothing to gain by paging it.
 */
export async function getBookingQueue() {
  const ids = await redis('smembers', 'bookingQueue:all') || []
  const items = await Promise.all(ids.map(id => getBookingCandidate(id)))
  return items.filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

export async function updateBookingCandidate(id, updates) {
  const candidate = await getBookingCandidate(id)
  if (!candidate) throw new Error('That booking is no longer in the queue')
  const updated = { ...candidate, ...updates, updatedAt: new Date().toISOString() }
  await redisSetBody(queueKey(id), JSON.stringify(updated))
  return updated
}


// ─── CHAT ───────────────────────────────────────────────────
// The internal channels, and a thread on each booking. Nine people, so the
// volume is small and a list per channel is the right shape: appending is one
// command, reading the recent end is one command, and nothing has to be sorted.
//
// Kept as its own store rather than hung off the bookings. A case thread
// outlives the booking it belongs to — "why did this move?" is asked months
// later — and a booking deleted by mistake should not take the conversation
// about it with it.

const channelKey = channel => `chat:${channel}`

/** How much of a channel is kept. Nine people; this is months of talk. */
const KEEP = 500

export async function postMessage(channel, message) {
  // A running number per channel. The list is trimmed at KEEP, so its length
  // stops growing at 500 and unread counts built on it froze; this does not.
  const seq = Number(await redis('incr', `chat:count:${channel}`)) || 0
  const stored = { ...message, seq, at: message.at || new Date().toISOString() }
  await redisSetBody(`chat:msg:${stored.id}`, JSON.stringify(stored))
  await redis('lpush', channelKey(channel), stored.id)
  await redis('ltrim', channelKey(channel), '0', String(KEEP - 1))
  // So a case thread can be found without knowing it exists.
  await redis('sadd', 'chat:channels', channel)
  return stored
}

const parse = raw => { try { return raw ? JSON.parse(raw) : null } catch { return null } }

/** Messages by id in one call (MGET), in the order asked. */
export async function getMessages(ids) {
  if (!ids.length) return []
  const out = []
  for (let i = 0; i < ids.length; i += 100) {
    const raws = await redis('mget', ...ids.slice(i, i + 100).map(id => `chat:msg:${id}`)) || []
    out.push(...raws.map(parse))
  }
  return out
}

/** The most recent messages in a channel, oldest first for reading. */
export async function readChannel(channel, limit = 80) {
  const ids = await redis('lrange', channelKey(channel), '0', String(limit - 1)) || []
  return (await getMessages(ids)).filter(Boolean).reverse()
}

/** Every message id a channel still lists, newest first. */
export async function channelIds(channel) {
  return await redis('lrange', channelKey(channel), '0', String(KEEP - 1)) || []
}

/**
 * Changes one message under a short lock: a reaction, a deletion. Two people
 * reacting at the same moment each re-read the message, so neither loses the
 * other's reaction.
 */
export async function updateMessage(id, change) {
  const lock = `chat:lock:${id}`
  for (let i = 0; i < 20; i++) {
    if (await redis('set', lock, '1', 'NX', 'EX', '5') === 'OK') {
      try {
        const current = parse(await redis('get', `chat:msg:${id}`))
        if (!current) return null
        const next = change(current)
        await redisSetBody(`chat:msg:${id}`, JSON.stringify(next))
        return next
      } finally {
        await redis('del', lock).catch(() => {})
      }
    }
    await new Promise(r => setTimeout(r, 60))
  }
  throw new Error('That message is busy — try again')
}

/** Who is typing in a channel now: a hash of email to expiry time. */
export async function setTyping(channel, email, name) {
  await redis('hset', `chat:typing:${channel}`, email, `${Date.now() + 6000}|${name}`)
  await redis('expire', `chat:typing:${channel}`, '30')
}

export async function whoIsTyping(channel, except) {
  const all = hashOf(await redis('hgetall', `chat:typing:${channel}`))
  const now = Date.now()
  return Object.entries(all)
    .filter(([email, v]) => email !== except && Number(String(v).split('|')[0]) > now)
    .map(([, v]) => String(v).split('|').slice(1).join('|'))
}

/** Where everybody has read up to in one channel: email → message number. */
export async function seenIn(channel) {
  const all = hashOf(await redis('hgetall', `chat:seen:${channel}`))
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, Number(v) || 0]))
}

function hashOf(all) {
  if (!all) return {}
  if (Array.isArray(all)) {
    const out = {}
    for (let i = 0; i < all.length; i += 2) out[all[i]] = all[i + 1]
    return out
  }
  return all
}

/** How many messages each channel has ever had, for the unread counts. */
export async function channelSizes(channels) {
  const sizes = {}
  if (!channels.length) return sizes
  const counts = await redis('mget', ...channels.map(c => `chat:count:${c}`)) || []
  await Promise.all(channels.map(async (channel, i) => {
    // Channels from before the counter: their length is their count.
    sizes[channel] = Number(counts[i]) || Number(await redis('llen', channelKey(channel))) || 0
  }))
  return sizes
}

export async function knownChannels() {
  return await redis('smembers', 'chat:channels') || []
}

/**
 * Where each person has read up to, so a badge means something.
 *
 * Stored per person as a hash of channel to message count, which is enough:
 * "three since you last looked" is the useful answer and it costs one field.
 */
export async function readMarkers(email) {
  const all = await redis('hgetall', `chat:read:${email}`)
  if (!all) return {}
  if (Array.isArray(all)) {
    const out = {}
    for (let i = 0; i < all.length; i += 2) out[all[i]] = Number(all[i + 1]) || 0
    return out
  }
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, Number(v) || 0]))
}

export async function markRead(email, channel, count) {
  await redis('hset', `chat:read:${email}`, channel, String(count))
  // The same mark, kept per channel too, so "seen by" is one read.
  await redis('hset', `chat:seen:${channel}`, email, String(count))
}

// ─── PUSH SUBSCRIPTIONS ──────────────────────────────────────
// One person, several devices: the phone on the Home Screen, the laptop in the
// office. Kept as a hash keyed by endpoint so re-registering the same device
// replaces its entry rather than adding a second one — a browser reissues an
// endpoint after it expires, and without this a phone would accumulate dead
// subscriptions and be written to several times for one message.

const pushKey = email => `push:${String(email || '').trim().toLowerCase()}`

/** Every device a person has turned notifications on for. */
export async function pushSubscriptions(email) {
  const all = await redis('hgetall', pushKey(email))
  if (!all) return []
  // Upstash returns a flat [field, value, field, value] array.
  const entries = Array.isArray(all) ? all : Object.entries(all).flat()
  const found = []
  for (let i = 0; i < entries.length; i += 2) {
    try { found.push(JSON.parse(entries[i + 1])) } catch { /* a bad row is not a reason to fail */ }
  }
  return found
}

export async function savePushSubscription(email, subscription) {
  if (!subscription?.endpoint) return
  await redis('hset', pushKey(email), subscription.endpoint, JSON.stringify(subscription))
}

/**
 * Forgets one device.
 *
 * Called both when somebody turns notifications off and when the push service
 * says an endpoint is gone. A subscription that has expired will never work
 * again, and keeping it means retrying it forever.
 */
/**
 * How many devices are registered for notifications, across everybody.
 *
 * The number that separates "push is configured" from "push reaches anybody".
 * A deploy can have perfect keys and zero devices — which is the state after a
 * key rotation, and the state before anybody has turned notifications on — and
 * those look identical from the server unless somebody counts.
 */
export async function registeredDeviceCount() {
  let total = 0
  for (const person of STAFF) {
    const subs = await pushSubscriptions(person.email).catch(() => [])
    total += subs.length
  }
  return total
}

export async function removePushSubscription(email, endpoint) {
  if (!endpoint) return
  await redis('hdel', pushKey(email), endpoint)
}

// ─── THE TEAM LEADER ROTA ────────────────────────────────────
// One leader per week, keyed by that week's Monday — so the same week cannot
// have two answers however the question is asked, and last week's leader is
// still there when somebody asks who it was.
//
// Kept rather than expired. It is a small record and "who was duty leader when
// that went wrong" is a question worth being able to answer.

const leaderKey = monday => `teamLeader:${monday}`

export async function getTeamLeader(monday) {
  const data = await redis('get', leaderKey(monday))
  return data ? JSON.parse(data) : null
}

export async function setTeamLeaderFor(monday, entry) {
  await redis('set', leaderKey(monday), JSON.stringify(entry))
  return entry
}

// One day's leader, over the week's (Brent, 4 Nov 2026: "a daily editable
// tab in the days, underneath the date"). The week's rota stays the default;
// a day only has an entry when somebody changed that day.
const dayLeaderKey = date => `teamLeader:day:${date}`

export async function getDayLeaders(dates) {
  const out = {}
  await Promise.all((dates || []).map(async date => {
    const raw = await redis('get', dayLeaderKey(date))
    if (!raw) return
    try { out[date] = JSON.parse(raw) } catch { /* a corrupt entry is no entry */ }
  }))
  return out
}

export async function setDayLeader(date, entry) {
  if (!entry) { await redis('del', dayLeaderKey(date)); return null }
  await redis('set', dayLeaderKey(date), JSON.stringify(entry))
  return entry
}


// ─── TOIL opening balances ──────────────────────────────────
// Hours carried in from before the app kept the balance — set by an admin,
// usually from Xero, with a note saying where the number came from.

export async function getToilOpening(email) {
  const raw = await redis('get', `toil:opening:${String(email).toLowerCase()}`)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function setToilOpening(email, opening) {
  await redisSetBody(`toil:opening:${String(email).toLowerCase()}`, JSON.stringify(opening))
}

// ─── Chat icons and previews (Brent, 7 Nov 2026: "like WhatsApp") ─────────────

/** The newest message in each channel, for the list's preview line. */
export async function lastMessages(channels) {
  if (!channels.length) return {}
  const ids = await Promise.all(channels.map(c => redis('lindex', channelKey(c), '0').catch(() => null)))
  const found = await getMessages(ids.filter(Boolean))
  const byId = Object.fromEntries(found.filter(Boolean).map(m => [m.id, m]))
  return Object.fromEntries(channels.map((c, i) => [c, ids[i] ? byId[ids[i]] || null : null]))
}

/** Each channel's chosen icon: { emoji } or { url }. */
export async function chatIcons() {
  const all = hashOf(await redis('hgetall', 'chat:icons'))
  const out = {}
  for (const [k, v] of Object.entries(all)) { try { out[k] = JSON.parse(v) } catch { /* skip */ } }
  return out
}

export async function setChatIcon(channel, icon) {
  if (!icon) return redis('hdel', 'chat:icons', channel)
  return redis('hset', 'chat:icons', channel, JSON.stringify(icon))
}
