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
