export default async function handler(req, res) {
  try {
    const R = process.env.UPSTASH_REDIS_REST_URL
    const T = process.env.UPSTASH_REDIS_REST_TOKEN
    const h = { Authorization: `Bearer ${T}` }
    const [at, tid] = await Promise.all([
      fetch(`${R}/get/xero_at`, { headers: h }).then(r => r.json()),
      fetch(`${R}/get/xero_tid`, { headers: h }).then(r => r.json())
    ])
    if (!at.result) return res.json({ error: 'No access token in Redis' })
    const access_token = Buffer.from(at.result, 'base64').toString('utf8')
    const tenant_id = tid.result
    const empRes = await fetch('https://api.xero.com/payroll.xro/1.0/Employees', {
      headers: { Authorization: `Bearer ${access_token}`, 'Xero-tenant-id': tenant_id, Accept: 'application/json' }
    })
    const empData = await empRes.json()
    const ltRes = await fetch('https://api.xero.com/payroll.xro/1.0/LeaveTypes', {
      headers: { Authorization: `Bearer ${access_token}`, 'Xero-tenant-id': tenant_id, Accept: 'application/json' }
    })
    const ltData = await ltRes.json()
    res.json({
      emp_status: empRes.status,
      lt_status: ltRes.status,
      tenant_id,
      employees: (empData.Employees || []).map(e => e.FirstName + ' ' + e.LastName),
      leaveTypes: (ltData.LeaveTypes || []).map(lt => lt.Name),
      empError: empData.ErrorNumber ? empData.Message : null
    })
  } catch(err) { res.json({ error: err.message }) }
}
