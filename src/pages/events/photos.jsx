// The team's own photos on the Events pages (Brent, 26 Nov 2026): fetched
// with the session (api/guides.js?events=photo), kept as object URLs for the
// life of the page, and drawn over a navy-to-teal wash so a slow or missing
// photo still looks deliberate.

import React, { useEffect, useState } from 'react'
import { colour } from '../../design/tokens.js'

const cache = new Map()

/** An object URL for a gallery photo, or '' while it loads (or if it cannot). */
export function usePhoto(token, id, size = '') {
  const key = `${id}|${size}`
  const [url, setUrl] = useState(() => (cache.get(key)?.url || ''))
  useEffect(() => {
    if (!id || !token) return undefined
    let live = true
    let entry = cache.get(key)
    if (!entry) {
      entry = {
        url: '',
        promise: fetch(`/api/guides?events=photo&id=${encodeURIComponent(id)}${size ? `&size=${size}` : ''}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => (r.ok && typeof r.blob === 'function' ? r.blob() : null))
          .then(b => (b && /^image\//.test(b.type || 'image/jpeg') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(b) : ''))
          .catch(() => '')
      }
      cache.set(key, entry)
      entry.promise.then(u => { entry.url = u; if (!u) cache.delete(key) })
    }
    entry.promise.then(u => { if (live) setUrl(u) })
    return () => { live = false }
  }, [key, id, size, token])
  return url
}

export const WASH = `linear-gradient(135deg, ${colour.navySoft} 0%, ${colour.navy} 55%, ${colour.accentDeep} 100%)`

/** A photo filling its box, fading in over the wash. */
export function Photo({ token, id, size, style, alt = '', children, zoom = false }) {
  const url = usePhoto(token, id, size)
  return (
    <div data-event-photo={id || ''} style={{ position: 'relative', overflow: 'hidden', background: WASH, ...style }}>
      {url && (
        <img src={url} alt={alt} draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', animation: 'tmEvFade 600ms ease both', transform: zoom ? 'scale(1.06)' : undefined, transition: 'transform 6s ease-out' }} />
      )}
      {children}
    </div>
  )
}

/** Which photo suits each kind of event, so a card is never a blank box. */
export function photoForKind(gallery, kind, n = 0) {
  const photos = gallery?.photos || []
  const albums = Object.fromEntries((gallery?.albums || []).map(a => [a.id, a]))
  const match = photos.filter(p => albums[p.album]?.kind === kind || (kind === 'conference' && p.album === 'ten-years') || (kind === 'inservice' && p.album === 'alif-lab'))
  const list = match.length ? match : photos
  return list.length ? list[Math.abs(n) % list.length].id : ''
}

/** A stable small number from an id, to vary which photo a card gets. */
export function seedOf(s) {
  let h = 0
  for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

/** Keyframes the Events pages use, once. */
export function EventStyles() {
  return (
    <style>{`
@keyframes tmEvFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes tmEvRise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
[data-ev-card] { transition: transform 180ms ease, box-shadow 180ms ease; }
[data-ev-card]:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(4,39,70,0.18); }
[data-ev-card]:active { transform: scale(0.985); }
[data-ev-scroll]::-webkit-scrollbar { display: none; }
@media (prefers-reduced-motion: reduce) { [data-event-photo] img { animation: none !important; transition: none !important; } [data-ev-card] { transition: none } }
`}</style>
  )
}
