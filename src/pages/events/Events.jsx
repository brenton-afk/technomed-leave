import React, { useEffect, useMemo, useState } from 'react'
import { useBackLayer } from '../../backButton.js'
import { Banner, EmptyState, Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { EVENT_KINDS, defaultForm } from '../../events/model.js'
import { eventsApi } from './eventsApi.js'
import EventPage from './EventPage.jsx'
import Contacts from './Contacts.jsx'
import { Photo, photoForKind, seedOf, EventStyles, WASH } from './photos.jsx'

// ─── Me → Events (Brent, 25 Nov 2026; the look, 26 Nov 2026) ───────────────
// "Make it look much less like a form to fill out and more like an
// interactive app you would want to use", with the team's own photos from
// the ten-year party and the labs (api/_eventPhotos.js). A photo hero that
// moves through the best shots, a card per kind of event to start one, the
// events as picture cards with the date and how many are coming, and the
// albums underneath, tapped open full screen.

const KIND_BLURB = {
  dinner: 'An evening with surgeons and the team',
  inservice: 'Breakfast or lunch with a theatre team',
  workshop: 'Hands-on, in the lab',
  conference: 'Travel, stands and meetings'
}

const glass = { background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.28)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', color: 'white' }
const fade = 'linear-gradient(180deg, rgba(2,27,49,0.05) 0%, rgba(2,27,49,0.35) 45%, rgba(2,27,49,0.88) 100%)'

/** "Tue 9 Dec", "7:00 pm", and the day as a number for the badge, in Hobart. */
function dateParts(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const f = o => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Hobart', ...o }).format(d)
  return { day: f({ day: 'numeric' }), month: f({ month: 'short' }).toUpperCase(), weekday: f({ weekday: 'short' }), time: f({ hour: 'numeric', minute: '2-digit' }).replace(' ', ' '), year: f({ year: 'numeric' }) }
}

/** "Tonight", "Tomorrow", "In 5 days", "In 3 weeks". */
function countdown(iso) {
  if (!iso) return ''
  const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5)
  if (days < 0) return ''
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 14) return `In ${days} days`
  return `In ${Math.round(days / 7)} weeks`
}

function Hero({ token, gallery, onBack, upcoming, comingCount }) {
  const heroes = (gallery?.photos || []).filter(p => p.hero)
  const [i, setI] = useState(0)
  useEffect(() => {
    if (heroes.length < 2) return undefined
    const t = setInterval(() => setI(n => (n + 1) % heroes.length), 5500)
    return () => clearInterval(t)
  }, [heroes.length])
  const shown = heroes[i]
  return (
    <div data-events-hero style={{ position: 'relative', background: WASH, overflow: 'hidden', color: 'white' }}>
      {heroes.map((p, k) => (
        <div key={p.id} style={{ position: 'absolute', inset: 0, opacity: k === i ? 1 : 0, transition: 'opacity 1.2s ease' }}>
          <Photo token={token} id={p.id} size="large" zoom={k === i} style={{ position: 'absolute', inset: 0 }} />
        </div>
      ))}
      <div style={{ position: 'absolute', inset: 0, background: fade }} />
      <div style={{ position: 'relative', padding: `calc(env(safe-area-inset-top) + ${space.md}px) ${space.lg}px ${space.xxl + 14}px`, display: 'flex', flexDirection: 'column', minHeight: 'clamp(300px, 42vw, 420px)', boxSizing: 'border-box', maxWidth: 1100, margin: '0 auto' }}>
        <button type="button" onClick={onBack} aria-label="Back" style={{ ...glass, width: 40, height: 40, borderRadius: radius.pill, cursor: 'pointer', ...text('title'), display: 'grid', placeItems: 'center' }}>‹</button>
        <div style={{ marginTop: 'auto', animation: 'tmEvRise 500ms ease both' }}>
          <div style={{ ...text('micro'), textTransform: 'uppercase', opacity: 0.85 }}>TechnoMed events</div>
          <div style={{ fontSize: 34, lineHeight: 1.08, fontWeight: 800, letterSpacing: '-0.8px', margin: '6px 0 10px' }}>Bring people together</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ ...glass, ...text('caption'), fontWeight: 600, padding: '5px 12px', borderRadius: radius.pill }}>{upcoming} coming up</span>
            <span style={{ ...glass, ...text('caption'), fontWeight: 600, padding: '5px 12px', borderRadius: radius.pill }}>{comingCount} guests said yes</span>
          </div>
          {shown && <div style={{ ...text('caption'), opacity: 0.8, marginTop: space.md }}>{shown.caption}</div>}
          {heroes.length > 1 && (
            <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
              {heroes.map((p, k) => <button key={p.id} type="button" aria-label={`Photo ${k + 1}`} onClick={() => setI(k)} style={{ width: k === i ? 18 : 6, height: 6, padding: 0, border: 'none', borderRadius: radius.pill, background: k === i ? 'white' : 'rgba(255,255,255,0.45)', cursor: 'pointer', transition: 'width 300ms ease' }} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, margin: `${space.xl}px 0 ${space.md}px` }}>
      <div style={{ ...text('title'), color: colour.ink, flex: 1 }}>{children}</div>
      {right}
    </div>
  )
}

