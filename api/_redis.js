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
  await redis('set', `leave:${id}`, JSON.stringify(application))
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
  await redis('set', `leave:${id}`, JSON.stringify(app))
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

export async function saveMeeting(id, meeting) {
  await redis('set', `meeting:${id}`, JSON.stringify(meeting))
  await redis('lpush', 'meeting:all', id)
}

export async function getMeeting(id) {
  const data = await redis('get', `meeting:${id}`)
  return data ? JSON.parse(data) : null
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
  await redis('set', `meeting:${id}`, JSON.stringify(meeting))
  return meeting
}

// ─── WORKLIST (action items) ───────────────────────────────

export async function saveWorklistItem(item) {
  await redis('set', `worklist:${item.id}`, JSON.stringify(item))
  await redis('lpush', 'worklist:all', item.id)
}

export async function getWorklistItem(id) {
  const data = await redis('get', `worklist:${id}`)
  return data ? JSON.parse(data) : null
}

export async function getWorklist() {
  const ids = await redis('lrange', 'worklist:all', '0', '-1') || []
  const items = await Promise.all(ids.map(id => getWorklistItem(id)))
  return items.filter(Boolean)
}

export async function updateWorklistItem(id, updates) {
  const item = await getWorklistItem(id)
  if (!item) throw new Error('Worklist item not found')
  const updated = { ...item, ...updates, updatedAt: new Date().toISOString() }
  await redis('set', `worklist:${id}`, JSON.stringify(updated))
  return updated
}

export async function deleteWorklistItem(id) {
  await redis('del', `worklist:${id}`)
  await redis('lrem', 'worklist:all', '0', id)
}

// ─── SURGEON USAGE ──────────────────────────────────────────

export async function saveUsageRecord(record) {
  // Body-form SET: a case with many line items outgrows a URL path.
  await redisSetBody(`usage:${record.id}`, JSON.stringify(record))
  await redis('lrem', 'usage:all', '0', record.id)
  await redis('lpush', 'usage:all', record.id)
}

export async function getUsageRecord(id) {
  const data = await redis('get', `usage:${id}`)
  return data ? JSON.parse(data) : null
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
export async function markBookingEmailSeen(messageId, count = 0) {
  if (!messageId) return
  await redis('set', `bookingQueue:seen:${messageId}`, JSON.stringify({
    at: new Date().toISOString(), count
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
  await redis('set', queueKey(candidate.id), JSON.stringify(candidate))
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
  await redis('set', queueKey(id), JSON.stringify(updated))
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
  const stored = { ...message, at: message.at || new Date().toISOString() }
  await redisSetBody(`chat:msg:${stored.id}`, JSON.stringify(stored))
  await redis('lpush', channelKey(channel), stored.id)
  await redis('ltrim', channelKey(channel), '0', String(KEEP - 1))
  // So a case thread can be found without knowing it exists.
  await redis('sadd', 'chat:channels', channel)
  return stored
}

/** The most recent messages in a channel, oldest first for reading. */
export async function readChannel(channel, limit = 80) {
  const ids = await redis('lrange', channelKey(channel), '0', String(limit - 1)) || []
  if (!ids.length) return []
  const messages = await Promise.all(ids.map(async id => {
    const raw = await redis('get', `chat:msg:${id}`)
    try { return raw ? JSON.parse(raw) : null } catch { return null }
  }))
  return messages.filter(Boolean).reverse()
}

/** How many messages each channel holds, for the unread counts. */
export async function channelSizes(channels) {
  const sizes = {}
  await Promise.all(channels.map(async channel => {
    sizes[channel] = Number(await redis('llen', channelKey(channel))) || 0
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
