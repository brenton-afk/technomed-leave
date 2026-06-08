export default function handler(req, res) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID,
    redirect_uri: process.env.XERO_REDIRECT_URI,
    scope: [
      'openid',
      'profile',
      'email',
      'offline_access',
      'payroll.employees',
      'payroll.employees.read',
      'payroll.leaveapplications',
      'payroll.leaveapplications.read',
      'payroll.settings.read',
      'payroll.timesheets.read'
    ].join(' '),
    state: 'technomed_leave_app'
  })

  res.redirect(`https://login.xero.com/identity/connect/authorize?${params}`)
}