function KindCard({ token, gallery, kind, busy, onClick }) {
  return (
    <button type="button" data-new-event={kind.id} data-ev-card disabled={busy} onClick={onClick}
      style={{ position: 'relative', border: 'none', padding: 0, borderRadius: radius.card, overflow: 'hidden', cursor: 'pointer', textAlign: 'left', minWidth: 0, background: 'transparent' }}>
      <Photo token={token} id={photoForKind(gallery, kind.id, seedOf(kind.id))} style={{ height: 128 }}>
        <div style={{ position: 'absolute', inset: 0, background: fade }} />
        <div style={{ position: 'absolute', left: space.md, right: space.md, bottom: space.md, color: 'white' }}>
          <div style={{ ...text('heading') }}>{kind.label}</div>
          <div style={{ ...text('caption'), opacity: 0.85 }}>{KIND_BLURB[kind.id]}</div>
        </div>
        <span aria-hidden="true" style={{ ...glass, position: 'absolute', top: space.sm, right: space.sm, width: 30, height: 30, borderRadius: radius.pill, display: 'grid', placeItems: 'center', ...text('heading') }}>+</span>
      </Photo>
    </button>
  )
}

function EventCard({ token, gallery, e, onOpen, past }) {
  const d = dateParts(e.start)
  const share = e.invited ? Math.min(1, (e.yes || 0) / e.invited) : 0
  const kind = EVENT_KINDS.find(k => k.id === e.kind)
  return (
    <button type="button" data-ev-card data-event-card={e.id} onClick={onOpen}
      style={{ border: 'none', padding: 0, background: colour.surface, borderRadius: radius.card, overflow: 'hidden', cursor: 'pointer', textAlign: 'left', boxShadow: '0 2px 10px rgba(4,39,70,0.08)', minWidth: 0, opacity: past ? 0.92 : 1, display: 'flex', flexDirection: 'column' }}>
      <Photo token={token} id={photoForKind(gallery, e.kind, seedOf(e.id))} style={{ height: past ? 110 : 150 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(2,27,49,0) 40%, rgba(2,27,49,0.55) 100%)' }} />
        {d && (
          <div style={{ position: 'absolute', top: space.sm, left: space.sm, background: colour.surface, borderRadius: radius.control, padding: '4px 10px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
            <div style={{ ...text('micro'), color: colour.accentDeep }}>{d.month}</div>
            <div style={{ fontSize: 24, lineHeight: 1, fontWeight: 800, color: colour.ink }}>{d.day}</div>
          </div>
        )}
        {!past && countdown(e.start) && <span style={{ ...glass, ...text('micro'), position: 'absolute', top: space.sm, right: space.sm, padding: '4px 10px', borderRadius: radius.pill, textTransform: 'uppercase' }}>{countdown(e.start)}</span>}
        {kind && <span style={{ ...text('micro'), position: 'absolute', left: space.md, bottom: space.sm, color: 'white', textTransform: 'uppercase', opacity: 0.9 }}>{kind.label}</span>}
      </Photo>
      <div style={{ padding: space.md, display: 'grid', gap: 6, flex: 1 }}>
        <div style={{ ...text('heading'), color: colour.ink }}>{e.title}</div>
        <div style={{ ...text('caption'), color: colour.inkMuted }}>{[d ? `${d.weekday} ${d.day} ${d.month.charAt(0)}${d.month.slice(1).toLowerCase()} · ${d.time}` : 'No date yet', e.venue].filter(Boolean).join(' · ')}</div>
        <div style={{ marginTop: 'auto' }}>
          <div style={{ height: 6, borderRadius: radius.pill, background: colour.lineSoft, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(share * 100)}%`, height: '100%', background: colour.accent, borderRadius: radius.pill, transition: 'width 600ms ease' }} />
          </div>
          <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 4 }}>{e.yes || 0} coming · {e.invited || 0} invited</div>
        </div>
      </div>
    </button>
  )
}

function Lightbox({ token, photos, index, onClose, onMove }) {
  useBackLayer(true, onClose)
  const p = photos[index]
  useEffect(() => {
    const key = ev => { if (ev.key === 'ArrowRight') onMove(1); if (ev.key === 'ArrowLeft') onMove(-1); if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onMove, onClose])
  if (!p) return null
  return (
    <Overlay>
    <div data-ev-lightbox role="dialog" aria-label="Photo" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3500, background: 'rgba(2,10,18,0.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
      <div onClick={ev => ev.stopPropagation()} style={{ width: 'min(1100px, 100%)' }}>
        <Photo token={token} id={p.id} size="large" style={{ width: '100%', aspectRatio: '3 / 2', borderRadius: radius.card, background: 'transparent' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginTop: space.md, color: 'white' }}>
          <button type="button" aria-label="Previous photo" onClick={() => onMove(-1)} style={{ ...glass, width: 40, height: 40, borderRadius: radius.pill, cursor: 'pointer', ...text('title') }}>‹</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ ...text('bodyStrong') }}>{p.caption}</div>
            <div style={{ ...text('caption'), opacity: 0.7 }}>{p.albumTitle} · {index + 1} of {photos.length}</div>
          </div>
          <button type="button" aria-label="Next photo" onClick={() => onMove(1)} style={{ ...glass, width: 40, height: 40, borderRadius: radius.pill, cursor: 'pointer', ...text('title') }}>›</button>
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" style={{ ...glass, position: 'absolute', top: `calc(env(safe-area-inset-top) + ${space.md}px)`, right: space.md, width: 40, height: 40, borderRadius: radius.pill, cursor: 'pointer', ...text('heading') }}>✕</button>
    </div>
    </Overlay>
  )
}

function Memories({ token, gallery }) {
  const albums = gallery?.albums || []
  const [album, setAlbum] = useState('all')
  const [open, setOpen] = useState(-1)
  const titleOf = Object.fromEntries(albums.map(a => [a.id, `${a.title} · ${a.when}`]))
  const photos = (gallery?.photos || []).filter(p => album === 'all' || p.album === album).map(p => ({ ...p, albumTitle: titleOf[p.album] }))
  if (!photos.length && album === 'all') return null
  const chip = on => ({ ...text('caption'), fontWeight: 600, padding: '6px 12px', borderRadius: radius.pill, border: `1px solid ${on ? colour.navy : colour.line}`, background: on ? colour.navy : colour.surface, color: on ? 'white' : colour.inkMuted, cursor: 'pointer', whiteSpace: 'nowrap' })
  return (
    <div data-ev-memories>
      <SectionTitle>Memories</SectionTitle>
      <div data-ev-scroll style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: space.sm, scrollbarWidth: 'none' }}>
        <button type="button" style={chip(album === 'all')} onClick={() => setAlbum('all')}>All</button>
        {albums.map(a => <button key={a.id} type="button" data-ev-album={a.id} style={chip(album === a.id)} onClick={() => setAlbum(a.id)}>{a.title} · {a.when}</button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gridAutoRows: 120, gridAutoFlow: 'dense', gap: 6 }}>
        {photos.map((p, k) => (
          <button key={p.id} type="button" data-ev-card aria-label={p.caption} onClick={() => setOpen(k)}
            style={{ border: 'none', padding: 0, borderRadius: radius.control, overflow: 'hidden', cursor: 'zoom-in', gridColumn: k % 7 === 0 ? 'span 2' : undefined, gridRow: k % 7 === 0 ? 'span 2' : undefined, background: 'transparent' }}>
            <Photo token={token} id={p.id} style={{ width: '100%', height: '100%' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(2,27,49,0) 55%, rgba(2,27,49,0.7) 100%)' }} />
              <div style={{ ...text('caption'), fontWeight: 600, position: 'absolute', left: 8, right: 8, bottom: 6, color: 'white', textAlign: 'left' }}>{p.caption}</div>
            </Photo>
          </button>
        ))}
      </div>
      {open >= 0 && <Lightbox token={token} photos={photos} index={open} onClose={() => setOpen(-1)} onMove={step => setOpen(k => (k + step + photos.length) % photos.length)} />}
    </div>
  )
}

export default function Events({ user, onBack }) {
  const api = useMemo(() => eventsApi(user.token), [user.token])
  const [events, setEvents] = useState(null)
  const [gallery, setGallery] = useState(null)
  const [open, setOpen] = useState(null)
  const [contacts, setContacts] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useBackLayer(Boolean(open), () => setOpen(null))
  useBackLayer(contacts, () => setContacts(false))

  const load = () => api.list().then(d => { setEvents(d.events); if (d.gallery) setGallery(d.gallery) }).catch(err => setError(err.message))
  useEffect(() => { load() }, [api, open, contacts])

  async function create(kind) {
    setBusy(true); setError('')
    try {
      const { event } = await api.save({ title: `New ${EVENT_KINDS.find(k => k.id === kind).label.toLowerCase()}`, kind, form: defaultForm(kind) })
      setOpen(event.id)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (open) return <EventPage user={user} id={open} gallery={gallery} onBack={() => setOpen(null)} />
  if (contacts) return <Contacts user={user} onBack={() => setContacts(false)} />

  const now = Date.now()
  const upcoming = (events || []).filter(e => !e.start || new Date(e.start).getTime() >= now - 12 * 3600e3)
    .sort((a, b) => String(a.start || '9').localeCompare(String(b.start || '9')))
  const past = (events || []).filter(e => e.start && new Date(e.start).getTime() < now - 12 * 3600e3)
  const comingCount = upcoming.reduce((s, e) => s + (e.yes || 0), 0)

  return (
    <div data-events-page className="tm-page" style={{ background: colour.canvas, minHeight: '100%' }}>
      <EventStyles />
      <Hero token={user.token} gallery={gallery} onBack={onBack} upcoming={upcoming.length} comingCount={comingCount} />
      <div style={{ padding: `0 ${space.lg}px ${space.xxxl}px`, maxWidth: 1100, margin: '0 auto' }}>
        {error && <div style={{ marginTop: space.lg }}><Banner tone="danger">{error}</Banner></div>}

        <button type="button" data-ev-contacts onClick={() => setContacts(true)}
          style={{ marginTop: -26, position: 'relative', width: '100%', display: 'flex', alignItems: 'center', gap: space.md, padding: space.md, border: 'none', borderRadius: radius.card, background: colour.surface, boxShadow: '0 8px 24px rgba(4,39,70,0.14)', cursor: 'pointer', textAlign: 'left' }}>
          <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: radius.pill, background: WASH, color: 'white', display: 'grid', placeItems: 'center', ...text('heading') }}>☺</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ ...text('heading'), color: colour.ink, display: 'block' }}>Contacts</span>
            <span style={{ ...text('caption'), color: colour.inkMuted }}>Surgeons, registrars, theatre staff and reps to invite</span>
          </span>
          <span aria-hidden="true" style={{ ...text('title'), color: colour.inkFainter }}>›</span>
        </button>

        {user.isAdmin && (
          <>
            <SectionTitle>Start something</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, calc(50% - 6px)), 1fr))', gap: space.md }}>
              {EVENT_KINDS.map(k => <KindCard key={k.id} token={user.token} gallery={gallery} kind={k} busy={busy} onClick={() => create(k.id)} />)}
            </div>
          </>
        )}

        <SectionTitle right={upcoming.length ? <span style={{ ...text('caption'), color: colour.inkFaint }}>{upcoming.length} event{upcoming.length === 1 ? '' : 's'}</span> : null}>Coming up</SectionTitle>
        {events == null && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: space.md }}>
            {[0, 1].map(k => <div key={k} style={{ height: 250, borderRadius: radius.card, background: colour.lineSoft }} />)}
          </div>
        )}
        {events && !upcoming.length && <EmptyState title="Nothing planned yet" detail={user.isAdmin ? 'Start a dinner, in-service, lab or conference above.' : 'An admin adds you as an organiser of an event.'} />}
        {upcoming.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: space.md }}>
            {upcoming.map(e => <EventCard key={e.id} token={user.token} gallery={gallery} e={e} onOpen={() => setOpen(e.id)} />)}
          </div>
        )}

        {past.length > 0 && (
          <>
            <SectionTitle>Past events</SectionTitle>
            <div data-ev-scroll style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(220px, 240px)', gap: space.md, overflowX: 'auto', paddingBottom: space.sm, scrollbarWidth: 'none' }}>
              {past.map(e => <EventCard key={e.id} token={user.token} gallery={gallery} e={e} past onOpen={() => setOpen(e.id)} />)}
            </div>
          </>
        )}

        <Memories token={user.token} gallery={gallery} />
      </div>
    </div>
  )
}
