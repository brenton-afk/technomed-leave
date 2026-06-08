// ─── Xero API Client ─────────────────────────────────────────────────────────
// Handles token refresh, employee lookup and leave application submission

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_API_BASE = 'https://api.xero.com/payroll.xro/1.0'

// Map our internal leave type IDs to Xero leave type names
// These must match the leave type names configured in your Xero payroll settings
const LEAVE_TYPE_MAP = {
  'ANNUAL_LEAVE': 'Annual Leave',
  'SICK': 'Personal/Carer\'s Leave',
  'TOIL': 'Time Off In Lieu'
}

export async function getXeroToken() {
  // Refresh the access token using client credentials
  // In production with Vercel KV, you'd store/retrieve the refresh token
  // For initial setup, uses client credentials flow
  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
      ).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'payroll.employees payroll.leaveapplications payroll.settings.read'
    })
  })

  const data = await res.json()
  if (!data.access_token) {
    throw new Error(`Xero token error: ${data.error_description || 'Unknown error'}`)
  }
  return data.access_token
}

export async function findEmployee(token, tenantId, name) {
  const res = await fetch(`${XERO_API_BASE}/Employees`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-tenant-id': tenantId,
      Accept: 'application/json'
    }
  })

  const data = await res.json()
  const employees = data.Employees || []

  // Match by full name (case-insensitive)
  const nameLower = name.toLowerCase().trim()
  return employees.find(e => {
    const fullName = `${e.FirstName} ${e.LastName}`.toLowerCase()
    return fullName === nameLower || fullName.includes(nameLower)
  })
}

export async function getLeaveTypes(token, tenantId) {
  const res = await fetch(`${XERO_API_BASE}/LeaveTypes`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-tenant-id': tenantId,
      Accept: 'application/json'
    }
  })
  const data = await res.json()
  return data.LeaveTypes || []
}

export async function submitToXero({ name, startDate, endDate, leaveType, reason }) {
  const token = await getXeroToken()
  const tenantId = process.env.XERO_TENANT_ID

  // 1. Find the employee
  const employee = await findEmployee(token, tenantId, name)
  if (!employee) {
    throw new Error(`Employee "${name}" not found in Xero. Check the name matches exactly.`)
  }

  // 2. Find the matching leave type in Xero
  const xeroLeaveTypes = await getLeaveTypes(token, tenantId)
  const targetName = LEAVE_TYPE_MAP[leaveType] || leaveType
  const xeroLeaveType = xeroLeaveTypes.find(lt =>
    lt.Name.toLowerCase().includes(targetName.toLowerCase())
  )

  if (!xeroLeaveType) {
    throw new Error(`Leave type "${targetName}" not found in Xero payroll settings`)
  }

  // 3. Submit leave application
  const leaveApp = {
    EmployeeID: employee.EmployeeID,
    LeaveTypeID: xeroLeaveType.LeaveTypeID,
    StartDate: `/Date(${new Date(startDate).getTime()}+0000)/`,
    EndDate: `/Date(${new Date(endDate).getTime()}+0000)/`,
    Description: reason,
    Title: `${name} - ${LEAVE_TYPE_MAP[leaveType] || leaveType}`
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

  if (result.ErrorNumber) {
    throw new Error(result.Message || 'Xero leave submission failed')
  }

  return {
    leaveApplicationID: result.LeaveApplications?.[0]?.LeaveApplicationID,
    employeeID: employee.EmployeeID,
    employeeName: `${employee.FirstName} ${employee.LastName}`
  }
}
