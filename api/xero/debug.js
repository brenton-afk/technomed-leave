import { requireAdmin } from '../_auth.js'
import { getXeroToken, listEmployees, listLeaveTypes, getXeroConnectionStatus } from '../_xeroClient.js'

// Admin-only: exposes staff names and payroll configuration.
export default async function handler(req, res) {
  const session = await requireAdmin(req, res)
  if (!session) return

  try {
    const status = await getXeroConnectionStatus()
    if (!status.connected) return res.status(200).json({ connected: false })

    const { token, tenantId } = await getXeroToken()
    const [employees, leaveTypes] = await Promise.all([
      listEmployees(token, tenantId),
      listLeaveTypes(token, tenantId)
    ])

    res.status(200).json({
      connected: true,
      tenantId,
      expiresAt: status.expires_at,
      employees: employees.map(e => `${e.FirstName} ${e.LastName}`),
      leaveTypes: leaveTypes.map(lt => ({ name: lt.Name, id: lt.LeaveTypeID }))
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
