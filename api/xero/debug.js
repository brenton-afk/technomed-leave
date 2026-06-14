export default async function handler(req, res) {
  try {
    const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
    const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

    const response = await fetch(`${REDIS_URL}/get/xero_tokens`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    })
    const data = await response.json()
    if (!data.result) return res.status(200).json({ error: 'No tokens stored' })

    const tokens = JSON.parse(decodeURIComponent(data.result))

    const empRes = await fetch('https://api.xero.com/payroll.xro/1.0/Employees', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Xero-tenant-id': tokens.tenant_id,
        Accept: 'application/json'
      }
    })
    const empData = await empRes.json()

    const ltRes = await fetch('https://api.xero.com/payroll.xro/1.0/LeaveTypes', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Xero-tenant-id': tokens.tenant_id,
        Accept: 'application/json'
      }
    })
    const ltData = await ltRes.json()

    res.status(200).json({
      token_expired: Date.now() > tokens.expires_at,
      tenant_id: tokens.tenant_id,
      employees: (empData.Employees || []).map(e => e.FirstName + ' ' + e.LastName),
      leaveTypes: (ltData.LeaveTypes || []).map(lt => lt.Name),
      empError: empData.ErrorNumber ? empData.Message : null,
      ltError: ltData.ErrorNumber ? ltData.Message : null
    })
  } catch (err) {
    res.status(200).json({ error: err.message })
  }
}
