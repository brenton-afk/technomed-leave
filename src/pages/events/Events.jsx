import React, { useEffect, useMemo, useState } from 'react'
import { useBackLayer } from '../../backButton.js'
import { Page, Header, Body, Banner, NavGroup, NavCard, EmptyState } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { EVENT_KINDS, whenText, defaultForm } from '../../events/model.js'
import { eventsApi } from './eventsApi.js'
import EventPage from './EventPage.jsx'
import Contacts from './Contacts.jsx'

// ─── Me → Events (Brent, 25 Nov 2026) ───────────────────────────────────────
// The organisers' way in: upcoming and past events, a new event, Contacts.

const btn = (primary = false) => ({
  minHeight: 42, padding: '0 16px', borderRadius: radius.control, cursor: 'pointer', ...text('bodyStrong'),
  border: primary ? 'none' : `1px solid ${colour.line}`, background: primary ? colour.accent : colour.surface,
  color: primary ? 'white' : colour.ink
})

export default function Events({ user, onBack }) {
  const api = useMemo(() => eventsApi(user.token), [user.token])
  const [events, setEvents] = useState(null)
  const [open, setOpen] = useState(null)
  const [contacts, setContacts] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useBackLayer(Boolean(open), () => setOpen(null))
  useBackLayer(contacts, () => setContacts(false))

  const load = () => api.list().then(d => setEvents(d.events)).catch(err => setError(err.message))
  useEffect(() => { load() }, [api, open, contacts])

  async function create(kind) {
    setBusy(true); setError('')
    try {
      const { event } = await api.save({ title: `New ${EVENT_KINDS.find(k => k.id === kind).label.toLowerCase()}`, kind, form: defaultForm(kind) })
      setOpen(event.id)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  if (open) return <EventPage user={user} id={open} onBack={() => setOpen(null)} />
  if (contacts) return <Contacts user={user} onBack={() => setContacts(false)} />

  const now = Date.now()
  const upcoming = (events || []).filter(e => !e.start || new Date(e.start).getTime() >= now - 12 * 3600e3)
  const past = (events || []).filter(e => e.start && new Date(e.start).getTime() < now - 12 * 3600e3)
  const row = e => (
    <NavCard key={e.id} label={e.title} tint="teal"
      detail={[whenText(e.start) || 'No date yet', e.venue, `${e.yes} coming of ${e.invited} invited`].filter(Boolean).join(' · ')}
      onClick={() => setOpen(e.id)} />
  )
  return (
    <Page>
      <Header eyebrow="Me" title="Events" onBack={onBack} subtitle="Dinners, in-services, workshops and conferences" />
      <Body>
        {error && <Banner tone="danger">{error}</Banner>}
        {user.isAdmin && (
          <div style={{ marginBottom: space.lg }}>
            <div style={{ ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', marginBottom: space.sm }}>New event</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {EVENT_KINDS.map(k => <button key={k.id} type="button" data-new-event={k.id} disabled={busy} style={btn(false)} onClick={() => create(k.id)}>+ {k.label}</button>)}
            </div>
          </div>
        )}
        <NavGroup label="People" first>
          <NavCard label="Contacts" tint="navy" detail="Surgeons, registrars, theatre staff and reps to invite" onClick={() => setContacts(true)} />
        </NavGroup>
        {events && !events.length && <EmptyState title="No events yet" detail={user.isAdmin ? 'Start one above.' : 'An admin adds you as an organiser of an event.'} />}
        {upcoming.length > 0 && <NavGroup label="Coming up">{upcoming.slice().reverse().map(row)}</NavGroup>}
        {past.length > 0 && <NavGroup label="Past">{past.map(row)}</NavGroup>}
      </Body>
    </Page>
  )
}
