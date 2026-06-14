export default async function handler(req, res) {
  try {
    const R = process.env.UPSTASH_REDIS_REST_URL
    const T = process.env.UPSTASH_REDIS_REST_TOKEN
    const h = { Authorization: `Bearer ${T}` }

    const [atR, tidR] = await Promise.all([
      fetch(`${R}/get/xero_at`, { headers: h }).then(r => r.json()),
      fetch(`${R}/get/xero_tid`, { headers: h }).then(r => r.json())
    ])

    const access_token = Buffer.from(atR.result, 'base64').toString('utf8')
    const tenant_id = tidR.result

    const empRes = await fetch('https://api.xero.com/payroll.xro/1.0/Employees', {
      headers: { Authorization: `Bearer ${access_token}`, 'Xero-tenant-id': tenant_id, Accept: 'application/json' }
    })
    const empText = await empRes.text()

    const ltRes = await fetch('https://api.xero.com/payroll.xro/1.0/LeaveApplications', {
      headers: { Authorization: `Bearer ${access_token}`, 'Xero-tenant-id': tenant_id, Accept: 'application/json' }
    })
    const ltText = await ltRes.text()

    res.json({
      emp_status: empRes.status,
      lt_status: ltRes.status,
      emp_raw: empText.slice(0, 300),
      lt_raw: ltText.slice(0, 300)
    })
  } catch(err) { res.json({ error: err.message }) }
}
