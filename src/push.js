import { useState, useEffect, useCallback } from 'react'

// ─── Turning on notifications ────────────────────────────────────────────────
// The chat was built and nobody used it, which was predictable: WhatsApp works
// because it buzzes a pocket. A message that waits in an app until somebody
// thinks to look is not a message, and a channel half the team reads is worse
// than no channel, because now the information is in two places.
//
// ── What iOS insists on, all of it non-negotiable ──
//
//   · the site must be installed to the Home Screen. In a Safari tab there is
//     no push at all, and no error either — `Notification` simply is not there.
//   · permission must be asked for inside a real tap. Asking on load is
//     silently denied, and a denial cannot be asked again; it has to be undone
//     in Settings, which nobody will do.
//   · iOS 16.4 or later.
//
// So this never asks on its own. It offers a switch, and the switch is what
// does the asking.

/** Whether this device could ever show one. */
export function pushPossible() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && typeof Notification !== 'undefined'
}

/**
 * Whether the app is running as an installed app rather than a browser tab.
 *
 * Worth knowing separately from `pushPossible`, because on an iPhone in Safari
 * the honest thing to say is "add this to your Home Screen first" rather than
 * "your device does not support notifications" — which sounds final and is not
 * true.
 */
export function installed() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator.standalone === true
}

/** The browser's own base64url, which is not the base64 atob expects. */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
    .replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null
  return navigator.serviceWorker.register('/sw.js')
}

const auth = token => (token ? { Authorization: `Bearer ${token}` } : {})

/**
 * Asks for permission and registers this device.
 *
 * Must be called from a tap. Returns what happened rather than throwing on a
 * refusal: somebody declining is an ordinary answer, not an error.
 *
 * @returns {Promise<'on'|'denied'|'unsupported'|'not-installed'>}
 */
/**
 * Whether a subscription was made with this VAPID key.
 *
 * The browser keeps the key it subscribed with on the subscription's options,
 * as raw bytes. Compared rather than trusted: a subscription is only valid
 * against the key that created it, and the app cannot tell from anywhere else
 * that the server has moved on.
 *
 * Unknown counts as "yes, reuse it". Some browsers do not expose the options
 * at all, and unsubscribing everybody on those because the question cannot be
 * answered would be a worse bug than the one this prevents.
 */
function madeWith(subscription, key) {
  const used = subscription?.options?.applicationServerKey
  if (!used) return true
  const want = urlBase64ToUint8Array(key)
  const have = new Uint8Array(used)
  if (have.length !== want.length) return false
  for (let i = 0; i < want.length; i++) if (have[i] !== want[i]) return false
  return true
}

export async function turnOnPush(token) {
  if (!pushPossible()) return installed() ? 'unsupported' : 'not-installed'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const registration = await registerWorker()
  await navigator.serviceWorker.ready

  const res = await fetch('/api/push?action=key', { headers: auth(token) })
  const { key } = await res.json()
  if (!key) throw new Error('Notifications are not configured on the server')

  // An existing subscription is reused — but only if it was made with the key
  // the server is signing with now. Subscribing twice with a different key
  // throws, so the old one has to go first.
  //
  // Without this check, rotating the VAPID keys broke notifications
  // permanently and invisibly: every send failed, and turning notifications
  // off and on again handed back the same stale subscription, so there was no
  // way out from inside the app.
  const existing = await registration.pushManager.getSubscription()
  if (existing && !madeWith(existing, key)) {
    await existing.unsubscribe().catch(() => {})
  }
  const reusable = existing && madeWith(existing, key) ? existing : null
  const subscription = reusable || await registration.pushManager.subscribe({
    // Required by every browser that implements push: a silent push is not
    // allowed, and asking for one is refused outright.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key)
  })

  const saved = await fetch('/api/push?action=subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ subscription: subscription.toJSON() })
  })
  if (!saved.ok) throw new Error('Could not register this device')
  return 'on'
}

/** Stops them on this device, and forgets it server-side so it is not written to. */
export async function turnOffPush(token) {
  const registration = await navigator.serviceWorker?.getRegistration()
  const subscription = await registration?.pushManager?.getSubscription()
  if (subscription) {
    await fetch('/api/push?action=unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(token) },
      body: JSON.stringify({ endpoint: subscription.endpoint })
    }).catch(() => {})
    await subscription.unsubscribe().catch(() => {})
  }
}

/** Whether this device is currently signed up. */
export async function pushIsOn() {
  if (!pushPossible() || Notification.permission !== 'granted') return false
  const registration = await navigator.serviceWorker?.getRegistration()
  return Boolean(await registration?.pushManager?.getSubscription())
}

/**
 * The state of notifications on this device, for a switch to render.
 *
 * `blocked` is kept separate from `off` on purpose. They look the same and are
 * not: off is one tap away, and blocked can only be undone in the phone's own
 * settings, so telling somebody to tap the switch again would waste their time.
 */
export function usePush(token) {
  const [state, setState] = useState('unknown')
  const [busy, setBusy] = useState(false)

  const read = useCallback(async () => {
    if (!pushPossible()) return setState(installed() ? 'unsupported' : 'not-installed')
    if (Notification.permission === 'denied') return setState('blocked')
    setState(await pushIsOn() ? 'on' : 'off')
  }, [])

  useEffect(() => { read() }, [read])

  const toggle = useCallback(async () => {
    setBusy(true)
    try {
      if (await pushIsOn()) {
        await turnOffPush(token)
        setState('off')
      } else {
        setState(await turnOnPush(token) === 'on' ? 'on' : 'blocked')
      }
    } catch {
      await read()
    }
    setBusy(false)
  }, [token, read])

  return { state, busy, toggle }
}
