import Anthropic from '@anthropic-ai/sdk'
import { redis } from './_redis.js'
import { sendServiceAlertEmail } from './_email.js'

// ─── Talking to Claude, and what happens when it will not ────────────────────
// Ben, in the New booking screen: a raw 400 invalid_request_error reading "Your
// credit balance is too low to access the Anthropic API".
//
// Three separate failures in one screenshot:
//
//   · the account had run out of credit, which nobody knew until a rep in a
//     corridor found out on our behalf;
//   · the API's own JSON was put on a phone screen, where it reads as the app
//     being broken rather than a bill being unpaid;
//   · and there was no timeout, so the slow version of the same problem is a
//     Vercel 504 after 60 seconds, which looks like nothing happening at all.
//
// This wraps every call to Claude so all three are handled the same way
// wherever they happen: dictating a booking, routing a voice command, reading a
// booking email, scanning a usage form.
//
// ── Why the message is per-caller ──
//
// "Voice booking is unavailable right now — please fill in the form below" is
// the right sentence in the booking screen and a confusing one on the scan
// screen. The caller supplies it, because only the caller knows what the person
// reading it was trying to do and what they should do instead.

/**
 * How long to wait.
 *
 * Twenty seconds, and the retry count is cut to one to match. The SDK's own
 * defaults are a ten-minute timeout and two retries, which are sane for a
 * server job and wrong here: this runs inside a Vercel function that is killed
 * at sixty seconds, and a call that is still waiting when that happens produces
 * a 504 — the one failure the app cannot turn into a sentence, because the
 * function is gone before it can.
 */
export const AI_TIMEOUT_MS = 20000
const AI_MAX_RETRIES = 1

/** What went wrong, in the terms that decide what to do about it. */
export const AI_FAULTS = ['billing', 'auth', 'busy', 'timeout', 'unknown']

/**
 * An AI call that did not work.
 *
 * `message` is the caller's sentence and is what a person reads. `detail` is
 * the API's own words, which go to the server log and nowhere else.
 */
export class AiUnavailable extends Error {
  constructor(friendly, detail, fault) {
    super(friendly)
    this.name = 'AiUnavailable'
    this.detail = String(detail || '').slice(0, 400)
    this.fault = AI_FAULTS.includes(fault) ? fault : 'unknown'
  }
}

/**
 * Which kind of failure this is.
 *
 * The distinction that matters is "somebody has to do something about it"
 * (billing, auth) versus "try again in a minute" (busy, timeout). Only the
 * first kind is worth waking Brent for.
 */
export function classify(err) {
  const status = err?.status ?? err?.response?.status
  const text = `${err?.message || ''} ${JSON.stringify(err?.error || '')}`.toLowerCase()

  if (/credit balance|billing|payment|quota/.test(text)) return 'billing'
  if (status === 401 || /authentication|invalid x-api-key|api key/.test(text)) return 'auth'
  if (status === 403) return 'auth'
  if (err?.name === 'APIConnectionTimeoutError' || /timeout|timed out|aborted/.test(text)) return 'timeout'
  if (status === 429 || status === 529 || status >= 500) return 'busy'
  // A 400 that is not about credit is a bug in the request, not an outage, and
  // the person holding the phone can do nothing about either.
  return 'unknown'
}

/** What a server log should say about it — never the prompt, never a patient. */
function logLine(feature, fault, err) {
  const status = err?.status ?? err?.response?.status ?? ''
  return `AI call failed (${feature}): ${fault}${status ? ` ${status}` : ''}`
}

/**
 * Tells Brent, at most once a day per feature.
 *
 * Once, because the failure mode here is every staff member hitting the same
 * dead API all morning: one alert is information and forty is a reason to
 * filter the sender. Keyed by day in Hobart, set with NX so the first call of
 * the day wins and the rest cost one Redis round trip.
 *
 * Never throws. An alert that fails must not take the booking screen with it,
 * and the most likely reason it would fail is the thing being alerted about.
 */
export async function alertOnce(feature, fault, detail, today) {
  if (fault !== 'billing' && fault !== 'auth') return false
  const day = today || new Date().toISOString().slice(0, 10)
  const key = `ai-alert:${feature}:${day}`

  try {
    const first = await redis('setnx', key, '1')
    if (String(first) !== '1') return false
    // Two days, so a Sunday failure is still only alerted once.
    await redis('expire', key, '172800')
    await sendServiceAlertEmail({ feature, fault, detail })
    return true
  } catch {
    return false
  }
}

/**
 * One call to Claude, with the failure handled.
 *
 * @param {object} o
 * @param {string} o.feature        what this is for, used in the log and alert
 * @param {string} o.whenUnavailable the sentence a person should read
 * @param {object} o.request        the Messages API request, as the SDK takes it
 */
export async function askClaude({ feature, whenUnavailable, request, timeoutMs }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Not an outage — a deploy that was never finished. Said plainly in the
    // log, and the same sentence on screen, because the difference is not one
    // the person reading it can act on.
    console.error(`AI call skipped (${feature}): ANTHROPIC_API_KEY not configured`)
    await alertOnce(feature, 'auth', 'ANTHROPIC_API_KEY is not set')
    throw new AiUnavailable(whenUnavailable, 'ANTHROPIC_API_KEY not configured', 'auth')
  }

  const client = new Anthropic({
    apiKey,
    timeout: timeoutMs || AI_TIMEOUT_MS,
    maxRetries: AI_MAX_RETRIES
  })

  try {
    return await client.messages.create(request)
  } catch (err) {
    const fault = classify(err)
    console.error(logLine(feature, fault, err))
    await alertOnce(feature, fault, err?.message)
    throw new AiUnavailable(whenUnavailable, err?.message, fault)
  }
}

/**
 * The same, for a call that streams.
 *
 * Scanning a usage form streams on purpose — a long extraction would otherwise
 * trip the HTTP request timeout — so it cannot use the call above. What it
 * needs is the other half: the same classification, the same alert, and the
 * same promise that an API's own JSON never reaches a phone.
 *
 * The timeout is the function's budget rather than twenty seconds. A vision
 * pass over six scanned pages legitimately takes most of a minute, and cutting
 * it short would turn a working feature into a broken one for no reason.
 */
export async function streamClaude({ feature, whenUnavailable, request, timeoutMs }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error(`AI call skipped (${feature}): ANTHROPIC_API_KEY not configured`)
    await alertOnce(feature, 'auth', 'ANTHROPIC_API_KEY is not set')
    throw new AiUnavailable(whenUnavailable, 'ANTHROPIC_API_KEY not configured', 'auth')
  }

  const client = new Anthropic({
    apiKey,
    timeout: timeoutMs || 55000,
    maxRetries: AI_MAX_RETRIES
  })

  try {
    return await client.messages.stream(request).finalMessage()
  } catch (err) {
    const fault = classify(err)
    console.error(logLine(feature, fault, err))
    await alertOnce(feature, fault, err?.message)
    throw new AiUnavailable(whenUnavailable, err?.message, fault)
  }
}
