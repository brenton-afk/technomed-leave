import React, { useState, useEffect, useCallback } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'

// ─── Every bookings@ email accounted for (Brent, 11 Nov 2026) ────────────────
// "Pt Bal is in the bookings email untouched and unbooked. When I check the
// portal tells me nothing outstanding. These mistakes cannot happen."
//
// Under the cards: every email of the last fortnight that did not become one,
// with why — and a way to have it read as a booking, or to say it is not one.
// Then the cases the check matched to the calendar, with the entry each was
// matched to, so a wrong match can be seen. Nothing in bookings@ is left
// without a line on this screen until a person has looked at it.

export const WHY = {
  'not-read-yet': 'Not read yet',
  unreadable: 'Could not be read',
  'nothing-found': 'Read — no booking found in it',
  distributor: 'From a distributor — not read',
  'not-a-booking-sender': 'Not from a hospital or surgeon’s rooms — not read',
  'dismissed-before': 'Read — but it matches a case someone marked “Not a booking”',
  accounted: 'Read'
}

const CARD_STATUS = {
  pending: 'waiting above to confirm',
  onCalendar: 'matched to the calendar',
  accepted: 'accepted onto the calendar',
  dismissed: 'dismissed'
}

/** What became of a searched email, in a sentence. */
export function cardsLine(cards = []) {
  if (!cards.length) return ''
  return cards.map(c => {
    const who = [c.patient, c.surgeon, c.date].filter(Boolean).join(' · ') || 'A booking'
    const what = CARD_STATUS[c.status] || c.status
    return `${who} — ${what}${c.status === 'onCalendar' && c.matchedSummary ? ` (“${c.matchedSummary}”)` : ''}`
  }).join('; ')
}

const gmailLink = id => `https://mail.google.com/mail/?authuser=bookings@technomed.com.au#all/${encodeURIComponent(id)}`

const shortDate = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', weekday: 'short', day: 'numeric', month: 'short' })
}

/** What a forced read came to, in a sentence. */
export function outcomeLine(outcome) {
  if (!outcome) return 'Checked — see the list above.'
  if (outcome.error) return 'It could not be read. Open it in Gmail and add the booking by hand.'
  const parts = []
  if (outcome.queued) parts.push(`${outcome.queued} booking${outcome.queued === 1 ? '' : 's'} added above to confirm`)
  if (outcome.already?.length) parts.push(`already on the calendar as “${outcome.already.filter(Boolean).join('”, “') || 'an entry'}”`)
  if (outcome.merged) parts.push('joined to a booking already waiting above')
  if (outcome.dismissed) parts.push('matches a booking someone marked “Not a booking” — add it by hand if it is one')
  if (!parts.length) return 'No booking could be found in it. Open it in Gmail and add it by hand if it is one.'
  return `${parts.join('; ')}.`
}

function Row({ email, busy, result, onRead, onReview }) {
  return (
    <div data-set-aside={email.messageId} style={{
      background: colour.surface, border: `1px solid ${email.looksLikeBooking ? colour.warningLine || colour.line : colour.line}`,
      borderRadius: radius.control, padding: space.sm, marginBottom: space.xs
    }}>
      <div style={{ ...text('bodyStrong'), color: colour.ink, overflowWrap: 'anywhere' }}>{email.subject || '(no subject)'}</div>
      <div style={{ ...text('caption'), color: colour.inkFaint, overflowWrap: 'anywhere' }}>
        {[email.from, shortDate(email.receivedAt)].filter(Boolean).join(' · ')}
      </div>
      <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: 2 }}>
        {email.why === 'accounted' && email.cards?.length ? cardsLine(email.cards) : (WHY[email.why] || email.why)}
      </div>
      {result && <div role="status" style={{ ...text('caption'), color: colour.ink, marginTop: space.xs }}>{result}</div>}
      <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginTop: space.xs }}>
        <button type="button" onClick={onRead} disabled={busy} style={{
          ...text('caption'), fontWeight: 700, minHeight: 34, padding: `0 ${space.md}px`, cursor: busy ? 'default' : 'pointer',
          border: 'none', borderRadius: radius.control, background: colour.accent, color: 'white'
        }}>{busy === 'read' ? 'Reading…' : 'Read it as a booking'}</button>
        <button type="button" onClick={onReview} disabled={Boolean(busy)} style={{
          ...text('caption'), minHeight: 34, padding: `0 ${space.md}px`, cursor: busy ? 'default' : 'pointer',
          border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.inkMuted
        }}>Not a booking</button>
        <a href={gmailLink(email.messageId)} target="_blank" rel="noopener noreferrer" style={{
          ...text('caption'), minHeight: 34, display: 'inline-flex', alignItems: 'center', padding: `0 ${space.sm}px`, color: colour.accent
        }}>Open in Gmail</a>
      </div>
    </div>
  )
}

