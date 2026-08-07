import { STAFF } from '../../src/staffConfig.js'
import { saveMeeting } from '../_redis.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { transcript, meetingTitle, meetingDate, recordedByEmail } = req.body
  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: 'No transcript provided' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })

  const staffNames = STAFF.map(s => s.name).join(', ')

  const prompt = `You are analysing an internal meeting transcript for TechnoMed, a Tasmanian medical device distribution company. The staff members who could be assigned action items are exactly these people: ${staffNames}.

Only ever put a name from that exact list in "assignee" — match spoken names, first names, or nicknames to the closest full name on the list. If no one is clearly responsible for an item, use "Unassigned".

Return ONLY a JSON object (no markdown fences, no preamble, no trailing text) with this exact shape:
{
  "summary": "a plain 2-4 sentence summary of what the meeting covered, in your own words",
  "actionItems": [
    {
      "task": "short imperative description of the action",
      "assignee": "a name from the staff list, or Unassigned",
      "priority": "urgent, normal, or low based on stated deadlines or emphasis",
      "due_date": "YYYY-MM-DD if stated or clearly implied, else empty string",
      "notes": "one short sentence of context, paraphrased in your own words"
    }
  ]
}

If the transcript has no clear action items, return an empty actionItems array.

Transcript:
"""
${transcript}
"""`

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error (${claudeRes.status}): ${errText}`)
    }
    const claudeData = await claudeRes.json()
    const textBlock = (claudeData.content || []).find(b => b.type === 'text')
    if (!textBlock) throw new Error('No text in Claude response')

    const cleaned = textBlock.text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    const validNames = new Set(STAFF.map(s => s.name))
    const actionItems = (parsed.actionItems || []).map(it => ({
      task: it.task || '',
      assignee: validNames.has(it.assignee) ? it.assignee : 'Unassigned',
      priority: ['urgent', 'normal', 'low'].includes(it.priority) ? it.priority : 'normal',
      due_date: it.due_date || '',
      notes: it.notes || ''
    }))

    const meetingId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const meeting = {
      id: meetingId,
      title: meetingTitle || 'Untitled meeting',
      date: meetingDate || new Date().toISOString().slice(0, 10),
      recordedByEmail: recordedByEmail || null,
      summary: parsed.summary || '',
      transcript,
      actionItems,
      status: 'draft',
      createdAt: new Date().toISOString()
    }
    await saveMeeting(meetingId, meeting)

    return res.status(200).json({ meetingId, summary: meeting.summary, actionItems })
  } catch (err) {
    console.error('analyze error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
