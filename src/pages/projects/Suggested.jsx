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
// Yours and theirs (Brent, 8 Nov 2026: "these are all jobs for Toni … if I do
// something about that job then that will encroach on someone else's task").
// The server says which owners are this person's (`mine`: their own name, and
// Team leader on a day they lead). Those get the buttons. Everyone else's are
// folded into "In other people's inboxes", grouped by whose they are, with
// only Open email and Not mine to show — seen, never acted on from here.
// "Not mine" on either list takes it off this person's list only, and teaches
// nothing (it is the right job, for someone else).
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

/** Splits the list into this person's and everyone else's, the others grouped by owner. */
export function splitByOwner(items, mine = []) {
  const ours = [], others = new Map()
  for (const item of items) {
    if (mine.includes(item.owner)) ours.push(item)
    else others.set(item.owner, [...(others.get(item.owner) || []), item])
  }
  return { ours, others: [...others.entries()].map(([owner, list]) => ({ owner, items: list })) }
}

const OWNER = { brent: 'Brent', toni: 'Toni', erin: 'Erin', leader: 'Team leader', clinical: 'Clinical team' }
const SOURCE = { email: 'Email', usage: 'Usage', resupply: 'Resupply', bookings: 'Bookings' }

export default function Suggested({ user, today, onAdded }) {
  const [allowed, setAllowed] = useState(false)
  const [items, setItems] = useState([])
  const [mine, setMine] = useState([])
  const [othersOpen, setOthersOpen] = useState(false)
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
      setMine(data.mine || [])
      if (data.stale) {
        setReading(true)
        try { const fresh = await call('refresh', {}); if (live && fresh) { setItems(fresh.items || []); setMine(fresh.mine || []) } } catch (e) { if (live) setError(e.message) }
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

  const { ours, others } = splitByOwner(items, mine)
  const othersCount = others.reduce((n, g) => n + g.items.length, 0)

  const row = (item, theirs) => (
    <div key={item.id} data-suggestion={item.id} data-theirs={theirs ? '' : undefined} style={{ padding: `${space.sm + 2}px ${space.md}px`, borderBottom: `1px solid ${colour.lineSoft}` }}>
      <div style={{ ...text('caption'), color: colour.inkFaint, display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 2 }}>
        <span style={{ color: theirs ? colour.inkFaint : item.urgency === 'today' ? colour.danger : colour.warning, fontWeight: 700 }}>
          {item.urgency === 'today' ? 'Today' : item.urgency === 'week' ? 'This week' : 'Whenever'}
        </span>
        <span>· {SOURCE[item.source] || item.source}{item.mailbox ? ` · ${item.mailbox.split('@')[0]}@` : ''}</span>
        {item.waitingDays > 0 && <span>· waiting {item.waitingDays} d</span>}
      </div>
      <div style={{ ...text(theirs ? 'body' : 'bodyStrong'), color: colour.ink }}>{item.ask || item.title}</div>
      <div style={{ ...text('caption'), color: colour.inkFaint }}>{item.ask ? `${item.title} · ` : ''}{item.detail}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm }}>
        {!theirs && <button type="button" onClick={() => add(item)} style={chip(true)}>Add to my To Do</button>}
        {item.link && <a href={item.link} target="_blank" rel="noreferrer" style={chip(false)}>Open email</a>}
        {!theirs && <button type="button" onClick={() => settle(item, 'later')} style={chip(false)}>Later</button>}
        {!theirs && <button type="button" onClick={() => notNeeded(item)} style={chip(false)}>Not needed</button>}
        <button type="button" onClick={() => settle(item, 'wrong-person')} style={chip(false)}>Not mine</button>
      </div>
    </div>
  )

  const box = { background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, overflow: 'hidden' }
  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.accentDeep, flex: 1 }
  const toggle = { display: 'flex', alignItems: 'center', gap: space.sm, width: '100%', background: 'none', border: 'none', padding: `0 ${space.xs}px`, marginBottom: space.xs, cursor: 'pointer', textAlign: 'left' }

  // Nothing waiting: nothing drawn (Brent, 12 Nov 2026 — the empty box at the
  // top of the page was one of the "massive boxes").
  if (!error && ours.length === 0 && othersCount === 0) return null

  return (
    <section data-suggested style={{ marginBottom: space.md }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} style={toggle}>
        <span style={label}>{ours.length} suggested from email and the portal{reading ? ' · checking inboxes…' : ''}</span>
        <span aria-hidden="true" style={{ ...text('caption'), color: colour.inkFaint }}>{open ? 'Hide' : 'Show'}</span>
      </button>
      {error && <div style={{ ...text('caption'), color: colour.danger, padding: `0 ${space.xs}px ${space.xs}px` }}>{error}</div>}
      {open && ours.length === 0 && !reading && (
        <div style={{ ...text('caption'), color: colour.inkFaint, padding: space.md, ...box }}>
          Nothing for you. New suggestions appear here when an email or the portal needs you to act.
        </div>
      )}
      {open && ours.length > 0 && <div style={box}>{ours.map(item => row(item, false))}</div>}

      {othersCount > 0 && (
        <div data-others style={{ marginTop: space.md }}>
          <button type="button" onClick={() => setOthersOpen(o => !o)} aria-expanded={othersOpen} style={toggle}>
            <span style={{ ...label, color: colour.inkFaint }}>
              In other people's inboxes · {others.map(g => `${OWNER[g.owner] || g.owner} ${g.items.length}`).join(' · ')}
            </span>
            <span aria-hidden="true" style={{ ...text('caption'), color: colour.inkFaint }}>{othersOpen ? 'Hide' : 'Show'}</span>
          </button>
          {othersOpen && (
            <>
              <div style={{ ...text('caption'), color: colour.inkFaint, padding: `0 ${space.xs}px ${space.xs}px` }}>
                Theirs to action — shown so you can see what is waiting. Nothing here goes on anyone's list from your login.
              </div>
              {others.map(g => (
                <div key={g.owner} style={{ marginBottom: space.sm }}>
                  <div style={{ ...text('caption'), fontWeight: 700, color: colour.navy, padding: `0 ${space.xs}px 4px` }}>{OWNER[g.owner] || g.owner}</div>
                  <div style={box}>{g.items.map(item => row(item, true))}</div>
                </div>
              ))}
            </>
          )}
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
