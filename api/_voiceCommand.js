import Anthropic from '@anthropic-ai/sdk'
import { transcribe, readDictatedBooking } from './_readDictatedBooking.js'
import { stripIdentifiers } from '../src/clinicalPlan/parse.js'
import {
  commandPrompt, readCommand, stripWake, SPOKEN_VOCABULARY
} from '../src/voice/command.js'
import { TZ, zonedCivil, toDateStr, weekdayName } from '../src/clinicalPlan/week.js'

// ─── One button, four things ─────────────────────────────────────────────────
// "I want a voice option to be able to add/amend list orders or add a reminder
// to the portal. Like a speak function that says 'Hey TM Portal, I want to add
// a booking', or 'Hey TM portal, I want to add a reminder', 'Hey TM portal I
// want to update the list order for tomorrow'."
//
// Two steps, both here so the app makes one request and gets back something it
// can show: AssemblyAI turns the audio into words, then the model decides which
// of four things the words are asking for and pulls out the detail.
//
// ── Why the booking path is untouched ──
//
// Dictating a booking already worked, and it does the hard part — resolving a
// kit against a procedure, taking the surname as the first token so a full name
// cannot survive. When the router decides it heard a booking it hands the same
// audio to that same reader rather than re-implementing it in a second voice.
// Two readers of the same sentence is how the two come to disagree.

const MODEL = process.env.BOOKING_VISION_MODEL || 'claude-opus-5'

/**
 * A spoken command, read but not acted on.
 *
 * Nothing here writes anything. It returns what was heard and what it would do,
 * and the app does it only after somebody has tapped — which is the whole
 * design, because speech recognition is good at English and bad at surnames.
 *
 * @returns {{transcript: string, command: object, booking?: object}}
 */
export async function readVoiceCommand({ audio, contentType, now = new Date() } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Voice needs ANTHROPIC_API_KEY')
  if (!audio) throw new Error('No recording was received')

  const transcript = await transcribe(audio, contentType, SPOKEN_VOCABULARY)
  if (!transcript) {
    throw new Error('Nothing could be heard in that recording. Try again, closer to the phone.')
  }

  const civil = zonedCivil(now, TZ)
  const today = toDateStr(civil)

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const reply = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    thinking: { type: 'adaptive' },
    messages: [{
      role: 'user',
      content: commandPrompt(transcript, { today, weekday: weekdayName(today) })
    }]
  })

  const text = reply.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const json = /\{[\s\S]*\}/.exec(text)
  let routed = {}
  try {
    routed = json ? JSON.parse(json[0]) : {}
  } catch {
    // An unreadable routing is an unclear command, not an error. The person is
    // standing in a corridor; "say it again" is a better answer than a stack
    // trace.
    routed = {}
  }

  const command = scrub(readCommand(routed))

  // A booking goes to the reader that already knows how to read one. It costs a
  // second pass over the same audio and buys one place where a booking is
  // understood rather than two that can drift.
  if (command.intent === 'booking') {
    const booking = await readDictatedBooking({ audio, contentType })
    return { transcript, command, booking }
  }

  return { transcript, command }
}

/**
 * Identifiers out, whatever the prompt asked for.
 *
 * The same rule the rest of this app holds to, applied at the last point before
 * anything leaves: a spoken command is free prose, and free prose is exactly
 * where somebody says a patient's full name out loud. The booking path does its
 * own stripping and is not touched here.
 */
function scrub(command) {
  const clean = (v, max) => stripIdentifiers(String(v || '')).trim().slice(0, max)
  const out = { ...command, why: clean(command.why, 200) }

  if (out.reminder) {
    out.reminder = {
      ...out.reminder,
      thing: clean(out.reminder.thing, 120),
      from: clean(out.reminder.from, 40),
      to: clean(out.reminder.to, 40),
      note: clean(out.reminder.note, 200)
    }
  }
  if (out.listOrder) {
    out.listOrder = {
      ...out.listOrder,
      // Surname only, first token — the same rule every other path holds to.
      patient: clean(out.listOrder.patient, 40).split(/\s+/)[0] || '',
      surgeon: clean(out.listOrder.surgeon, 40),
      from: clean(out.listOrder.from, 20),
      ahead: clean(out.listOrder.ahead, 120)
    }
  }
  if (out.todo) {
    out.todo = { ...out.todo, task: clean(out.todo.task, 300) }
  }
  return out
}

export { stripWake }