export default function SetAsideEmails({ headers, refreshKey, onRead }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState({})
  const [results, setResults] = useState({})
  const [showOther, setShowOther] = useState(false)
  const [showMatched, setShowMatched] = useState(false)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState(null)
  const [searching, setSearching] = useState(false)

  async function search(e) {
    e?.preventDefault()
    const q = query.trim()
    if (!q) { setFound(null); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/calendar/today?action=setaside&q=${encodeURIComponent(q)}`, { headers: headers() })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not search bookings@')
      setFound({ q, emails: body.emails || [] })
    } catch (err) {
      setFound({ q, emails: [], error: err.message })
    }
    setSearching(false)
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/today?action=setaside', { headers: headers() })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not list the bookings inbox')
      setData({ emails: body.emails || [], matched: body.matched || [] })
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [headers])

  useEffect(() => { load() }, [load, refreshKey])

  async function read(id) {
    setBusy(b => ({ ...b, [id]: 'read' }))
    try {
      const res = await fetch('/api/calendar/today?action=ingest', {
        method: 'POST', headers: headers(), body: JSON.stringify({ force: [id] })
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not read it')
      if (body.skipped) throw new Error('Another check is running — try again in a moment.')
      setResults(r => ({ ...r, [id]: outcomeLine(body.outcomes?.[id]) }))
      onRead?.(body)
    } catch (err) {
      setResults(r => ({ ...r, [id]: err.message }))
    }
    setBusy(b => ({ ...b, [id]: '' }))
  }

  async function review(id) {
    setBusy(b => ({ ...b, [id]: 'review' }))
    try {
      const res = await fetch('/api/calendar/today?action=setaside', {
        method: 'POST', headers: headers(), body: JSON.stringify({ messageId: id, review: true })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save that')
      setData(d => ({ ...d, emails: d.emails.filter(e => e.messageId !== id) }))
    } catch (err) {
      setResults(r => ({ ...r, [id]: err.message }))
    }
    setBusy(b => ({ ...b, [id]: '' }))
  }

  if (error) {
    return <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.md }}>
      Could not list the emails set aside: {error}
    </div>
  }
  if (!data) return null

  const likely = data.emails.filter(e => e.looksLikeBooking)
  const other = data.emails.filter(e => !e.looksLikeBooking)
  const row = e => (
    <Row key={e.messageId} email={e} busy={busy[e.messageId]} result={results[e.messageId]}
      onRead={() => read(e.messageId)} onReview={() => review(e.messageId)} />
  )
  const fold = (open, set, label) => (
    <button type="button" aria-expanded={open} onClick={() => set(v => !v)} style={{
      ...text('caption'), fontWeight: 700, background: 'none', border: 'none', padding: `${space.xs}px 0`,
      color: colour.inkMuted, cursor: 'pointer', textAlign: 'left'
    }}>{open ? '▾' : '▸'} {label}</button>
  )

  const finder = (
    <form onSubmit={search} style={{ display: 'flex', gap: space.xs, margin: `${space.sm}px 0` }}>
      <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Find an email in bookings@"
        placeholder="Find an email in bookings@ — a surname, surgeon or subject"
        style={{
          ...text('field'), flex: 1, minWidth: 0, padding: `${space.xs}px ${space.sm}px`,
          border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink
        }} />
      <button type="submit" disabled={searching} style={{
        ...text('caption'), fontWeight: 700, minHeight: 40, padding: `0 ${space.md}px`, border: 'none',
        borderRadius: radius.control, background: colour.navy, color: 'white', cursor: 'pointer'
      }}>{searching ? 'Finding…' : 'Find'}</button>
    </form>
  )
  const foundList = found && (
    <div data-found-emails style={{ marginBottom: space.md }}>
      <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.xs }}>
        {found.error ? found.error
          : found.emails.length ? `${found.emails.length} email${found.emails.length === 1 ? '' : 's'} in bookings@ matching “${found.q}” (last four months):`
            : `Nothing in bookings@ matches “${found.q}” in the last four months.`}
      </div>
      {found.emails.map(row)}
    </div>
  )

  return (
    <div data-set-aside-list style={{ marginTop: space.lg }}>
      {finder}
      {foundList}
      <div style={{ ...text('heading'), color: colour.ink }}>
        {data.emails.length ? `Set aside — ${data.emails.length} email${data.emails.length === 1 ? '' : 's'} to look at` : 'Every email accounted for'}
      </div>
      <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
        {data.emails.length
          ? 'Emails in bookings@ from the last fortnight that did not become a booking above. Read each as a booking, or mark it not one.'
          : 'Every email in bookings@ from the last fortnight became a booking, matched the calendar, or was marked not a booking.'}
      </div>
      {likely.map(row)}
      {other.length > 0 && <>
        {fold(showOther, setShowOther, `Other emails (${other.length})`)}
        {showOther && other.map(row)}
      </>}
      {data.matched?.length > 0 && <>
        {fold(showMatched, setShowMatched, `Already on the calendar (${data.matched.length}) — check the match`)}
        {showMatched && data.matched.map(m => (
          <div key={m.id} data-matched={m.id} style={{
            ...text('caption'), color: colour.inkMuted, padding: `${space.xs}px 0`, borderBottom: `1px solid ${colour.lineSoft || colour.line}`
          }}>
            <span style={{ color: colour.ink, fontWeight: 700 }}>{[m.patient, m.surgeon, m.date].filter(Boolean).join(' · ')}</span>
            {' '}matched “{m.matchedSummary || 'a calendar entry'}”
          </div>
        ))}
      </>}
    </div>
  )
}
