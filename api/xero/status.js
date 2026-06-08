export default async function handler(req, res) {
  // Check if we have a valid Xero tenant ID configured
  const connected = !!(process.env.XERO_TENANT_ID && process.env.XERO_CLIENT_ID)
  res.status(200).json({ connected })
}
