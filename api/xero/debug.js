export default async function handler(req, res) {
  try {
    const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/xero_tokens`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
    })
    const d = await r.json()
    if (!d.result) return res.json({ error: 'No tokens', raw: d })
    
    let tokens
    try { tokens = typeof d.result === 'string' ? JSON.parse(d.result) : d.result } 
    catch(e) { return res.json({ error: 'Parse failed', raw: String(d.result).slice(0,300) }) }

    res.json({
      has_access_token: !!tokens.access_token,
      has_refresh_token: !!tokens.refresh_token,
      has_tenant_id: !!tokens.tenant_id,
      tenant_id: tokens.tenant_id,
      token_expired: Date.now() > tokens.expires_at,
      access_token_preview: tokens.access_token ? tokens.access_token.slice(0,20) + '...' : null,
      keys_in_object: Object.keys(tokens)
    })
  } catch(err) { res.json({ error: err.message }) }
}
