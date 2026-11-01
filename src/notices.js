// ─── Supplier notices waiting for a person to confirm ────────────────────────
// Every booking route hands back the notices a change calls for. Whichever
// screen made the change passes the response here, and the one sheet in App
// shows them — so the same confirmation appears however the booking was
// changed: the edit sheet, the new-booking form, the queue, a cancellation.

const listeners = new Set()
let current = { notices: [], sent: [], failed: [], error: '' }

export function offerNotices(response) {
  const notices = response?.notices || []
  const sent = response?.noticesSent || []
  const failed = response?.noticesFailed || []
  const error = response?.noticeError || ''
  if (!notices.length && !sent.length && !failed.length && !error) return
  current = {
    notices: [...current.notices, ...notices],
    sent: [...current.sent, ...sent],
    failed: [...current.failed, ...failed],
    error: error || current.error
  }
  for (const fn of listeners) fn(current)
}

export function clearNotices() {
  current = { notices: [], sent: [], failed: [], error: '' }
  for (const fn of listeners) fn(current)
}

export function subscribeNotices(fn) {
  listeners.add(fn)
  fn(current)
  return () => listeners.delete(fn)
}
