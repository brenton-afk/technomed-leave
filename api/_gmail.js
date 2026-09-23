import { getGoogleToken } from './_googleCalendar.js'

// ─── Reading the bookings mailbox ────────────────────────────────────────────
// Read-only, deliberately. The app takes bookings out of this mailbox and never
// writes to it, replies to it, or marks anything in it — see the note in
// src/clinicalPlan/bookingSources.js about what must never be sent back to a
// hospital. A read-only scope makes that a property of the credential rather
// than a promise in a comment.
//
// Acting as bookings@ requires domain-wide delegation, granted once in the
// Workspace admin console. Until that is done Google refuses the token, and
// getGoogleToken turns that refusal into the exact client ID and scope to
// authorise — the error a person actually needs, rather than the one Google
// sends.

const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly'
const MAILBOX = process.env.BOOKINGS_MAILBOX || 'bookings@technomed.com.au'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

async function gmail(path, { impersonate = MAILBOX } = {}) {
  // getGoogleToken already turns a refused impersonation into instructions
  // naming the client ID and the scope to authorise, so let it through as it is
  // rather than replacing it with a vaguer version of the same thing.
  const token = await getGoogleToken(GMAIL_READONLY, { impersonate })

  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw await gmailError(res)
  return res.json()
}

/**
 * A Google API failure as a sentence, not as a page of JSON.
 *
 * Google's error bodies are thorough and unreadable — the same message repeated
 * four times inside nested `details`, wrapped around the one line that says what
 * to do. On a phone that fills the screen and buries the instruction. So: take
 * the message, and keep the activation link when there is one, because the fix
 * for a disabled API is to open that link and press a button.
 */
async function gmailError(res) {
  const body = await res.text()
  let parsed
  try {
    parsed = JSON.parse(body)?.error
  } catch {
    parsed = null
  }
  if (!parsed?.message) {
    return new Error(`The mailbox could not be read (${res.status}).`)
  }

  // "…visiting <url> then retry" is already in the message; no sense repeating
  // the link underneath it.
  const url = parsed.details
    ?.find(d => d.metadata?.activationUrl)?.metadata.activationUrl
  const message = parsed.message.split(/\s*If you enabled this API recently/)[0].trim()

  return Object.assign(
    new Error(url && !message.includes(url) ? `${message}\n\n${url}` : message),
    { status: res.status })
}

/** Header value by name, case-insensitively. */
function header(payload, name) {
  const found = (payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())
  return found?.value || ''
}

function decode(data) {
  return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

/**
 * The body and attachments of one message, flattened out of MIME.
 *
 * Attachments come back as base64 ready for the model — a theatre list is
 * routinely a PDF or a photograph, and the body of those emails says nothing
 * but "please find attached".
 */
function walk(part, out) {
  if (!part) return out
  const type = part.mimeType || ''
  const filename = part.filename || ''

  if (!filename && type === 'text/plain' && part.body?.data) out.text += decode(part.body.data)
  else if (!filename && type === 'text/html' && part.body?.data) out.html += decode(part.body.data)
  else if (filename && part.body?.attachmentId) {
    out.attachments.push({ filename, mediaType: type, attachmentId: part.body.attachmentId })
  }

  for (const child of part.parts || []) walk(child, out)
  return out
}

/** Message ids in the mailbox matching a Gmail search. */
export async function searchMailbox(query, { max = 25 } = {}) {
  const data = await gmail(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(max, 100)}`)
  return (data.messages || []).map(m => m.id)
}

/** One message, with its attachments fetched. */
export async function readMessage(id, { withAttachments = true } = {}) {
  const message = await gmail(`/messages/${encodeURIComponent(id)}?format=full`)
  const parts = walk(message.payload, { text: '', html: '', attachments: [] })

  if (withAttachments) {
    for (const attachment of parts.attachments) {
      try {
        const body = await gmail(
          `/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.attachmentId)}`)
        // Gmail gives URL-safe base64; the Anthropic SDK wants standard.
        attachment.data = String(body.data || '').replace(/-/g, '+').replace(/_/g, '/')
        attachment.declaredMediaType = attachment.mediaType
        attachment.mediaType = sniffMediaType(attachment.data, attachment.mediaType)
      } catch {
        // One unreadable attachment must not lose the rest of the email.
        attachment.data = null
      }
    }
  }

  return {
    id,
    threadId: message.threadId,
    from: header(message.payload, 'From'),
    subject: header(message.payload, 'Subject'),
    date: header(message.payload, 'Date'),
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    text: parts.text,
    html: parts.html,
    attachments: parts.attachments.filter(a => a.data)
  }
}

/**
 * What an attachment actually is, from its first bytes.
 *
 * Mail clients declare the type in the MIME header and they are routinely wrong
 * — a phone photo forwarded through two mail apps arrives labelled image/png and
 * is a JPEG. Anthropic checks, and rejects the mismatch, which failed the whole
 * run over one mislabelled photo of a theatre list.
 *
 * The bytes are not wrong, so read those and ignore what the email claims.
 */
export function sniffMediaType(base64, declared = '') {
  // Whitespace first: base64 out of a MIME body is often wrapped at 76 columns,
  // and newlines inside the first 32 characters leave too few bytes to match.
  const head = Buffer.from(String(base64 || '').replace(/\s+/g, '').slice(0, 32), 'base64')
  if (head.length < 4) return declared

  if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'image/jpeg'
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'image/png'
  if (head.toString('latin1', 0, 4) === '%PDF') return 'application/pdf'
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (head.toString('latin1', 0, 3) === 'GIF') return 'image/gif'
  return declared
}

/** Just the address out of "Toni Hoppitt <toni@…>". */
export function addressOf(from) {
  const m = /<([^>]+)>/.exec(String(from || ''))
  return (m ? m[1] : String(from || '')).trim().toLowerCase()
}
