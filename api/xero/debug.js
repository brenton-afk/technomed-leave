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

    const ltRes = await fetch('https://api.xero.com/payroll.xro/1.0/LeaveTypes', {
      headers: { Authorization: `Bearer ${access_token}`, 'Xero-tenant-id': tenant_id, Accept: 'application/json' }
    })
    const ltText = await ltRes.text()

    let empData, ltData
    try { empData = JSON.parse(empText) } catch(e) { return res.json({ step: 'parse_emp', error: e.message, raw: empText.slice(0,200) }) }
    try { ltData = JSON.parse(ltText) } catch(e) { return res.json({ step: 'parse_lt', error: e.message, raw: ltText.slice(0,200) }) }

    res.json({
      emp_status: empRes.status,
      lt_status: ltRes.status,
      employees: (empData.Employees || []).map(e => e.FirstName + ' ' + e.LastName),
      leaveTypes: (ltData.LeaveTypes || []).map(lt => lt.Name),
      empError: empData.ErrorNumber ? empData.Message : null
    })
  } catch(err) { res.json({ error: err.message }) }
}
