import { getWorklist, updateWorklistItem, deleteWorklistItem } from '../_redis.js'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const items = await getWorklist()
    return res.status(200).json({ items })
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body
    if (!id || !status) return res.status(400).json({ error: 'id and status are required' })
    const updated = await updateWorklistItem(id, { status })
    return res.status(200).json({ item: updated })
  }

  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id is required' })
    await deleteWorklistItem(id)
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
