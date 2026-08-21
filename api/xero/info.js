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

    // Which integrations are actually configured on this deployment. Reports
    // presence only — never a value — so a missing or wrongly-scoped Vercel
    // environment variable can be diagnosed from the app instead of guessed at.
    if (action === 'env') {
      const session = await requireAdmin(req, res)
      if (!session) return

      const required = {
        UPSTASH_REDIS_REST_URL: 'Redis (everything)',
        UPSTASH_REDIS_REST_TOKEN: 'Redis (everything)',
        ANTHROPIC_API_KEY: 'Usage scanning + meeting analysis',
        RESEND_API_KEY: 'All email',
        GOOGLE_SERVICE_ACCOUNT_JSON: 'Calendar read/write',
        XERO_CLIENT_ID: 'Xero',
        XERO_CLIENT_SECRET: 'Xero',
        XERO_REDIRECT_URI: 'Xero OAuth callback',
        DROPBOX_ACCESS_TOKEN: 'Usage filing to Dropbox',
        TWILIO_ACCOUNT_SID: 'Timesheet SMS reminders',
        TWILIO_AUTH_TOKEN: 'Timesheet SMS reminders',
        TWILIO_FROM_NUMBER: 'Timesheet SMS reminders',
        EMAIL_FROM: 'Email sender (falls back to resend.dev)',
        CRON_SECRET: 'Cron authentication'
      }

      const configured = {}
      const missing = []
      for (const [key, purpose] of Object.entries(required)) {
        const present = Boolean(process.env[key])
        configured[key] = present
        if (!present) missing.push({ key, purpose })
      }

      return res.status(200).json({
        deployment: {
          env: process.env.VERCEL_ENV || 'unknown',
          commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'unknown'
        },
        configured,
        missing
      })
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
