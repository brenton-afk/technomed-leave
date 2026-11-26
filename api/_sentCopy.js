// ─── A copy in the sender's own Gmail "Sent" (Brent, 26 Nov 2026) ────────────
// "When emailing from the portal, the sender of that email doesn't get a sent
// item in their inbox … the staff are used to being able to see their sent
// items … it needs to be really accessible and easy to use for staff." Then:
// "lets set up the sent item setting."
//
// An email the portal sends as a staff member (usage, notices, kit moves —
// anything whose From is their own @technomed.com.au address) is, once Resend
// has accepted it, also written into that person's Gmail with the SENT label,
// through the Gmail API's messages.insert acting as them (the service
// account's domain-wide delegation, scope gmail.insert). It is the same
// message — same From, To, Cc, subject, body, attachments and Message-ID — so
// it sits in their Sent folder and searches like anything they sent from
// Gmail. (Its Message-ID is the portal's own; Resend's is not overridden.)
//
// Never in the way: the email has already gone when this runs; a failure (the
// scope not granted yet, Gmail slow) is logged as a status and nothing else.
// Nothing here is ever sent anywhere — insert only files a message.
// Off under vitest unless SENT_COPY=on; SENT_COPY=off turns it off.

import { randomUUID } from 'node:crypto'

export const GMAIL_INSERT = 'https://www.googleapis.com/auth/gmail.insert'
const VERIFIED = /@technomed\.com\.au$/i
const TIME_LIMIT_MS = 8000

export const sentCopyOn = () => process.env.SENT_COPY !== 'off' && (!process.env.VITEST || process.env.SENT_COPY === 'on')

/** The copy's Message-ID. */
export const newMessageId = () => `<tm-${randomUUID()}@technomed.com.au>`

/** The sender's address when the email is From them, else ''. */
export function copyOwner(from, sender) {
  const email = String(sender?.email || '').trim().toLowerCase()
  if (!email || !VERIFIED.test(email)) return ''
  return String(from || '').toLowerCase().includes(email) ? email : ''
}

// RFC 2047 for a header with anything past plain ASCII (an en dash, a ™).
const header = v => (/^[\x20-\x7e]*$/.test(String(v || ''))
  ? String(v || '')
  : `=?UTF-8?B?${Buffer.from(String(v), 'utf8').toString('base64')}?=`)
const wrap76 = b64 => b64.replace(/.{1,76}/g, m => `${m}\r\n`)
const b64 = s => wrap76(Buffer.from(String(s || ''), 'utf8').toString('base64'))
const safeName = n => String(n || 'attachment').replace(/["\r\n\\]/g, '_')

/**
 * The email as Gmail stores it (RFC 822): mixed { alternative { text, html },
 * attachments… }. Attachments are { filename, content (base64), content_id?,
 * content_type? } — the shape send() gives Resend. Pure.
 */
export function buildMime({ messageId, date = new Date(), from, to = [], cc = [], replyTo, subject, html, text, attachments = [] }) {
  const mixed = `tm-mixed-${randomUUID()}`
  const alt = `tm-alt-${randomUUID()}`
  const lines = [
    `From: ${header(from)}`,
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${header(subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text || ''),
    ...(html ? [`--${alt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html)] : []),
    `--${alt}--`,
    ''
  ]
  for (const a of attachments) {
    if (!a?.content) continue
    const name = safeName(a.filename)
    const type = a.content_type || guessType(name)
    lines.push(
      `--${mixed}`,
      `Content-Type: ${type}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      a.content_id ? `Content-ID: <${a.content_id}>` : null,
      `Content-Disposition: ${a.content_id ? 'inline' : 'attachment'}; filename="${name}"`,
      '',
      wrap76(String(a.content).replace(/\s+/g, ''))
    )
  }
  lines.push(`--${mixed}--`, '')
  return lines.filter(l => l !== null).join('\r\n')
}

function guessType(name) {
  const ext = String(name).toLowerCase().split('.').pop()
  return {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ics: 'text/calendar', txt: 'text/plain', csv: 'text/csv'
  }[ext] || 'application/octet-stream'
}

/**
 * Files the message in the owner's Gmail as sent. Returns 'filed', 'off', or
 * a short reason it was not (never throws, never names the patient).
 */
export async function copyToSent(message, owner, { getToken, fetchImpl = fetch } = {}) {
  if (!owner || !sentCopyOn()) return 'off'
  let token
  try {
    token = await getToken(GMAIL_INSERT, { impersonate: owner })
  } catch (err) {
    // Usually: gmail.insert not yet added to the domain-wide delegation.
    return /unauthorized_client|access_denied|invalid_grant|not authorized/i.test(String(err?.message))
      ? 'not allowed yet' : 'no token'
  }
  const raw = Buffer.from(buildMime(message), 'utf8').toString('base64url')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIME_LIMIT_MS)
  try {
    const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages?internalDateSource=dateHeader', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw, labelIds: ['SENT'] }),
      signal: ctrl.signal
    })
    if (res.ok) return 'filed'
    return res.status === 403 ? 'not allowed yet' : `gmail ${res.status}`
  } catch (err) {
    return err?.name === 'AbortError' ? 'gmail slow' : 'gmail unreachable'
  } finally {
    clearTimeout(timer)
  }
}
