import { useEffect, useState, useCallback } from 'react'

// ─── Booking changes made with no signal ─────────────────────────────────────
// "Queue simple actions made offline and send them when the connection
// returns, showing their pending status."
//
// An edit saved in a dead spot — the theatre 6 corridor — is kept on the phone
// and sent to the calendar the moment there is signal, rather than lost with
// "That did not go through". Three rules keep that safe:
//
//   · Each change carries the booking's version marker from when it was made.
//     If somebody changed the booking in Google meanwhile, Google refuses it,
//     and the change is shown as needing to be redone — never forced over
//     theirs.
//   · Only booking edits are held. Nothing that emails a distributor is ever
//     queued: a usage email sent later, unseen, is exactly the thing that must
//     have a person confirming it.
//   · It is sent by the person who made it. The stored session token goes with
//     it, so "Amended by" names them, and a queue left by somebody who has since
//     signed out on this phone is not sent as the next person.

const KEY = 'tm_pending_changes'
const listeners = new Set()

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* full or blocked */ }
  for (const fn of listeners) fn(list)
}

/** Whether a failure means "no signal" rather than "the server said no". */
export function isNetworkFailure(err) {
  return err instanceof TypeError || /network|failed to fetch|load failed/i.test(String(err?.message || ''))
}

/** Holds one booking save to send later. A newer change to the same booking replaces it. */
export function queueBookingSave({ eventId, body, label, email }) {
  const list = read().filter(c => !(c.eventId === eventId && c.status === 'waiting'))
  list.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    eventId, body, label: String(label || 'A booking'), email,
    queuedAt: Date.now(), status: 'waiting'
  })
  write(list)
}

export function pendingChanges() {
  return read()
}

export function dismissChange(id) {
  write(read().filter(c => c.id !== id))
}

let flushing = false

/**
 * Sends whatever is waiting. Safe to call often: one run at a time, and a
 * change that still has no signal simply waits for the next.
 */
export async function flushQueue(user, fetcher = (...a) => fetch(...a)) {
  if (flushing || !user?.token) return
  flushing = true
  try {
    for (const change of read()) {
      if (change.status !== 'waiting') continue
      // Somebody else's change on a shared phone waits for them.
      if (change.email && change.email !== user.email) continue
      let res, data
      try {
        res = await fetcher('/api/calendar/today?action=save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
          body: JSON.stringify(change.body)
        })
        data = await res.json().catch(() => ({}))
      } catch (err) {
        if (isNetworkFailure(err)) return // still no signal; try again later
        throw err
      }
      const list = read()
      const at = list.findIndex(c => c.id === change.id)
      if (at < 0) continue
      if (res.ok) {
        list.splice(at, 1)
      } else if (res.status === 409) {
        list[at] = { ...list[at], status: 'conflict',
          error: 'Somebody changed this booking while you were offline, so your change was not applied. Open it and make the change again.' }
      } else {
        list[at] = { ...list[at], status: 'failed',
          error: data?.error || 'The calendar would not take this change.' }
      }
      write(list)
    }
  } finally {
    flushing = false
  }
}

/** The queue, kept current, and sent whenever the phone is online. */
export function useOfflineQueue(user) {
  const [changes, setChanges] = useState(read)

  useEffect(() => {
    listeners.add(setChanges)
    return () => { listeners.delete(setChanges) }
  }, [])

  const flush = useCallback(() => { flushQueue(user).catch(() => {}) }, [user])

  useEffect(() => {
    if (!user?.token) return undefined
    flush()
    window.addEventListener('online', flush)
    const timer = setInterval(() => { if (read().some(c => c.status === 'waiting')) flush() }, 30 * 1000)
    return () => { window.removeEventListener('online', flush); clearInterval(timer) }
  }, [user?.token, flush])

  return changes
}
