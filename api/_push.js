import webpush from 'web-push'
import { pushSubscriptions, removePushSubscription } from './_redis.js'

/** Set when web-push rejects the keys themselves. */
let setupError = null

// ─── Sending a notification ──────────────────────────────────────────────────
// The thing that makes the internal channels worth having. A message that waits
// in an app until somebody thinks to look is not a message, which is why nine
// people kept using WhatsApp for the running order.
//
// ── What is in the notification, and what is not ──
//
// The body carries the message. That is the point — a notification you have to
// open the app to read is only half a notification, and the running order at
// four o'clock is exactly the thing somebody needs off a lock screen.
//
// But a lock screen is a public place. It is read over a shoulder in a theatre
// corridor by people who do not work here. The channels already refuse to carry
// patient identifiers — see src/chat/identifiers.js, which warns before a
// message is sent — so what is on the lock screen is what the team agreed was
// safe to write down. This adds one more limit on top: the preview is short, so
// a long message shows its beginning and is finished in the app.

// ─── Whether push is switched on, and saying so out loud ─────────────────────
// Without both keys this module does nothing. Not broken — off: every send
// returns {sent: 0, configured: false}, no error is raised, and nothing in the
// app looks different. That is how a finished feature can sit dark for weeks
// and nobody notice, which is exactly what happened here.
//
// So the state is named, logged once on startup, and reported to the admin
// portal. It still does not throw: a deploy without keys has to keep working,
// because push is a convenience and the case list is not.

/** Why push is off, or null when it is on. */
function configurationFault() {
  if (!process.env.VAPID_PUBLIC_KEY && !process.env.VAPID_PRIVATE_KEY) {
    return 'no VAPID keys are set'
  }
  if (!process.env.VAPID_PUBLIC_KEY) return 'VAPID_PUBLIC_KEY is missing'
  if (!process.env.VAPID_PRIVATE_KEY) return 'VAPID_PRIVATE_KEY is missing'

  const subject = process.env.VAPID_SUBJECT || DEFAULT_SUBJECT
  // Checked here rather than left to web-push, which throws. setVapidDetails
  // runs at module load, so a bare email address in VAPID_SUBJECT would not
  // disable push — it would take the whole endpoint down with a 500 on every
  // request, including the ones that have nothing to do with notifications.
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    return 'VAPID_SUBJECT must be a mailto: or https: URL'
  }
  return null
}

const DEFAULT_SUBJECT = 'mailto:brenton@technomed.com.au'
const FAULT = configurationFault()
const CONFIGURED = FAULT === null

if (CONFIGURED) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || DEFAULT_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    )
  } catch (err) {
    // Malformed keys, which only web-push can judge. Push goes off rather
    // than the module failing to import — see above.
    setupError = err?.message || 'setVapidDetails refused the keys'
  }
}

if (!CONFIGURED || setupError) {
  // Once, at cold start, where a deploy log will show it. No key material is
  // logged — only which name is missing or malformed.
  console.warn(
    `[push] notifications are OFF — ${setupError || FAULT}. `
    + 'Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (see .env.example). '
    + 'Nothing else is affected; every send will no-op.')
}

export const pushConfigured = () => CONFIGURED && !setupError

/** What is wrong, for the admin portal. Null when push is working. */
export const pushFault = () => setupError || FAULT

export const publicKey = () => (pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null)

/** As much of a message as belongs on a lock screen. */
export function preview(text, limit = 140) {
  const one = String(text || '').replace(/\s+/g, ' ').trim()
  return one.length <= limit ? one : `${one.slice(0, limit - 1).trimEnd()}…`
}

/**
 * Sends one notification to every device these people have registered.
 *
 * Never throws. A notification that fails is a notification somebody does not
 * get; a notification that fails and takes the message with it is a message
 * nobody gets, and the message is the part that matters. So every send is
 * caught, and the caller is told what happened rather than stopped.
 *
 * A subscription the push service reports as gone (404/410) is deleted. Those
 * never come back, and keeping one means retrying it for as long as the app
 * exists.
 *
 * So is one it rejects with 403. That is what a push service returns when the
 * VAPID key the subscription was made with is not the key the message is
 * signed with — which happens exactly once, the day somebody rotates the keys,
 * and then applies to every subscription at once.
 *
 * Leaving those in place was the trap: they would fail forever, nothing would
 * clean them up, and the app would go on believing every phone was subscribed
 * while no notification reached any of them. Silence that looks like nothing
 * is wrong is the worst failure this code can have — notifications are how
 * somebody finds out a booking changed.
 */
export async function notify(emails, payload) {
  if (!pushConfigured()) return { sent: 0, configured: false }

  const body = JSON.stringify(payload)
  let sent = 0

  await Promise.all((emails || []).map(async email => {
    const subscriptions = await pushSubscriptions(email).catch(() => [])
    await Promise.all(subscriptions.map(async subscription => {
      try {
        await webpush.sendNotification(subscription, body)
        sent += 1
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410
          || err?.statusCode === 403) {
          await removePushSubscription(email, subscription.endpoint).catch(() => {})
        }
        // Anything else — a push service having a bad morning, a network blip —
        // is left alone. It will be tried again on the next message.
      }
    }))
  }))

  return { sent, configured: true }
}
