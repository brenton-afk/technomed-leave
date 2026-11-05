import { INVOICE_SCOPES } from '../_xeroAccounting.js'

export default function handler(req, res) {
  const clientId = process.env.XERO_CLIENT_ID
  const redirectUri = process.env.XERO_REDIRECT_URI

  if (!clientId) {
    return res.status(500).json({ error: 'XERO_CLIENT_ID not configured' })
  }

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
    state: 'technomed_leave_app'
  })

  const url = 'https://login.xero.com/identity/connect/authorize?' + params.toString()
  res.redirect(url)
}
