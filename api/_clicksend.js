// ─── ClickSend SMS (Brent, 25 Nov 2026) ──────────────────────────────────────
// Event invites and reminders by text, through a ClickSend sub-account kept
// apart from Brent's own use: CLICKSEND_USERNAME and CLICKSEND_API_KEY are the
// sub-account's, CLICKSEND_FROM its dedicated number (replies and STOP come
// back to it). Raw REST, one JSON POST, as with Twilio.

import { normaliseMobile } from '../src/events/model.js'

export function clicksendConfigured() {
  return Boolean(process.env.CLICKSEND_USERNAME && process.env.CLICKSEND_API_KEY)
}

/** One text. Throws with ClickSend's own reason when it is refused. */
export async function sendClickSendSms(to, body) {
  const user = process.env.CLICKSEND_USERNAME
  const key = process.env.CLICKSEND_API_KEY
  if (!user || !key) throw new Error('SMS is not set up yet (ClickSend keys missing)')
  const number = normaliseMobile(to)
  if (!/^\+\d{8,15}$/.test(number)) throw new Error('No usable mobile number')
  const message = { source: 'technomed-portal', to: number, body: String(body).slice(0, 612) }
  if (process.env.CLICKSEND_FROM) message.from = process.env.CLICKSEND_FROM
  const res = await fetch('https://rest.clicksend.com/v3/sms/send', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64'),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ messages: [message] })
  })
  const data = await res.json().catch(() => ({}))
  const first = data?.data?.messages?.[0]
  if (!res.ok || (first && first.status && first.status !== 'SUCCESS')) {
    throw new Error(`ClickSend: ${first?.status || data?.response_code || res.status}`)
  }
  return { to: number, id: first?.message_id || '' }
}
