export default async function handler(req, res) {
  try {
    const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/xero_tokens`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
    })
    const d = await r.json()
    if (!d.result) return res.json({ error: 'No tokens stored', raw: d })

    let tokens
    try {
      tokens = typeof d.result === 'string' ? JSON.parse(d.result) : d.result
    } catch(e) {
      return res.json({ error: 'Parse failed', raw_preview: String(d.result).slice(0, 200) })
    }

    const empRes = await fetch('https://api.xero.com/payroll.xro/1.0/Employees', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Xero-tenant-id': tokens.tenant_id, Accept: 'application/json' }
    })
    const empData = await empRes.json()

    const ltRes = await fetch('https://api.xero.com/payroll.xro/1.0/LeaveTypes', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Xero-tenant-id': tokens.tenant_id, Accept: 'application/json' }
    })
    const ltData = await ltRes.json()

    res.json({
      emp_status: empRes.status,
      lt_status: ltRes.status,
      employees: (empData.Employees || []).map(e => e.FirstName + ' ' + e.LastName),
      leaveTypes: (ltData.LeaveTypes || []).map(lt => lt.Name),
      empError: empData.ErrorNumber ? empData.Message : null,
      ltError: ltData.ErrorNumber ? ltData.Message : null
    })
  } catch(err) { res.json({ error: err.message }) }
}
