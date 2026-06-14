const XERO_API_BASE = 'https://api.xero.com/payroll.xro/1.0'

const LEAVE_TYPE_MAP = {
  'ANNUAL_LEAVE': 'Annual Leave',
  'SICK': "Personal/Carer's Leave",
  'TOIL': 'Time Off In Lieu'
}

async function getStoredTokens() {
  const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/xero_tokens`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
  })
  const d = await r.json()
  if (!d.result) throw new Error('Xero not connected')
  return typeof d.result === 'string' ? JSON.parse(d.result) : d.result
}

async function getValidToken() {
  const stored = await getStoredTokens()
  if (Date.now() < stored.expires_at - 60000) {
    return { token: stored.access_token, tenantId: stored.tenant_id }
  }
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: stored.refresh_token })
  })
  const refreshed = await res.json()
  if (!refreshed.access_token) throw new Error('Token refresh failed')
  const newData = JSON.stringify({
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || stored.refresh_token,
    tenant_id: stored.tenant_id,
    expires_at: Date.now() + (refreshed.expires_in * 1000)
  })
  await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/xero_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', 'xero_tokens', newData])
  })
  return { token: refreshed.access_token, tenantId: stored.tenant_id }
}

export async function submitToXero({ name, startDate, endDate, leaveType, reason }) {
  const { token, tenantId } = await getValidToken()

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

  const ltRes = await fetch(`${XERO_API_BASE}/LeaveTypes`, {
    headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' }
  })
  const ltData = await ltRes.json()
  const leaveTypes = ltData.LeaveTypes || []
  const targetName = LEAVE_TYPE_MAP[leaveType] || leaveType
  const xeroLeaveType = leaveTypes.find(lt => lt.Name.toLowerCase().includes(targetName.toLowerCase()))
  if (!xeroLeaveType) throw new Error(`Leave type "${targetName}" not found. Available: ${leaveTypes.map(lt => lt.Name).join(', ')}`)

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
    headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ LeaveApplications: [leaveApp] })
  })
  const result = await submitRes.json()
  if (result.ErrorNumber) throw new Error(result.Message || 'Xero submission failed')
  return { leaveApplicationID: result.LeaveApplications?.[0]?.LeaveApplicationID, employeeName: `${employee.FirstName} ${employee.LastName}` }
}
