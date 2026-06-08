export default async function handler(req, res) {
  const { code } = req.query

  if (!code) {
    return res.status(400).json({ success: false, error: 'No authorisation code provided' })
  }

  try {
    // Exchange code for tokens
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

    // Get tenant ID (Xero organisation)
    const connectionsRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const connections = await connectionsRes.json()
    const tenantId = connections[0]?.tenantId

    if (!tenantId) throw new Error('No Xero organisation found')

    // In production, store tokens securely (database or Vercel KV)
    // For now, we store in environment — see README for Vercel KV setup
    console.log('Xero connected. Tenant ID:', tenantId)
    console.log('Access token obtained. Refresh token available:', !!tokens.refresh_token)

    // Redirect back to app with success
    res.redirect('/?xero=connected')
  } catch (err) {
    console.error('Xero callback error:', err)
    res.redirect('/?xero=error')
  }
}
