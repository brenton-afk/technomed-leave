import { useState, useEffect, useCallback } from 'react'

// ─── How many messages are waiting ───────────────────────────────────────────
// The number on the Messages tab. Without it the only way to know something has
// been said is to open the tab and look, which is the habit this whole feature
// exists to replace — and notifications only help the people who have them on,
// on the device they were turned on for.
//
// Polled, not pushed, and slowly. This is a badge: a minute late is invisible,
// and the channel itself already polls every eight seconds while it is open.
// Nothing here runs while the tab is hidden — a phone in a pocket overnight
// should not be asking anything.

const EVERY = 60 * 1000

/**
 * Total unread across every standing channel.
 *
 * Case threads are deliberately not counted. A booking's thread is read where
 * the booking is, and a number on the bar that cannot be cleared from the
 * Messages screen would be a badge nobody can get rid of.
 */
export function useUnread(token) {
  const [count, setCount] = useState(0)

  const read = useCallback(async () => {
    if (!token || document.visibilityState !== 'visible') return
    try {
      const res = await fetch('/api/chat?action=overview', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return
      const data = await res.json()
      setCount((data.channels || []).reduce((n, c) => n + (c.unread || 0), 0))
    } catch {
      // A badge that cannot be fetched is a badge that does not appear. There
      // is nothing useful to say about it, and the app works either way.
    }
  }, [token])

  useEffect(() => {
    read()
    const timer = setInterval(read, EVERY)
    // Checked again the moment somebody comes back to the app, which is when
    // the number is actually being looked at.
    document.addEventListener('visibilitychange', read)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', read) }
  }, [read])

  return { count, refresh: read }
}
