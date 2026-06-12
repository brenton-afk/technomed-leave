const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

async function redis(command, ...args) {
  const res = await fetch(`${REDIS_URL}/${command}/${args.map(a => encodeURIComponent(a)).join('/')}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  })
  const data = await res.json()
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
