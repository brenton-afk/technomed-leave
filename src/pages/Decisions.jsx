import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Page, Header, Body, Card, Banner, Button, EmptyState, Skeleton } from '../design/Shell.jsx'
import { colour, text, space, radius, border } from '../design/tokens.js'
import { IconCheck } from '../design/icons.jsx'

// ─── Decisions — trial (Brent, 7 Nov 2026) ───────────────────────────────────
// One list of what is waiting on somebody: unanswered emails in the shared
// inboxes, usage not sent, resupply owed, bookings sitting in the Inbox. Each
// item names whose it is. Nothing here sends anything — a suggested reply is
// copied, then sent from Gmail by a person.
//
// Only people on DECISIONS_USERS see it (Brent, for the trial); the server
// answers 404 to everyone else.

const URGENCY = {
  today: { label: 'Today', ink: colour.danger, soft: colour.dangerSoft },
  week: { label: 'This week', ink: colour.warning, soft: colour.warningSoft },
  later: { label: 'Whenever', ink: colour.inkFaint, soft: colour.lineSoft }
}

const SOURCE = { email: 'Email', usage: 'Usage', resupply: 'Resupply', bookings: 'Bookings' }

export function ago(iso, now = Date.now()) {
  if (!iso) return 'not yet'
  const mins = Math.round((now - Date.parse(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

function call(user, action, body) {
  return fetch(`/api/decisions?action=${action}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${user.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => {
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || 'Decisions could not be loaded')
    return data
  })
}

function Chip({ on, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      ...text('caption'), fontWeight: 600, padding: '6px 12px', borderRadius: radius.pill,
      border: on ? `1px solid ${colour.accent}` : border.hairline,
      background: on ? colour.accent : colour.surface, color: on ? 'white' : colour.navy,
      cursor: 'pointer', whiteSpace: 'nowrap', font: 'inherit'
    }}>{children}</button>
  )
}

function Item({ item, owners, open, onToggle, onMark }) {
  const u = URGENCY[item.urgency] || URGENCY.week
  const [asking, setAsking] = useState(null)
  const [reason, setReason] = useState('')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try { await navigator.clipboard.writeText(item.draft); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* no clipboard */ }
  }

  return (
    <Card style={{ borderLeft: `4px solid ${u.ink}` }}>
      <div data-decision={item.id} onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') onToggle() }} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginBottom: space.xs }}>
          <span style={{ ...text('micro'), color: u.ink, background: u.soft, padding: '2px 8px', borderRadius: radius.pill }}>
            {u.label.toUpperCase()}
          </span>
          <span style={{ ...text('micro'), color: colour.accentDeep, background: colour.accentSoft, padding: '2px 8px', borderRadius: radius.pill }}>
            {(owners[item.owner] || item.owner).toUpperCase()}
          </span>
          <span style={{ ...text('micro'), color: colour.inkFaint, padding: '2px 0' }}>
            {SOURCE[item.source] || item.source}{item.mailbox ? ` · ${item.mailbox.split('@')[0]}@` : ''}
            {item.waitingDays > 0 ? ` · waiting ${item.waitingDays} d` : ''}
          </span>
        </div>
        <div style={{ ...text('bodyStrong'), color: colour.ink }}>{item.title}</div>
        {item.ask && <div style={{ ...text('body'), color: colour.inkMuted }}>{item.ask}</div>}
        <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>{item.detail}</div>
      </div>

      {open && (
        <div style={{ marginTop: space.md }}>
          {item.draft && (
            <div style={{
              ...text('body'), whiteSpace: 'pre-wrap', background: colour.canvas, border: border.hairline,
              borderRadius: radius.control, padding: space.md, marginBottom: space.sm, color: colour.ink
            }}>
              <div style={{ ...text('micro'), color: colour.inkFaint, marginBottom: space.xs }}>SUGGESTED REPLY — NOTHING IS SENT</div>
              {item.draft}
            </div>
          )}
          <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', marginBottom: space.sm }}>
            {item.link && (
              <a href={item.link} target="_blank" rel="noreferrer" style={{
                ...text('bodyStrong'), flex: '1 1 140px', textAlign: 'center', textDecoration: 'none',
                padding: `${space.md}px`, borderRadius: radius.control, border: border.hairline, color: colour.navy, background: colour.surface
              }}>Open in Gmail</a>
            )}
            {item.draft && (
              <Button variant="secondary" onClick={copy} style={{ flex: '1 1 140px', width: 'auto' }}>
                {copied ? 'Copied' : 'Copy reply'}
              </Button>
            )}
          </div>

          {asking ? (
            <div>
              <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                placeholder={asking === 'wrong-person' ? 'Whose is it? (optional)' : 'Why not? It helps it learn (optional)'}
                style={{ ...text('field'), width: '100%', boxSizing: 'border-box', padding: space.md, border: border.hairline, borderRadius: radius.control, marginBottom: space.sm }} />
              <div style={{ display: 'flex', gap: space.sm }}>
                <Button onClick={() => onMark(item, asking, reason)} style={{ flex: 1 }}>Save</Button>
                <Button variant="quiet" onClick={() => setAsking(null)} style={{ flex: 1 }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.sm }}>
              <Button onClick={() => onMark(item, 'done')}>Done</Button>
              <Button variant="secondary" onClick={() => onMark(item, 'later')}>Later (3 days)</Button>
              <Button variant="quiet" onClick={() => setAsking('not-needed')}>Not needed</Button>
              <Button variant="quiet" onClick={() => setAsking('wrong-person')}>Wrong person</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function Decisions({ user, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [owner, setOwner] = useState('all')
  const [openId, setOpenId] = useState(null)

  const refresh = useCallback(async () => {
    setReading(true)
    setError('')
    try { setData(await call(user, 'refresh', {})) } catch (e) { setError(e.message) } finally { setReading(false) }
  }, [user])

  useEffect(() => {
    let live = true
    call(user, 'list').then(d => {
      if (!live) return
      setData(d)
      if (d.stale) refresh()
    }).catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [user, refresh])

  const mark = async (item, state, reason = '') => {
    setData(d => ({ ...d, items: d.items.filter(i => i.id !== item.id), cleared: (d.cleared || 0) + 1 }))
    setOpenId(null)
    try {
      await call(user, 'mark', {
        id: item.id, state, reason,
        item: { source: item.source, owner: item.owner, from: item.from, subject: item.subject }
      })
    } catch (e) { setError(e.message) }
  }

  const items = data?.items || []
  const counts = useMemo(() => items.reduce((m, i) => ({ ...m, [i.owner]: (m[i.owner] || 0) + 1 }), {}), [items])
  const shown = owner === 'all' ? items : items.filter(i => i.owner === owner)
  const owners = data?.owners || {}
  const lastRead = (data?.mailboxes || []).map(m => m.at).filter(Boolean).sort()[0]

  return (
    <Page>
      <Header eyebrow="Trial · only you can see this" title="Decisions"
        subtitle="What is waiting on someone — nothing here sends anything" onBack={onBack} />
      <Body>
        {error && <Banner tone="danger">{error}</Banner>}
        {(data?.mailboxes || []).filter(m => m.error).map(m => (
          <Banner key={m.address} tone="warning">{m.address} could not be read: {m.error}</Banner>
        ))}
        {(data?.sources || []).filter(s => s.error).map(s => (
          <Banner key={s.key} tone="warning">{s.label} could not be checked: {s.error}</Banner>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginBottom: space.md }}>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            {reading ? 'Reading the inboxes… (up to a minute)' : `Inboxes read ${ago(lastRead)}`}
            {data?.mailboxes?.length ? ` · ${data.mailboxes.map(m => m.address.split('@')[0]).join(', ')}` : ''}
          </div>
          <Button variant="secondary" onClick={refresh} disabled={reading} style={{ width: 'auto', padding: '8px 14px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {reading ? 'Reading…' : 'Check now'}
          </Button>
        </div>

        <div style={{ display: 'flex', gap: space.xs, overflowX: 'auto', paddingBottom: space.sm, marginBottom: space.sm }}>
          <Chip on={owner === 'all'} onClick={() => setOwner('all')}>All {items.length}</Chip>
          {Object.entries(owners).map(([key, label]) => (
            <Chip key={key} on={owner === key} onClick={() => setOwner(key)}>{label} {counts[key] || 0}</Chip>
          ))}
        </div>

        {!data && !error && <><Skeleton height={80} /><Skeleton height={80} /><Skeleton height={80} /></>}
        {data && !shown.length && (
          <EmptyState icon={IconCheck} title="Nothing waiting"
            detail={reading ? 'Still reading the inboxes.' : 'Nothing here is waiting on anyone right now.'} />
        )}
        {shown.map(item => (
          <Item key={item.id} item={item} owners={owners} open={openId === item.id}
            onToggle={() => setOpenId(openId === item.id ? null : item.id)} onMark={mark} />
        ))}
        {data?.cleared > 0 && (
          <div style={{ ...text('caption'), color: colour.inkFaint, textAlign: 'center', marginTop: space.md }}>
            {data.cleared} dealt with or put off — hidden
          </div>
        )}
      </Body>
    </Page>
  )
}
