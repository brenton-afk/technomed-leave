import Anthropic from '@anthropic-ai/sdk'
import { stripIdentifiers, normaliseSurgeon } from '../src/clinicalPlan/parse.js'
import { systemsInKit } from '../src/clinicalPlan/systems.js'

// ─── Reading a booking out of whatever arrived ───────────────────────────────
// Bookings turn up as a pasted theatre-list table, a PDF from the spine service,
// a photograph of a printed list, a few labelled lines typed by hand, or a
// sentence in the middle of an email. Writing a parser per format is a losing
// race: the next one is always a shape nobody anticipated.
//
// So anything that is not the one high-volume machine-readable format goes to
// the model instead. This is the same pipeline the usage scanner already uses —
// Anthropic SDK, PDFs and images as document/image blocks, structured JSON back
// — pointed at bookings rather than implant stickers.
//
// The deterministic RHH parser stays. It handles the weekly table exactly and
// for nothing, and there is no sense paying a model to read a well-formed table.
// See src/clinicalPlan/parseTheatreList.js.
//
// ── Patient identifiers ──
//
// Theatre lists carry given names and dates of birth. The app holds surnames and
// nothing else, so the prompt does not ask for them AND the code strips them on
// the way out. Belt and braces deliberately: a model told not to return
// something will usually comply, and "usually" is not a basis for handling
// health information.

const MODEL = process.env.BOOKING_VISION_MODEL || 'claude-opus-5'
export const ACCEPTED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

const PROMPT = `You are reading a surgical booking sent to a spinal implant distributor in Hobart, Tasmania. It may be a theatre list, a single booking, a scanned or photographed page, or a few lines in an email.

Extract every distinct surgical case you can find.

For each case return:
  surname     the patient's SURNAME ONLY, in normal case
  surgeon     the surgeon's surname as written
  date        the date of surgery as YYYY-MM-DD
  procedure   what is being done, e.g. "L5/S1 PLIF", "C4/5, C5/6 ACDF"
  kit         the implant system or systems named, exactly as written
  hospital    RHH for Royal Hobart, CLV for Calvary Lenah Valley, else ""
  theatre     theatre number if stated, else ""
  note        anything else that matters: a second surgeon, urgency, a request

NEVER return a patient's given name, initials, date of birth, UR number, MRN or
any other identifier. If the document shows "SMITH John 12/3/1958", return only
"Smith". This is a firm rule: the surname is the only patient detail permitted.

Do not guess. If a field is not stated, return "" for it. If you cannot tell
whether something is a case at all, leave it out — a person reviews everything
you return, and a plausible invention is far more damaging than an omission.

Dates: the year may be implied. These are Australian dates, so 9/10/26 is the
9th of October 2026, not the 10th of September.

Return ONLY JSON, no prose, of this shape:
{"cases":[{"surname":"","surgeon":"","date":"","procedure":"","kit":"","hospital":"","theatre":"","note":""}]}`

/** Anything that is not a surname, removed on the way out regardless of the prompt. */
function cleanCase(raw) {
  const surname = stripIdentifiers(String(raw?.surname || ''))
    .trim()
    // First token only, so "Smith John" cannot survive a model that ignored the
    // instruction.
    .split(/\s+/)[0] || ''
  const kit = stripIdentifiers(String(raw?.kit || ''))

  return {
    patient: surname ? surname.charAt(0).toUpperCase() + surname.slice(1).toLowerCase() : '',
    surgeon: normaliseSurgeon(raw?.surgeon) || stripIdentifiers(String(raw?.surgeon || '')).trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.date || '')) ? raw.date : null,
    procedure: stripIdentifiers(String(raw?.procedure || '')),
    kit,
    systems: systemsInKit(kit),
    hospital: /rhh|royal/i.test(String(raw?.hospital || '')) ? 'RHH'
      : /clv|calvary|lenah/i.test(String(raw?.hospital || '')) ? 'CLV' : '',
    theatre: String(raw?.theatre || '').replace(/\D/g, '') || null,
    note: stripIdentifiers(String(raw?.note || ''))
  }
}

/**
 * Candidate bookings from an email and its attachments.
 *
 * @param {{text?: string, subject?: string, attachments?: Array<{mediaType, data}>}} email
 *        `data` is base64. PDFs and images both go to the model as-is.
 * @returns {Promise<Array>} candidates, each `confident` only when the three
 *          things a booking cannot do without are present.
 */
export async function readBookingDocument(email = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Reading booking attachments needs ANTHROPIC_API_KEY')
  }

  const attachments = (email.attachments || []).filter(a => ACCEPTED_MEDIA.includes(a.mediaType))
  const content = attachments.map(a => (a.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
    : { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } }))

  const written = [email.subject, email.text].filter(Boolean).join('\n\n').trim()
  if (written) content.push({ type: 'text', text: `The email itself:\n\n${written}` })
  if (!content.length) return []

  content.push({ type: 'text', text: PROMPT })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const reply = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content }]
  })

  const text = reply.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const json = /\{[\s\S]*\}/.exec(text)
  if (!json) return []

  let parsed
  try {
    parsed = JSON.parse(json[0])
  } catch {
    // A reply that is not JSON is a reply that cannot be trusted to be complete,
    // and half a theatre list is worse than none.
    return []
  }

  return (parsed.cases || []).map(cleanCase).map(booking => ({
    ...booking,
    source: 'document',
    // Everything comes back for a person to look at. `confident` only says
    // whether it is worth pre-filling — nothing is ever accepted unseen.
    confident: Boolean(booking.patient && booking.surgeon && booking.date)
  })).filter(b => b.patient || b.surgeon)
}
