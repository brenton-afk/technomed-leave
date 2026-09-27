import Anthropic from '@anthropic-ai/sdk'
import { stripIdentifiers, normaliseSurgeon } from '../src/clinicalPlan/parse.js'
import { systemsInKit } from '../src/clinicalPlan/systems.js'
import { SURGEON_COLOUR_NAMES } from '../src/clinicalPlan/colours.js'
import { INVENTORY } from '../src/clinicalPlan/inventory.js'
import { TZ, zonedCivil, toDateStr, weekdayName } from '../src/clinicalPlan/week.js'

// ─── Taking a booking by voice ───────────────────────────────────────────────
// Somebody standing in a corridor with a phone in one hand says "Cooper,
// Ibbett, RHH, Friday the second, L4/5 PLIF, Diplomat plus an LHC cage" and the
// booking form fills itself in.
//
// Two steps, both here so the app makes one request and gets back a filled
// form: AssemblyAI turns the audio into words, then the model turns the words
// into fields.
//
// ── Why it fills the form rather than making the booking ──
//
// Speech recognition is good at English and bad at surnames. "Petrusma",
// "Ibbett", "Bewg" and "Crammond" are not in anyone's language model, and
// neither is "Diplomat" in the sense we mean it. A dictated booking that went
// straight to the calendar would be wrong often enough to be dangerous, and
// wrong in the specific way that matters — the patient's name.
//
// So this returns fields for a person to glance at. The whole flow is: speak,
// look, tap. The looking is not optional and the form makes that obvious by
// showing what was heard alongside what was understood.

const MODEL = process.env.BOOKING_VISION_MODEL || 'claude-opus-5'

// AssemblyAI is told the words it is most likely to mishear. Surgeon surnames
// and implant systems are exactly the vocabulary a general model has never
// seen, and this is the difference between "Ibbett" and "it bet".
const VOCABULARY = [
  ...Object.keys(SURGEON_COLOUR_NAMES),
  'Peters-Willke',
  ...INVENTORY.map(i => i.system),
  'RHH', 'Royal Hobart', 'Calvary', 'Lenah Valley', 'CLV',
  'ACDF', 'ALIF', 'PLIF', 'TLIF', 'DLIF', 'PSF', 'corpectomy', 'laminectomy',
  'pedicle', 'lateral mass', 'AIRO', 'Brainlab', 'Varioguide', 'consignment'
]

/** Audio straight to AssemblyAI, no intermediate storage of our own. */
async function transcribe(audioBase64, contentType) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) throw new Error('Dictation needs ASSEMBLYAI_API_KEY')

  const upload = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': contentType || 'application/octet-stream' },
    body: Buffer.from(audioBase64, 'base64')
  })
  if (!upload.ok) throw new Error(`Could not send the recording (${upload.status})`)
  const { upload_url: audioUrl } = await upload.json()

  const started = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      // One person dictating, so no speaker labels — they only add noise here.
      word_boost: VOCABULARY,
      boost_param: 'high',
      punctuate: true,
      format_text: true
    })
  })
  if (!started.ok) throw new Error(`Could not start transcription (${started.status})`)
  const { id } = await started.json()

  // Polled here rather than from the phone, so the app makes one request and
  // waits once. A booking dictation is seconds long; the route allows sixty.
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1200))
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: apiKey }
    })
    const data = await poll.json()
    if (data.status === 'completed') return String(data.text || '').trim()
    if (data.status === 'error') throw new Error(`Could not read the recording: ${data.error}`)
  }
  throw new Error('The recording took too long to transcribe. Try a shorter one.')
}

function promptFor(transcript, today) {
  const surgeons = Object.keys(SURGEON_COLOUR_NAMES).join(', ')
  const systems = INVENTORY.map(i => i.system).join(', ')

  return `A staff member at a Tasmanian spinal implant distributor has dictated a surgical booking out loud. Below is an automatic transcription of what they said. Turn it into booking fields.

Today is ${weekdayName(today)} ${today}, in Hobart.

Resolve spoken dates against that. "Friday" or "next Friday" means the coming Friday; "the second" means the 2nd of the nearest sensible month, which is usually ahead rather than behind. Return YYYY-MM-DD. If no date was said at all, return "".

The surgeons are: ${surgeons}, and Peters-Willke, who is also called JPW.
The implant systems are: ${systems}.

Transcription is unreliable on surnames and product names — it has never heard of these people or these systems. Where a spoken word is clearly a mangled version of a name on those lists, correct it. Where it is not clear, keep what was said rather than guessing at a name: a wrong surgeon is worse than an odd one.

Return each field, or "" where nothing was said:
  surname     the patient's SURNAME ONLY
  surgeon     one of the surgeons above, spelled as above
  date        YYYY-MM-DD
  hospital    RHH or CLV
  procedure   e.g. "L4/5 PLIF", "C4/5, C5/6 ACDF"
  kit         the implant system or systems named
  note        anything else said that matters and does not fit above

NEVER return a given name, date of birth, UR number or any other patient
identifier, even if one was dictated. The surname is the only patient detail
permitted, and if a full name was said, return only the surname.

Return ONLY JSON:
{"surname":"","surgeon":"","date":"","hospital":"","procedure":"","kit":"","note":"","unclear":""}

Put in "unclear" a short plain-English note about anything you could not make out or had to guess at, or "" if it was all clear. This is shown to the person so they know what to check.`
}

/**
 * A dictated booking, as fields for the form.
 *
 * @param {{audio: string, contentType?: string}} input `audio` is base64.
 * @returns {Promise<{transcript: string, fields: object, unclear: string}>}
 */
export async function readDictatedBooking({ audio, contentType } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Dictation needs ANTHROPIC_API_KEY')
  if (!audio) throw new Error('No recording was received')

  const transcript = await transcribe(audio, contentType)
  if (!transcript) {
    throw new Error('Nothing could be heard in that recording. Try again, closer to the phone.')
  }

  const today = toDateStr(zonedCivil(new Date(), TZ))
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const reply = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: promptFor(transcript, today) }]
  })

  const text = reply.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const json = /\{[\s\S]*\}/.exec(text)
  let parsed = {}
  try {
    parsed = json ? JSON.parse(json[0]) : {}
  } catch {
    parsed = {}
  }

  // Identifiers stripped on the way out whatever the prompt asked for, and the
  // surname taken as the first token so a full name cannot survive.
  const surname = stripIdentifiers(String(parsed.surname || '')).trim().split(/\s+/)[0] || ''
  const kit = stripIdentifiers(String(parsed.kit || ''))

  return {
    // Shown back to the person, so a misheard word is obvious rather than
    // buried in a field that looks confidently filled in.
    transcript,
    unclear: stripIdentifiers(String(parsed.unclear || '')),
    fields: {
      patient: surname ? surname.charAt(0).toUpperCase() + surname.slice(1).toLowerCase() : '',
      surgeon: normaliseSurgeon(parsed.surgeon) || '',
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || '')) ? parsed.date : '',
      hospital: /rhh|royal/i.test(String(parsed.hospital || '')) ? 'RHH'
        : /clv|calvary|lenah/i.test(String(parsed.hospital || '')) ? 'CLV' : '',
      procedure: stripIdentifiers(String(parsed.procedure || '')),
      kit,
      systems: systemsInKit(kit),
      note: stripIdentifiers(String(parsed.note || ''))
    }
  }
}
