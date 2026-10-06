import webpush from 'web-push'
import { pushSubscriptions, removePushSubscription } from './_redis.js'

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

const CONFIGURED = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

if (CONFIGURED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:brenton@technomed.com.au',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

export const pushConfigured = () => CONFIGURED
export const publicKey = () => process.env.VAPID_PUBLIC_KEY || null

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
  if (!CONFIGURED) return { sent: 0, configured: false }

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
