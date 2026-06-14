const XERO_API_BASE = 'https://api.xero.com/payroll.xro/1.0'

// Hardcoded leave type IDs from TechnoMed Xero payroll
const LEAVE_TYPE_IDS = {
  'ANNUAL_LEAVE': '4b7fb322-1f51-4416-a512-07e9553a1149',
  'SICK': 'caf18bdb-6c7f-4b5d-8ab3-233866b534bd',
  'TOIL': null // Will be looked up dynamically
}

async function getValidToken() {
  const R = process.env.UPSTASH_REDIS_REST_URL
  const T = process.env.UPSTASH_REDIS_REST_TOKEN
  const h = { Authorization: `Bearer ${T}` }
  const [atR, tidR, expR] = await Promise.all([
    fetch(`${R}/get/xero_at`, { headers: h }).then(r => r.json()),
    fetch(`${R}/get/xero_tid`, { headers: h }).then(r => r.json()),
    fetch(`${R}/get/xero_exp`, { headers: h }).then(r => r.json())
  ])
  if (!atR.result) throw new Error('Xero not connected. Please visit /api/xero/connect')
  const access_token = Buffer.from(atR.result.replace(/ /g, '+'), 'base64').toString('utf8')
  const tenant_id = tidR.result
  const expires_at = parseInt(expR.result || '0')

  // If token is still valid, use it
  if (Date.now() < expires_at - 60000) {
    return { token: access_token, tenantId: tenant_id }
  }

  // Refresh token
  const rtR = await fetch(`${R}/get/xero_rt`, { headers: h }).then(r => r.json())
  const refresh_token = Buffer.from(rtR.result.replace(/ /g, '+'), 'base64').toString('utf8')
  const refreshRes = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token })
  })
  const refreshed = await refreshRes.json()
  if (!refreshed.access_token) throw new Error('Token refresh failed')
  const newAtB64 = Buffer.from(refreshed.access_token).toString('base64')
  const newRtB64 = Buffer.from(refreshed.refresh_token || refresh_token).toString('base64')
  await Promise.all([
    fetch(`${R}/set/xero_at/${encodeURIComponent(newAtB64)}`, { headers: h }),
    fetch(`${R}/set/xero_rt/${encodeURIComponent(newRtB64)}`, { headers: h }),
    fetch(`${R}/set/xero_exp/${Date.now() + (refreshed.expires_in * 1000)}`, { headers: h })
  ])
  return { token: refreshed.access_token, tenantId: tenant_id }
}

export async function submitToXero({ name, startDate, endDate, leaveType, reason }) {
  const { token, tenantId } = await getValidToken()

  // Find employee
  const empRes = await fetch(`${XERO_API_BASE}/Employees`, {
    headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' }
  })
  const empData = await empRes.json()
  const employees = empData.Employees || []
  const nameLower = name.toLowerCase().trim()
  const lastName = nameLower.split(' ').pop()
  const employee = employees.find(e => {
    const full = `${e.FirstName} ${e.LastName}`.toLowerCase()
    return full === nameLower || full.includes(nameLower) || e.LastName.toLowerCase() === lastName
  })
  if (!employee) throw new Error(`Employee "${name}" not found in Xero. Available: ${employees.map(e => e.FirstName + ' ' + e.LastName).join(', ')}`)

  // Get leave type ID
  let leaveTypeId = LEAVE_TYPE_IDS[leaveType]
  if (!leaveTypeId) {
    // Try to find TOIL dynamically from existing applications
    throw new Error(`Leave type "${leaveType}" not configured. Please contact admin.`)
  }

  const leaveApp = {
    EmployeeID: employee.EmployeeID,
    LeaveTypeID: leaveTypeId,
    StartDate: `/Date(${new Date(startDate).getTime()}+0000)/`,
    EndDate: `/Date(${new Date(endDate).getTime()}+0000)/`,
    Title: `${name} - ${leaveType}`,
    Description: reason || ''
  }

  const submitRes = await fetch(`${XERO_API_BASE}/LeaveApplications`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ LeaveApplications: [leaveApp] })
  })
  const result = await submitRes.json()
  if (result.ErrorNumber) throw new Error(result.Message || 'Xero submission failed')
  return {
    leaveApplicationID: result.LeaveApplications?.[0]?.LeaveApplicationID,
    employeeName: `${employee.FirstName} ${employee.LastName}`
  }
}
