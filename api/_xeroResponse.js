// ─── Reading what Xero actually sent back ────────────────────────────────────
// Xero's payroll API answers errors with XML — "<Response><ErrorNumber>…" —
// whatever the Accept header asked for. Every call here did `await res.json()`,
// which throws on the first angle bracket, and the thrown parse error then
// replaced the real one.
//
// So a staff member submitting a timesheet on a Sunday morning was told:
//
//   Unexpected token '<', "<Response" ... is not valid JSON
//
// Which says nothing about what was wrong, cannot be acted on, and hid the
// message Xero had actually sent. The failure was bad; losing the reason was
// worse.
//
// This reads the body once as text and decides afterwards. JSON is parsed as
// JSON. XML has its message pulled out. Anything else is reported with its
// status code, because "Xero said 502" is a fact somebody can use and a parse
// error is not.

/** Every ValidationErrors[].Message anywhere in a JSON body, once each. */
export function validationMessages(value, out = [], depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return out
  if (Array.isArray(value)) {
    for (const v of value) validationMessages(v, out, depth + 1)
    return out
  }
  for (const [key, v] of Object.entries(value)) {
    if (key === 'ValidationErrors' && Array.isArray(v)) {
      for (const e of v) {
        const m = typeof e?.Message === 'string' ? e.Message.trim() : ''
        if (m && !out.includes(m)) out.push(m)
      }
    } else if (v && typeof v === 'object') {
      validationMessages(v, out, depth + 1)
    }
  }
  return out
}

/** The human-readable message out of a Xero XML error body. */
function messageFromXml(text) {
  const parts = []
  // The top-level complaint.
  const message = /<Message>([\s\S]*?)<\/Message>/i.exec(text)
  if (message) parts.push(decode(message[1]))
  // Field-level validation, which is where the useful detail usually is.
  for (const m of text.matchAll(/<ValidationError>[\s\S]*?<Message>([\s\S]*?)<\/Message>[\s\S]*?<\/ValidationError>/gi)) {
    const detail = decode(m[1])
    if (detail && !parts.includes(detail)) parts.push(detail)
  }
  return parts.join('; ')
}

function decode(xml) {
  return String(xml)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The body of a Xero response, and a usable error if it is one.
 *
 * @returns {{ok: boolean, status: number, data: object, error: string|null}}
 *   `data` is the parsed JSON where there was any, and `{}` otherwise — so
 *   callers can keep reading fields off it without checking first.
 */
export async function readXero(res, what = 'Xero') {
  const status = res.status
  const text = await res.text().catch(() => '')

  let data = {}
  let parsed = false
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { data = JSON.parse(text); parsed = true } catch { data = {} }
  }

  // Xero reports some failures with a 200 and an ErrorNumber in the body, so
  // the status alone is not enough to go on.
  const failed = !res.ok || Boolean(data?.ErrorNumber)

  if (!failed) return { ok: true, status, data, error: null }

  const fromJson = parsed
    ? [
      // Wherever Xero put them. It is not always Elements[0]: a leave
      // application's reasons can sit on a later element or on one of its
      // LeavePeriods, and missing them left Erin with only "A validation
      // exception occurred" (approving Brent's leave, 5 Nov 2026).
      validationMessages(data).join('; '),
      data.Message,
      data.detail,
      data.error_description,
      data.error
    ].find(v => typeof v === 'string' && v.trim())
    : null

  const fromXml = !parsed && text.includes('<') ? messageFromXml(text) : ''

  // Always carries the status. When Xero says nothing useful — an empty 502,
  // an HTML gateway page — the number is the only thing anybody can act on.
  const detail = fromJson || fromXml
  return {
    ok: false,
    status,
    data,
    error: detail ? `${what}: ${detail} (${status})` : `${what} failed (${status})`
  }
}
