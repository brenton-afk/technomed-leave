export default async function handler(req, res) {
  try {
    const R = process.env.UPSTASH_REDIS_REST_URL
    const T = process.env.UPSTASH_REDIS_REST_TOKEN
    const h = { Authorization: `Bearer ${T}` }

    const atRes = await fetch(`${R}/get/xero_at`, { headers: h })
    const atText = await atRes.text()
    const tidRes = await fetch(`${R}/get/xero_tid`, { headers: h })
    const tidText = await tidRes.text()

    let at, tid
    try { at = JSON.parse(atText) } catch(e) { return res.json({ step: 'parse_at', error: e.message, raw: atText.slice(0,100) }) }
    try { tid = JSON.parse(tidText) } catch(e) { return res.json({ step: 'parse_tid', error: e.message, raw: tidText.slice(0,100) }) }

    if (!at.result) return res.json({ error: 'No access token', at })

    const access_token = Buffer.from(at.result, 'base64').toString('utf8')
    const tenant_id = tid.result

    res.json({
      step: 'got_tokens',
      has_access_token: !!access_token,
      token_preview: access_token.slice(0, 20) + '...',
      tenant_id,
      token_length: access_token.length
    })
  } catch(err) { res.json({ error: err.message, stack: err.stack }) }
}
