import { requireSession } from './_auth.js'
import { savePushSubscription, removePushSubscription } from './_redis.js'
import { publicKey, pushConfigured, notify } from './_push.js'

// ─── Registering a device for notifications ──────────────────────────────────
// Three things, all of them small: hand out the public key a browser needs to
// subscribe, remember a subscription against the person who made it, and forget
// one when they turn it off.
//
// Behind the session like everything else. A subscription is a way to make
// somebody's phone buzz, and an endpoint anybody could post to is a way to make
// it buzz on their behalf.

export default async function handler(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.query.action === 'key') {
      return res.status(200).json({ key: publicKey(), configured: pushConfigured() })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})

    if (req.query.action === 'subscribe') {
      const subscription = body.subscription
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return res.status(400).json({ error: 'That is not a subscription' })
      }
      // Stored against the signed-in person, not against whatever the request
      // claims. A device registers itself; it does not get to say whose it is.
      await savePushSubscription(session.email, {
        endpoint: String(subscription.endpoint).slice(0, 1000),
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }
      })
      return res.status(200).json({ ok: true })
    }

    if (req.query.action === 'unsubscribe') {
      await removePushSubscription(session.email, String(body.endpoint || ''))
      return res.status(200).json({ ok: true })
    }

    if (req.query.action === 'test') {
      // So somebody can find out whether it works without waiting for a message
      // from a colleague — which is otherwise the only way to tell, and a poor
      // way to discover a phone was never registered.
      const { sent } = await notify([session.email], {
        title: 'TechnoMed',
        body: 'Notifications are working on this device.',
        tag: 'test',
        url: '/'
      })
      return res.status(200).json({ ok: true, sent })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
