export default async function handler(req, res) {
  const { code } = req.query

  if (!code) {
    return res.status(400).json({ success: false, error: 'No authorisation code provided' })
  }

  try {
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
        ).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.XERO_REDIRECT_URI
      })
    })

    const tokens = await tokenRes.json()

    if (!tokens.access_token) {
      throw new Error(tokens.error_description || 'Token exchange failed')
    }

    const connectionsRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const connections = await connectionsRes.json()
    const tenantId = connections[0]?.tenantId

    if (!tenantId) throw new Error('No Xero organisation found')

    // Save tokens and tenant ID to Redis
    const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
    const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

    const saveData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      tenant_id: tenantId,
      expires_at: Date.now() + (tokens.expires_in * 1000)
    }

    await fetch(`${REDIS_URL}/set/xero_tokens/${encodeURIComponent(JSON.stringify(saveData))}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    })

    console.log('Xero connected. Tenant ID:', tenantId)
    res.redirect('/?xero=connected')
  } catch (err) {
    console.error('Xero callback error:', err)
    res.redirect('/?xero=error&msg=' + encodeURIComponent(err.message))
  }
}
