export default async function handler(req, res) {
  const { code } = req.query
  if (!code) return res.status(400).json({ error: 'No code' })
  try {
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.XERO_REDIRECT_URI })
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) throw new Error(tokens.error_description || 'Token exchange failed')
    
    const connRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const connections = await connRes.json()
    const tenantId = connections[0]?.tenantId
    if (!tenantId) throw new Error('No org found')

    const saveData = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      tenant_id: tenantId,
      expires_at: Date.now() + (tokens.expires_in * 1000)
    })

    // Correct Upstash REST API format - use GET-style URL with value in path
    const setRes = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/xero_tokens/${encodeURIComponent(saveData)}`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
    })
    const setData = await setRes.json()
    console.log('Redis save result:', JSON.stringify(setData))

    res.redirect('/?xero=connected')
  }
cat > api/xero/callback.js << 'EOF'
export default async function handler(req, res) {
  const { code } = req.query
  if (!code) return res.status(400).json({ error: 'No code' })
  try {
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64')
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: process.env.XERO_REDIRECT_URI })
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) throw new Error(tokens.error_description || 'Token exchange failed')
    
    const connRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const connections = await connRes.json()
    const tenantId = connections[0]?.tenantId
    if (!tenantId) throw new Error('No org found')

    const saveData = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      tenant_id: tenantId,
      expires_at: Date.now() + (tokens.expires_in * 1000)
    })

    // Correct Upstash REST API format - use GET-style URL with value in path
    const setRes = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/xero_tokens/${encodeURIComponent(saveData)}`, {
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
    })
    const setData = await setRes.json()
    console.log('Redis save result:', JSON.stringify(setData))

    res.redirect('/?xero=connected')
  } catch (err) {
    console.error('Callback error:', err.message)
    res.redirect('/?xero=error&msg=' + encodeURIComponent(err.message))
  }
}
