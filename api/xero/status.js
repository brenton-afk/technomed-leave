import { getXeroConnectionStatus } from '../_xeroClient.js'

export default async function handler(req, res) {
  try {
    const status = await getXeroConnectionStatus()
    res.status(200).json(status)
  } catch (err) {
    res.status(200).json({ connected: false, error: err.message })
  }
}
