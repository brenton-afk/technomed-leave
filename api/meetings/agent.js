import { handleUpload } from '@vercel/blob/client'
import { STAFF } from '../../src/staffConfig.js'
import {
  saveMeeting, getMeeting, updateMeetingStatus,
  saveWorklistItem, getWorklist, updateWorklistItem, deleteWorklistItem
} from '../_redis.js'
import { sendMeetingSummaryEmail } from '../_email.js'
import { requireSession, getSession } from '../_auth.js'
import { flagRepeats } from '../_worklistMatch.js'

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
  // "Could she dump a transcript from a meeting into that section and have the
  // Claude agent build out a task and action list?" The extraction already
  // takes raw text, so pasting needs nothing here. A file does: this turns one
  // into text and hands it to the same analyse step.
  if (action === 'read-file') return handleReadFile(req, res)
  // And a task that came from nobody's meeting — the thing agreed in the car.
  if (action === 'add-task') return handleAddTask(req, res)

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

    // "The same action comes up at the weekly meeting three weeks running."
    //
    // Flagged against what is already open, never merged. Two tasks that read
    // alike are sometimes two different jobs, and a person reading both in two
    // seconds can tell where this cannot. See _worklistMatch.js.
    //
    // A failure here costs the flag, not the extraction: an action list that
    // arrives without the "haven't we said this" note is still the thing
    // somebody asked for.
    let flagged = actionItems
    try {
      flagged = flagRepeats(actionItems, await getWorklist())
    } catch (err) {
      console.error('repeat check skipped:', err.message)
    }

    const meetingId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const meeting = {
      id: meetingId,
      title: meetingTitle || 'Untitled meeting',
      date: meetingDate || new Date().toISOString().slice(0, 10),
      recordedByEmail: recordedByEmail || null,
      summary: parsed.summary || '',
      transcript,
      actionItems: flagged,
      status: 'draft',
      createdAt: new Date().toISOString()
    }
    await saveMeeting(meetingId, meeting)

    return res.status(200).json({ meetingId, summary: meeting.summary, actionItems: flagged })
  } catch (err) {
    console.error('analyze error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// ─── Turning a dumped file into text ─────────────────────────
// Three kinds, and each is read the way this repo already reads that kind.
//
//   · .txt  — it is already text
//   · .pdf  — handed to Claude as a document, which is how
//             _readBookingDocument.js reads the ones that arrive by email.
//             No PDF parser is added for the same reason it was not added
//             there: the model reads a scanned page and a text one alike
//   · .docx — mammoth, which is the one thing here that needed a dependency.
//             A .docx is a zip of XML and unpacking it by hand is a parallel
//             implementation of something fiddly and well solved
//
// The text is not stored. It goes to the analyse step, which keeps it on the
// meeting record as the transcript — the same place a recorded meeting's words
// already live.

const READABLE = {
  'text/plain': 'txt',
  'text/markdown': 'txt',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
}

/** The kind, from the media type where there is one and the name otherwise. */
function kindOf(mediaType, filename) {
  const byType = READABLE[String(mediaType || '').toLowerCase()]
  if (byType) return byType
  const ext = /\.([a-z0-9]+)$/i.exec(String(filename || ''))?.[1]?.toLowerCase()
  if (ext === 'txt' || ext === 'md') return 'txt'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  return null
}

async function handleReadFile(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { filename, mediaType, data } = req.body || {}
  if (!data) return res.status(400).json({ error: 'No file was sent' })

  const kind = kindOf(mediaType, filename)
  if (!kind) {
    return res.status(400).json({
      error: 'That file type cannot be read here. Save it as .txt, .docx or '
        + '.pdf, or paste the text straight in.'
    })
  }

  try {
    if (kind === 'txt') {
      return res.status(200).json({ text: Buffer.from(data, 'base64').toString('utf8') })
    }

    if (kind === 'docx') {
      const { default: mammoth } = await import('mammoth')
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data, 'base64') })
      return res.status(200).json({ text: value || '' })
    }

    // A PDF, read by Claude rather than parsed. Asked for the words only:
    // anything it adds of its own becomes a task somebody is told to do.
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
    const claude = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data }
            },
            {
              type: 'text',
              text: 'Return the text of this document, verbatim, as plain text. '
                + 'No summary, no commentary, no markdown fences. If it is a '
                + 'meeting transcript keep the speaker labels as they are.'
            }
          ]
        }]
      })
    })
    if (!claude.ok) {
      throw new Error(`Could not read the PDF (${claude.status})`)
    }
    const body = await claude.json()
    const text = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
    return res.status(200).json({ text })
  } catch (err) {
    // No file content in the message: a meeting document is exactly the kind
    // of thing that must not reach a log.
    console.error('read-file error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

// ─── A task nobody held a meeting about ──────────────────────
// The thing agreed in the car, or the one Erin already knows about and does
// not need a model's help to write down. Straight to the worklist, because
// there is nothing to review: whoever typed it is the review.

async function handleAddTask(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { task, assignee, priority, due_date: dueDate, notes, addedByEmail } = req.body || {}
  if (!String(task || '').trim()) return res.status(400).json({ error: 'Say what the task is' })

  const validNames = new Set(STAFF.map(s => s.name))
  const item = {
    id: `typed-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    task: String(task).trim().slice(0, 300),
    assignee: validNames.has(assignee) ? assignee : 'Unassigned',
    priority: ['urgent', 'normal', 'low'].includes(priority) ? priority : 'normal',
    due_date: dueDate || '',
    notes: String(notes || '').trim().slice(0, 500),
    status: 'open',
    // No meeting behind it. Said rather than left blank, so the board can show
    // where a task came from without having to guess from a missing field.
    source: 'typed',
    addedByEmail: addedByEmail || null,
    createdAt: new Date().toISOString()
  }

  try {
    await saveWorklistItem(item)
    return res.status(200).json({ ok: true, item })
  } catch (err) {
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
