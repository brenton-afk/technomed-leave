import { redis } from './_redis.js'

const XERO_API_BASE = 'https://api.xero.com/payroll.xro/1.0'

// Fallback leave type IDs for the TechnoMed AU payroll org, used only if the
// live LeaveTypes lookup fails. Prefer the lookup — IDs differ per org.
const FALLBACK_LEAVE_TYPE_IDS = {
  ANNUAL_LEAVE: '4b7fb322-1f51-4416-a512-07e9553a1149',
  SICK: 'caf18bdb-6c7f-4b5d-8ab3-233866b534bd'
}

// How each internal leave type is recognised among the org's Xero leave types.
const LEAVE_TYPE_PATTERNS = {
  ANNUAL_LEAVE: /annual/i,
  SICK: /personal|sick/i,
  TOIL: /toil|lieu/i
}

// Tokens are stored as four short keys, raw (not base64). Upstash carries
// values in the URL path, and base64 padding/`+` characters were being mangled
// by URL decoding — Xero tokens are already URL-safe, so store them as-is.
async function readStoredTokens() {
  const [access_token, refresh_token, tenant_id, expires_at] = await Promise.all([
    redis('get', 'xero_at'),
    redis('get', 'xero_rt'),
    redis('get', 'xero_tid'),
    redis('get', 'xero_exp')
  ])
  return { access_token, refresh_token, tenant_id, expires_at: parseInt(expires_at || '0', 10) }
}

export async function storeXeroTokens({ access_token, refresh_token, tenant_id, expires_in }) {
  const writes = [
    redis('set', 'xero_at', access_token),
    redis('set', 'xero_rt', refresh_token),
    redis('set', 'xero_exp', String(Date.now() + expires_in * 1000))
  ]
  if (tenant_id) writes.push(redis('set', 'xero_tid', tenant_id))
  await Promise.all(writes)
}

export async function getXeroConnectionStatus() {
  const { access_token, tenant_id, expires_at } = await readStoredTokens()
  if (!access_token) return { connected: false }
  return {
    connected: true,
    tenant_id,
    expires_at: new Date(expires_at).toISOString(),
    expired: Date.now() >= expires_at
  }
}

// Returns a usable access token, refreshing it first when it is close to
// expiry. Callers get the tenant ID from here too — the Redis value is
// authoritative, XERO_TENANT_ID is only a fallback for a fresh deploy.
export async function getXeroToken() {
  const stored = await readStoredTokens()
  if (!stored.access_token) {
    throw new Error('Xero not connected. Please visit /api/xero/connect')
  }

  const tenantId = stored.tenant_id || process.env.XERO_TENANT_ID
  if (!tenantId) throw new Error('No Xero tenant ID stored. Please reconnect via /api/xero/connect')

  if (Date.now() < stored.expires_at - 60_000) {
    return { token: stored.access_token, tenantId }
  }

  if (!stored.refresh_token) {
    throw new Error('Xero access token expired and no refresh token stored. Please reconnect via /api/xero/connect')
  }

  const refreshRes = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: stored.refresh_token })
  })
  const refreshed = await refreshRes.json()
  if (!refreshed.access_token) {
    throw new Error(`Xero token refresh failed: ${refreshed.error_description || refreshed.error || 'unknown error'}`)
  }

  await storeXeroTokens({
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || stored.refresh_token,
    tenant_id: tenantId,
    expires_in: refreshed.expires_in
  })

  return { token: refreshed.access_token, tenantId }
}

function xeroHeaders(token, tenantId) {
  return { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' }
}

async function xeroGet(path, token, tenantId) {
  const res = await fetch(`${XERO_API_BASE}${path}`, { headers: xeroHeaders(token, tenantId) })
  const data = await res.json()
  if (!res.ok || data.ErrorNumber) {
    throw new Error(`Xero ${path} failed (${res.status}): ${data.Message || 'unknown error'}`)
  }
  return data
}

export async function listEmployees(token, tenantId) {
  const data = await xeroGet('/Employees', token, tenantId)
  return data.Employees || []
}

export async function findEmployee(token, tenantId, name) {
  const employees = await listEmployees(token, tenantId)
  const nameLower = String(name).toLowerCase().trim()
  const lastName = nameLower.split(' ').pop()
  const match = employees.find(e => {
    const full = `${e.FirstName} ${e.LastName}`.toLowerCase()
    return full === nameLower || full.includes(nameLower) || e.LastName.toLowerCase() === lastName
  })
  if (!match) {
    const available = employees.map(e => `${e.FirstName} ${e.LastName}`).join(', ')
    throw new Error(`Employee "${name}" not found in Xero. Available: ${available || 'none'}`)
  }
  return match
}

export async function listLeaveTypes(token, tenantId) {
  const data = await xeroGet('/LeaveTypes', token, tenantId)
  return data.LeaveTypes || []
}

// Resolves an internal leave type to a Xero LeaveTypeID by matching on name,
// so TOIL and any future type work without hardcoded UUIDs.
export async function getLeaveTypeId(token, tenantId, leaveType) {
  const pattern = LEAVE_TYPE_PATTERNS[leaveType]
  if (!pattern) throw new Error(`Unknown leave type "${leaveType}"`)

  let leaveTypes = null
  try {
    leaveTypes = await listLeaveTypes(token, tenantId)
  } catch (err) {
    // The lookup needs payroll.settings scope; fall back if it is unavailable.
    const fallback = FALLBACK_LEAVE_TYPE_IDS[leaveType]
    if (fallback) return fallback
    throw err
  }

  const match = leaveTypes.find(lt => pattern.test(lt.Name || ''))
  if (match) return match.LeaveTypeID

  const fallback = FALLBACK_LEAVE_TYPE_IDS[leaveType]
  if (fallback) return fallback

  const available = leaveTypes.map(lt => lt.Name).join(', ')
  throw new Error(`No Xero leave type matching "${leaveType}". Available in Xero: ${available || 'none'}`)
}

// Xero's legacy payroll API expects dates in /Date(ms+0000)/ form.
function xeroDate(dateStr) {
  const ms = new Date(`${dateStr}T00:00:00Z`).getTime()
  if (Number.isNaN(ms)) throw new Error(`Invalid date "${dateStr}"`)
  return `/Date(${ms}+0000)/`
}

export async function submitToXero({ name, startDate, endDate, leaveType, reason }) {
  const { token, tenantId } = await getXeroToken()
  const employee = await findEmployee(token, tenantId, name)
  const leaveTypeId = await getLeaveTypeId(token, tenantId, leaveType)

  const leaveApp = {
    EmployeeID: employee.EmployeeID,
    LeaveTypeID: leaveTypeId,
    StartDate: xeroDate(startDate),
    EndDate: xeroDate(endDate),
    Title: `${name} - ${leaveType}`,
    Description: reason || ''
  }

  const submitRes = await fetch(`${XERO_API_BASE}/LeaveApplications`, {
    method: 'POST',
    headers: { ...xeroHeaders(token, tenantId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ LeaveApplications: [leaveApp] })
  })
  const result = await submitRes.json()
  if (!submitRes.ok || result.ErrorNumber) {
    throw new Error(result.Message || `Xero submission failed (${submitRes.status})`)
  }

  return {
    leaveApplicationID: result.LeaveApplications?.[0]?.LeaveApplicationID,
    employeeName: `${employee.FirstName} ${employee.LastName}`
  }
}
