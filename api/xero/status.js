export default async function handler(req, res) {
  try {
    const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
    const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
    const response = await fetch(`${REDIS_URL}/get/xero_tokens`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    })
    const data = await response.json()
    if (data.result) {
      const tokens = JSON.parse(decodeURIComponent(data.result))
      res.status(200).json({ connected: true, tenant_id: tokens.tenant_id })
    } else {
      res.status(200).json({ connected: false })
    }
  } catch (err) {
    res.status(200).json({ connected: false, error: err.message })
  }
}
