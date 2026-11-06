import { randomUUID } from 'node:crypto'
import { INVOICE_SCOPES } from '../_xeroAccounting.js'
import { requireAdmin } from '../_auth.js'
import { redis } from '../_redis.js'

// Admins only, and the answer is the Xero address as JSON rather than a
// redirect: a link the browser follows carries no Authorization header, so the
// screen asks here first with its session and then goes to Xero itself.
// `state` is a one-off value held for ten minutes and checked by the callback
// — it was the fixed string 'technomed_leave_app', which let anybody start a
// connection and have the portal accept the result (same shape as Dropbox).

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res)
  if (!admin) return

  const clientId = process.env.XERO_CLIENT_ID
  const redirectUri = process.env.XERO_REDIRECT_URI

  if (!clientId) {
    return res.status(500).json({ error: 'XERO_CLIENT_ID not configured' })
  }

  const state = randomUUID()
  await redis('set', `xero_state:${state}`, admin.email, 'EX', '600')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: [
      'openid',
      'profile',
      'email',
      'offline_access',
      'payroll.employees',
      'payroll.employees.read',
      'payroll.payruns',
      'payroll.payruns.read',
      'payroll.payslip',
      'payroll.payslip.read',
      'payroll.settings',
      'payroll.settings.read',
      'payroll.timesheets',
      'payroll.timesheets.read',
      // "Allow invoices" (Admin → Invoices) asks for invoicing on top. Only
      // then: if Xero refused a permission, the plain connection that leave
      // and timesheets depend on would never be at risk from it.
      ...(req.query?.invoices ? INVOICE_SCOPES : [])
    ].join(' '),
    state
  })

  const url = 'https://login.xero.com/identity/connect/authorize?' + params.toString()
  return res.status(200).json({ url })
}
