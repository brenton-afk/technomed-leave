// ─── Twilio SMS ───────────────────────────────────────────────────────────────
// Raw REST rather than the SDK: one form-encoded POST, and the serverless
// bundle stays small.

// Australian mobiles are stored however staff type them; Twilio needs E.164.
export function toE164(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '')
  if (!digits) return null
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('61')) return `+${digits}`
  if (digits.startsWith('0')) return `+61${digits.slice(1)}`
  if (digits.length === 9) return `+61${digits}` // 4xxxxxxxx
  return null
}

export function twilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  )
}

export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  if (!sid || !authToken || !from) throw new Error('Twilio is not configured')

  const number = toE164(to)
  if (!number) throw new Error('No usable mobile number')

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: number, From: from, Body: body })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || `Twilio error ${res.status}`)
  return { sid: data.sid, to: number }
}
