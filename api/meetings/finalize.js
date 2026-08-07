import { STAFF } from '../../src/staffConfig.js'
import { getMeeting, updateMeetingStatus, saveWorklistItem } from '../_redis.js'
import { sendMeetingSummaryEmail } from '../_email.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { meetingId, actionItems } = req.body
  if (!meetingId || !Array.isArray(actionItems)) {
    return res.status(400).json({ error: 'meetingId and actionItems are required' })
  }

  const meeting = await getMeeting(meetingId)
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' })

  const stamped = actionItems.map((it, i) => ({
    id: `${meetingId}-${i}`,
    task: it.task,
    assignee: it.assignee || 'Unassigned',
    priority: ['urgent', 'normal', 'low'].includes(it.priority) ? it.priority : 'normal',
    due_date: it.due_date || '',
    notes: it.notes || '',
    status: 'open',
    sourceMeetingId: meetingId,
    sourceMeetingTitle: meeting.title,
    sourceMeetingDate: meeting.date,
    createdAt: new Date().toISOString()
  }))

  await Promise.all(stamped.map(item => saveWorklistItem(item)))
  await updateMeetingStatus(meetingId, 'sent', stamped)

  // Every staff member gets the minutes; each email only lists that
  // person's own action items (empty state if they have none this time).
  const emailResults = []
  for (const staff of STAFF) {
    const myItems = stamped.filter(it => it.assignee === staff.name)
    try {
      await sendMeetingSummaryEmail(staff, meeting, myItems)
      emailResults.push({ email: staff.email, sent: true })
    } catch (err) {
      console.error(`Email to ${staff.email} failed:`, err.message)
      emailResults.push({ email: staff.email, sent: false, error: err.message })
    }
  }

  return res.status(200).json({ success: true, itemCount: stamped.length, emailResults })
}
