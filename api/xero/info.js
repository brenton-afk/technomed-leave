import { requireAdmin } from '../_auth.js'
import {
  getXeroConnectionStatus, getXeroToken, findEmployee,
  listEmployees, listLeaveTypes
} from '../_xeroClient.js'
import { readXero } from '../_xeroResponse.js'
import { STAFF } from '../../src/staffConfig.js'
import { getTimesheetDraft } from '../_redis.js'

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
      const { ok, data, error } = await readXero(detailRes, 'Xero employee')
      if (!ok) return res.status(502).json({ error })
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
    // ── What Xero actually holds, when its own screens will not show you ──
    //
    // Brent's Xero timesheet page started answering 500 and the reasonable
    // worry was that this app had written something malformed into it. Their
    // API stayed healthy while the page did not, so the way to settle that is
    // to read the records back rather than reason about them.
    //
    // Read-only and admin-only. It lists what is there, by employee and
    // period, so a duplicate or a stray draft is visible as a fact.
    if (action === 'timesheets') {
      // Payroll records. Admin only, like the rest of this file's write and
      // diagnostic actions — it was added in a hurry this morning without it.
      if (!(await requireAdmin(req, res))) return
      const { token, tenantId } = await getXeroToken()
      const timesheetsRes = await fetch(
        'https://api.xero.com/payroll.xro/1.0/Timesheets',
        { headers: { Authorization: `Bearer ${token}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' } }
      )
      const { ok, data, error } = await readXero(timesheetsRes, 'Xero timesheets')
      if (!ok) return res.status(502).json({ error })

      // Whose it is, by name. A Xero employee ID answers nobody's question —
      // the point of this panel is working out who submitted what, and a UUID
      // makes that a second lookup in a system that may not be loading.
      const employees = await listEmployees(token, tenantId).catch(() => [])
      const nameOf = id => {
        const match = employees.find(e => (e.EmployeeID || e.employeeID) === id)
        return match ? `${match.FirstName} ${match.LastName}`.trim() : null
      }

      const sheets = (Array.isArray(data) ? data : data.Timesheets || []).map(t => ({
        id: t.TimesheetID,
        employeeID: t.EmployeeID,
        who: nameOf(t.EmployeeID),
        start: String(t.StartDate || ''),
        end: String(t.EndDate || ''),
        status: t.Status,
        lines: (t.TimesheetLines || []).length,
        // The totals, so an obviously wrong one stands out without opening it.
        hours: (t.TimesheetLines || []).reduce(
          (n, l) => n + (l.NumberOfUnits || []).reduce((a, b) => a + (Number(b) || 0), 0), 0)
      }))

      // Same employee, same fortnight, more than once — the shape a retry
      // after a failure would leave behind, and the thing most likely to
      // upset a page that assumes one.
      const seen = new Map()
      for (const t of sheets) {
        const key = `${t.employeeID}|${t.start}`
        seen.set(key, (seen.get(key) || 0) + 1)
      }
      const duplicates = sheets.filter(t => seen.get(`${t.employeeID}|${t.start}`) > 1)

      // Who is part-way through one, from this app's own records.
      //
      // A submission that fails never reaches our store — the record is
      // written after Xero accepts it — so a failed attempt leaves no trace
      // there at all. The draft does, because it is saved as somebody types.
      // That is what answers "who was trying to submit" when the submission
      // is exactly the thing that broke, and it is why this is here: the app
      // knew all along and had nowhere to say it.
      const drafts = (await Promise.all(
        STAFF.filter(p => p.hasTimesheets).map(async person => {
          const draft = await getTimesheetDraft(person.email).catch(() => null)
          if (!draft) return null
          return {
            name: person.name,
            periodStart: draft.periodStart || null,
            savedAt: draft.savedAt || null
          }
        })
      )).filter(Boolean)

      return res.status(200).json({ count: sheets.length, duplicates, timesheets: sheets, drafts })
    }

    // ── Removing a timesheet from Xero ──
    //
    // Destructive, admin-only, and here because Brent's payroll is blocked
    // and Xero's own screens will not load to let him do it there.
    //
    // Xero has no DELETE verb for a payroll timesheet: you post the same
    // timesheet back with its status set to DELETED. It has to carry the ID,
    // or it is read as a new one — which is the bug that created this mess in
    // the first place.
    if (action === 'delete-timesheet' && req.method === 'POST') {
      const session = await requireAdmin(req, res)
      if (!session) return
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const id = String(body.timesheetID || '').trim()
      if (!id) return res.status(400).json({ error: 'A timesheet ID is needed' })

      const { token, tenantId } = await getXeroToken()
      const del = await fetch('https://api.xero.com/payroll.xro/1.0/Timesheets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Xero-tenant-id': tenantId,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        // A bare array at the root, like every other AU payroll post.
        body: JSON.stringify([{ TimesheetID: id, Status: 'DELETED' }])
      })
      const { ok, error } = await readXero(del, 'Xero timesheet delete')
      if (!ok) return res.status(502).json({ error })
      // Said out loud in the log, because deleting a payroll record should
      // leave a trace somewhere other than the person's memory.
      console.log(`Xero timesheet ${id} deleted by ${session.email}`)
      return res.status(200).json({ ok: true, deleted: id })
    }

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
