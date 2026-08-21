import { requireAdmin } from '../_auth.js'
import {
  getXeroConnectionStatus, getXeroToken, findEmployee,
  listEmployees, listLeaveTypes
} from '../_xeroClient.js'

// Read-only Xero lookups, routed by ?action=. These were three separate
// functions (status, balances, debug); they were merged to stay under the
// 12-function Hobby cap when the timesheet module was added. Nothing in the
// frontend referenced the old paths.
//
//   /api/xero/info?action=status
//   /api/xero/info?action=balances&name=April%20Foale
//   /api/xero/info?action=debug            (admin only)
export default async function handler(req, res) {
  const action = req.query.action || 'status'

  try {
    if (action === 'status') {
      return res.status(200).json(await getXeroConnectionStatus())
    }

    if (action === 'balances') {
      const { name } = req.query
      if (!name) return res.status(400).json({ error: 'Name required' })
      const { token, tenantId } = await getXeroToken()
      const employee = await findEmployee(token, tenantId, name)
      const detailRes = await fetch(
        `https://api.xero.com/payroll.xro/1.0/Employees/${employee.EmployeeID}`,
        { headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' } }
      )
      const data = await detailRes.json()
      const emp = data.Employees?.[0]
      if (!emp) return res.status(404).json({ error: 'Employee data not found' })
      return res.status(200).json((emp.LeaveBalances || []).map(b => ({
        leaveType: b.LeaveName,
        leaveTypeID: b.LeaveTypeID,
        balanceHours: parseFloat(b.BalanceHours || 0).toFixed(1)
      })))
    }

    if (action === 'debug') {
      // Exposes staff names and payroll configuration — admin only.
      const session = await requireAdmin(req, res)
      if (!session) return

      const status = await getXeroConnectionStatus()
      if (!status.connected) return res.status(200).json({ connected: false })

      const { token, tenantId } = await getXeroToken()
      const [employees, leaveTypes] = await Promise.all([
        listEmployees(token, tenantId),
        listLeaveTypes(token, tenantId)
      ])
      return res.status(200).json({
        connected: true,
        tenantId,
        expiresAt: status.expires_at,
        employees: employees.map(e => `${e.FirstName} ${e.LastName}`),
        leaveTypes: leaveTypes.map(lt => ({ name: lt.Name, id: lt.LeaveTypeID }))
      })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    if (action === 'status') return res.status(200).json({ connected: false, error: err.message })
    return res.status(500).json({ error: err.message })
  }
}
