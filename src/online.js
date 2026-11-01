import { useEffect, useState } from 'react'

// ─── Whether the phone thinks it has a connection ────────────────────────────
// navigator.onLine is a floor, not a guarantee: false means certainly offline,
// true means only that some network is attached — a hospital wifi that answers
// nothing still reads as online. So it is used only to choose words ("Offline"
// rather than "Not updating"), never to decide whether to try.

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export function useOnline() {
  const [online, setOnline] = useState(isOnline)
  useEffect(() => {
    const update = () => setOnline(isOnline())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}
