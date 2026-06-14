const XERO_API_BASE = 'https://api.xero.com/payroll.xro/1.0'

const LEAVE_TYPE_MAP = {
  'ANNUAL_LEAVE': 'Annual Leave',
  'SICK': "Personal/Carer's Leave",
  'TOIL': 'Time Off In Lieu'
}

async function getStoredTokens() {
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
  const res = await fetch(`${REDIS_URL}/get/xero_tokens`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  })
  const data = await res.json()
  if (!data.result) throw new Error('Xero not connected. Please visit /api/xero/connect first.')
  return JSON.parse(decodeURIComponent(data.result))
}

async function refreshToken(refreshToken) {
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
      ).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data))
  return data
}

async function getValidToken() {
  const stored = await getStoredTokens()
  if (Date.now() < stored.expires_at - 60000) {
    return { token: stored.access_token, tenantId: stored.tenant_id }
  }
  // Refresh token
  const refreshed = await refreshToken(stored.refresh_token)
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
  const REDIS_TOKEN_ENV = process.env.UPSTASH_REDIS_REST_TOKEN
  const newData = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || stored.refresh_token,
    tenant_id: stored.tenant_id,
    expires_at: Date.now() + (refreshed.expires_in * 1000)
  }
  await fetch(`${REDIS_URL}/set/xero_tokens/${encodeURIComponent(JSON.stringify(newData))}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN_ENV}` }
  })
  return { token: refreshed.access_token, tenantId: stored.tenant_id }
}

export async function findEmployee(token, tenantId, name) {
  const res = await fetch(`${XERO_API_BASE}/Employees`, {
    headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' }
  })
  const data = await res.json()
  const employees = data.Employees || []
  const nameLower = name.toLowerCase().trim()
  return employees.find(e => {
    const fullName = `${e.FirstName} ${e.LastName}`.toLowerCase()
    return fullName === nameLower || fullName.includes(nameLower)
  })
}

export async function getLeaveTypes(token, tenantId) {
  const res = await fetch(`${XERO_API_BASE}/LeaveTypes`, {
    headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' }
  })
  const data = await res.json()
  return data.LeaveTypes || []
}

export async function submitToXero({ name, startDate, endDate, leaveType, reason }) {
  const { token, tenantId } = await getValidToken()

  const employee = await findEmployee(token, tenantId, name)
  if (!employee) throw new Error(`Employee "${name}" not found in Xero`)

  const xeroLeaveTypes = await getLeaveTypes(token, tenantId)
  const targetName = LEAVE_TYPE_MAP[leaveType] || leaveType
  const xeroLeaveType = xeroLeaveTypes.find(lt =>
    lt.Name.toLowerCase().includes(targetName.toLowerCase())
  )
  if (!xeroLeaveType) throw new Error(`Leave type "${targetName}" not found in Xero`)

  const leaveApp = {
    EmployeeID: employee.EmployeeID,
    LeaveTypeID: xeroLeaveType.LeaveTypeID,
    StartDate: `/Date(${new Date(startDate).getTime()}+0000)/`,
    EndDate: `/Date(${new Date(endDate).getTime()}+0000)/`,
    Description: reason || '',
    Title: `${name} - ${targetName}`
  }

  const submitRes = await fetch(`${XERO_API_BASE}/LeaveApplications`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ LeaveApplications: [leaveApp] })
  })

  const result = await submitRes.json()
  if (result.ErrorNumber) throw new Error(result.Message || 'Xero submission failed')

  return {
    leaveApplicationID: result.LeaveApplications?.[0]?.LeaveApplicationID,
    employeeName: `${employee.FirstName} ${employee.LastName}`
  }
}
