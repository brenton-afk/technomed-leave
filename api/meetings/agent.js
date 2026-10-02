import { handleUpload } from '@vercel/blob/client'
import { STAFF } from '../../src/staffConfig.js'
import {
  saveMeeting, getMeeting, updateMeetingStatus,
  saveWorklistItem, getWorklist, updateWorklistItem, deleteWorklistItem
} from '../_redis.js'
import { sendMeetingSummaryEmail } from '../_email.js'
import { requireSession, getSession } from '../_auth.js'

// Everything for the meeting note taker lives in this one function, routed
// by ?action=. Vercel's Hobby plan caps a deployment at 12 serverless
// functions, and this app was already close to that — one file with
// internal routing (same pattern as api/auth/pin.js) keeps the new feature
// to a single function instead of six.

// ─── Who may reach any of this ───────────────────────────────────────────────
// None of it was behind a session. Meeting recordings, the transcripts made
// from them and the shared worklist were readable, writable and deletable by
// anyone who knew the URL — and a meeting is where the business says the things
// it does not write down anywhere else.
//
// The upload handshake is the one that cannot use the header. @vercel/blob's
// `upload()` builds its own request, so the session travels in `clientPayload`
// instead, which is the field that exists for exactly this and is checked
// before a token is handed out. Every other action is an ordinary fetch and
// carries the header.

export default async function handler(req, res) {
  const action = req.query.action

  if (action === 'blob-upload') return handleBlobUpload(req, res)

  const session = await requireSession(req, res)
  if (!session) return

  if (action === 'start-transcription') return handleStartTranscription(req, res)
  if (action === 'status') return handleStatus(req, res)
  if (action === 'analyze') return handleAnalyze(req, res)
  if (action === 'finalize') return handleFinalize(req, res)
  if (action === 'worklist') return handleWorklist(req, res)

  return res.status(400).json({ error: 'Unknown or missing action' })
}

// ─── Direct-to-Blob upload token handshake ─────────────────

async function handleBlobUpload(req, res) {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // The only place a session can be checked in this handshake: the SDK
        // builds its own request, so there is no header of ours on it. Throwing
        // here is what refuses the upload — handleUpload turns it into an error
        // response rather than issuing a token.
        let token = null
        try { token = JSON.parse(clientPayload || '{}').token } catch { token = null }
        const session = await getSession(token)
        if (!session) throw new Error('Not signed in, or your session has expired')

        return {
          allowedContentTypes: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-m4a'],
          addRandomSuffix: true,
          // Who recorded it, so an upload can be traced back to a person.
          tokenPayload: JSON.stringify({ by: session.email })
        }
      },
      onUploadCompleted: async ({ blob }) => {
        // No meeting content here on purpose — this is the one line that goes to
        // the platform log, and what was said in a meeting does not belong in it.
        console.log('Meeting audio uploaded:', blob.pathname)
      }
    })
    return res.status(200).json(jsonResponse)
  } catch (err) {
    console.error('blob-upload error:', err.message)
    return res.status(400).json({ error: err.message })
  }
}

// ─── Kick off AssemblyAI transcription from a Blob URL ─────

async function handleStartTranscription(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { audioUrl } = req.body
  if (!audioUrl) return res.status(400).json({ error: 'audioUrl is required' })

  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured' })

  try {
    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, speaker_labels: true })
    })
    if (!transcriptRes.ok) {
      const errText = await transcriptRes.text()
      throw new Error(`AssemblyAI request failed (${transcriptRes.status}): ${errText}`)
    }
    const { id } = await transcriptRes.json()
    return res.status(200).json({ transcriptId: id })
  } catch (err) {
    console.error('start-transcription error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// ─── Poll AssemblyAI transcription status ──────────────────

async function handleStatus(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Missing transcript id' })

  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured' })

  try {
    const r = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: apiKey }
    })
    const data = await r.json()

    if (data.status === 'error') return res.status(200).json({ status: 'error', error: data.error })
    if (data.status !== 'completed') return res.status(200).json({ status: data.status })

    const transcript = (data.utterances && data.utterances.length)
      ? data.utterances.map(u => `Speaker ${u.speaker}: ${u.text}`).join('\n')
      : data.text

    return res.status(200).json({ status: 'completed', transcript })
  } catch (err) {
    console.error('status error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// ─── Claude analysis: summary + action items ───────────────

async function handleAnalyze(req, res) {
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

// ─── Finalize: save to worklist + email everyone ───────────

async function handleFinalize(req, res) {
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

// ─── Worklist: list, update status, delete ─────────────────

async function handleWorklist(req, res) {
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
