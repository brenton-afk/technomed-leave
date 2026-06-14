export default async function handler(req, res) {
  try {
    const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/xero_tokens`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
    })
    const d = await r.json()
    if (!d.result) return res.json({ error: 'No tokens', raw: d })
    
    let tokens
    try { tokens = typeof d.result === 'string' ? JSON.parse(d.result) : d.result } 
    catch(e) { return res.json({ error: 'Parse failed', raw: String(d.result).slice(0,200) }) }

    const empRes = await fetch('https://api.xero.com/payroll.xro/1.0/Employees', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Xero-tenant-id': tokens.tenant_id, Accept: 'application/json' }
    })
    const empRaw = await empRes.text()

    const ltRes = await fetch('https://api.xero.com/payroll.xro/1.0/LeaveTypes', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Xero-tenant-id': tokens.tenant_id, Accept: 'application/json' }
    })
    const ltRaw = await ltRes.text()

    res.json({
      tenant_id: tokens.tenant_id,
      token_expired: Date.now() > tokens.expires_at,
      emp_status: empRes.status,
      lt_status: ltRes.status,
      emp_raw: empRaw.slice(0, 500),
      lt_raw: ltRaw.slice(0, 500)
    })
  } catch(err) { res.json({ error: err.message }) }
}
