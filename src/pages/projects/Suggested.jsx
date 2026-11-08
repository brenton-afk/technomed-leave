import React, { useCallback, useEffect, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { STAFF } from '../../staffConfig.js'

// ─── Suggested to-dos (Brent, 8 Nov 2026) ────────────────────────────────────
// "Can the portal look at everyone's email and just drag to-do lists into the
// portal My To Do? … Just set it up on my login to start with. The bit I'm not
// sure of is emailing from the portal as opposed to just composing reply
// emails, as I don't know who is being cc'd."
//
// So this replaces the separate Decisions page. What the inbox review and the
// portal's own checks find (api/_decisions.js) is offered here, at the top of
// the Projects page, as suggestions: Add to To Do makes it an ordinary task for
// whoever it belongs to; Not needed teaches the next review; Later brings it
// back in three days. It never drafts or sends email — Open email opens the
// message itself in Gmail, where To and Cc are in plain sight.
//
// Only for DECISIONS_USERS (Brent, while it is a trial); everyone else gets a
// 404 from the server and this draws nothing. Phone and desktop alike.

const PERSON = {
  brent: 'brenton@technomed.com.au',
  toni: 'toni@technomed.com.au',
  erin: 'erin@technomed.com.au'
}

/** Whose list an accepted suggestion goes on: its owner where that is a person, else the person accepting it. */
export function assigneeFor(item, me) {
  const email = PERSON[item?.owner] || me
  return STAFF.find(s => s.email === email)?.name || 'Unassigned'
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/** When it is due: today for today's, within three days for this week's, undated otherwise. */
export function dueFor(item, today) {
  if (item?.urgency === 'today') return today
  if (item?.urgency === 'week') return addDays(today, 3)
  return ''
}

/** The task as it lands on the list: what to do, with where it came from in its notes. */
export function taskFrom(item, { me, today }) {
  const what = String(item.ask || item.title || '').trim()
  const notes = [
    item.title && item.title !== what ? item.title : '',
    item.detail || '',
    item.link ? `Email: ${item.link}` : ''
  ].filter(Boolean).join('\n')
  return { task: what.slice(0, 300), assignee: assigneeFor(item, me), due_date: dueFor(item, today), notes: notes.slice(0, 500), priority: item.urgency === 'today' ? 'urgent' : 'normal' }
}

const OWNER = { brent: 'Brent', toni: 'Toni', erin: 'Erin', leader: 'Team leader', clinical: 'Clinical team' }
const SOURCE = { email: 'Email', usage: 'Usage', resupply: 'Resupply', bookings: 'Bookings' }

export default function Suggested({ user, today, onAdded }) {
  const [allowed, setAllowed] = useState(false)
  const [items, setItems] = useState([])
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(true)
  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}

  const call = useCallback(async (action, body) => {
    const res = await fetch(`/api/decisions?action=${action}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    })
    if (res.status === 404) return null
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Suggestions could not be loaded')
    return data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])

  useEffect(() => {
    let live = true
    call('list').then(async data => {
      if (!live || !data) return
      setAllowed(true)
      setItems(data.items || [])
      if (data.stale) {
        setReading(true)
        try { const fresh = await call('refresh', {}); if (live && fresh) setItems(fresh.items || []) } catch (e) { if (live) setError(e.message) }
        if (live) setReading(false)
      }
    }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [call])

  if (!allowed) return null

  const settle = async (item, state, reason = '') => {
    setItems(list => list.filter(i => i.id !== item.id))
    try {
      await call('mark', { id: item.id, ids: item.ids, state, reason, item: { source: item.source, owner: item.owner, from: item.from, subject: item.subject } })
    } catch (e) { setError(e.message) }
  }

  const add = async item => {
    setItems(list => list.filter(i => i.id !== item.id))
    try {
      const res = await fetch('/api/meetings/agent?action=add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ ...taskFrom(item, { me: user?.email, today }), addedByEmail: user?.email || null })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.error) throw new Error(body.error || 'That did not add')
      await call('mark', { id: item.id, ids: item.ids, state: 'done', reason: 'added to To Do', item: { source: item.source, owner: item.owner } })
      onAdded?.()
    } catch (e) {
      setError(e.message)
      setItems(list => [item, ...list])
    }
  }

  const notNeeded = item => {
    // The page cannot show prompt(), so the reason is optional and skipped here;
    // the dismissal alone still teaches the next review about that sender.
    settle(item, 'not-needed')
  }

  return (
    <section data-suggested style={{ marginBottom: space.lg }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: space.sm, width: '100%', background: 'none', border: 'none', padding: `0 ${space.xs}px`, marginBottom: space.xs, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ ...text('micro'), textTransform: 'uppercase', color: colour.accentDeep, flex: 1 }}>
          Suggested from email and the portal · {items.length}{reading ? ' · checking inboxes…' : ''}
        </span>
        <span aria-hidden="true" style={{ ...text('caption'), color: colour.inkFaint }}>{open ? 'Hide' : 'Show'}</span>
      </button>
      {error && <div style={{ ...text('caption'), color: colour.danger, padding: `0 ${space.xs}px ${space.xs}px` }}>{error}</div>}
      {open && items.length === 0 && !reading && (
        <div style={{ ...text('caption'), color: colour.inkFaint, padding: space.md, background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card }}>
          Nothing waiting. New suggestions appear here when an email or the portal needs someone to act.
        </div>
      )}
      {open && items.length > 0 && (
        <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, overflow: 'hidden' }}>
          {items.map(item => (
            <div key={item.id} data-suggestion={item.id} style={{ padding: `${space.sm + 2}px ${space.md}px`, borderBottom: `1px solid ${colour.lineSoft}` }}>
              <div style={{ ...text('caption'), color: colour.inkFaint, display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 2 }}>
                <span style={{ color: item.urgency === 'today' ? colour.danger : colour.warning, fontWeight: 700 }}>
                  {item.urgency === 'today' ? 'Today' : item.urgency === 'week' ? 'This week' : 'Whenever'}
                </span>
                <span>· for {OWNER[item.owner] || item.owner}</span>
                <span>· {SOURCE[item.source] || item.source}{item.mailbox ? ` · ${item.mailbox.split('@')[0]}@` : ''}</span>
                {item.waitingDays > 0 && <span>· waiting {item.waitingDays} d</span>}
              </div>
              <div style={{ ...text('bodyStrong'), color: colour.ink }}>{item.ask || item.title}</div>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>{item.ask ? `${item.title} · ` : ''}{item.detail}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm }}>
                <button type="button" onClick={() => add(item)} style={chip(true)}>Add to To Do</button>
                {item.link && <a href={item.link} target="_blank" rel="noreferrer" style={chip(false)}>Open email</a>}
                <button type="button" onClick={() => settle(item, 'later')} style={chip(false)}>Later</button>
                <button type="button" onClick={() => notNeeded(item)} style={chip(false)}>Not needed</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const chip = primary => ({
  ...text('caption'), fontWeight: 700, padding: '6px 12px', borderRadius: radius.pill, cursor: 'pointer', textDecoration: 'none',
  border: `1px solid ${primary ? colour.accent : colour.line}`,
  background: primary ? colour.accent : colour.surface, color: primary ? 'white' : colour.navy
})
