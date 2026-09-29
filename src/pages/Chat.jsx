import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Page, Header, Body, SectionLabel, Banner } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { identifierWarning } from '../chat/identifiers.js'

// ─── The internal channels ───────────────────────────────────────────────────
// What the WhatsApp group does, in the app that already holds the bookings the
// group spends its day talking about.
//
// Polled rather than pushed. Nine people and a few dozen messages a day do not
// need a socket, and a poll that stops when the tab is hidden costs nothing
// while nobody is looking.

const POLL_MS = 8000

/** The day a message was sent, said the way somebody would say it. */
function dayLabel(iso, today) {
  const at = String(iso || '').slice(0, 10)
  if (at === today) return 'Today'
  const yesterday = new Date(`${today}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  if (at === yesterday.toISOString().slice(0, 10)) return 'Yesterday'
  return at
}

const timeOf = iso => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toTimeString().slice(0, 5)
}

function Message({ message, mine, runOn }) {
  return (
    <div style={{ marginBottom: runOn ? 2 : space.sm }}>
      {!runOn && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, marginBottom: 1 }}>
          <span style={{ ...text('bodyStrong'), color: mine ? colour.accentDeep : colour.ink }}>
            {message.authorName}
          </span>
          <span style={{ ...text('micro'), color: colour.inkFainter }}>{timeOf(message.at)}</span>
        </div>
      )}
      {/* Wrapped, not truncated, and whitespace kept: people paste list orders
          in here and a line break is part of what they wrote. */}
      <div style={{
        ...text('body'), color: colour.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word'
      }}>
        {message.text}
      </div>
    </div>
  )
}

function Composer({ onSend, sending }) {
  const [draft, setDraft] = useState('')
  const [override, setOverride] = useState(false)
  const warning = identifierWarning(draft)

  function submit() {
    const text = draft.trim()
    if (!text || sending) return
    // Warned once. A second tap sends it — the message always goes, and this
    // only insists the warning was seen.
    if (warning && !override) { setOverride(true); return }
    onSend(text, Boolean(warning))
    setDraft('')
    setOverride(false)
  }

  return (
    <div style={{
      borderTop: `1px solid ${colour.line}`, background: colour.surface,
      padding: `${space.sm}px ${space.md}px calc(${space.sm}px + env(safe-area-inset-bottom, 0px))`
    }}>
      {warning && (
        <div style={{
          ...text('caption'), color: colour.ink, background: colour.warningSoft,
          border: `1px solid ${colour.warningLine}`, borderRadius: radius.control,
          padding: space.sm, marginBottom: space.xs
        }}>
          ⚠ {warning}
          {override && (
            <span style={{ display: 'block', marginTop: 2, color: colour.inkMuted }}>
              Send again to post it as written.
            </span>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: space.sm, alignItems: 'flex-end' }}>
        <textarea
          value={draft}
          onChange={e => { setDraft(e.target.value); setOverride(false) }}
          onKeyDown={e => {
            // Enter sends, Shift+Enter makes a line. On a phone the on-screen
            // return key inserts a line, which is what anyone expects there.
            if (e.key === 'Enter' && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder="Message"
          aria-label="Message"
          style={{
            flex: 1, resize: 'none', minHeight: 40, maxHeight: 140,
            padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
            border: `1px solid ${colour.line}`, borderRadius: radius.control,
            ...text('field'), fontFamily: 'inherit',
            color: colour.ink, background: colour.canvas, outline: 'none'
          }} />
        <button onClick={submit} disabled={!draft.trim() || sending}
          style={{
            padding: `0 ${space.lg}px`, height: 40, borderRadius: radius.control,
            border: 'none', ...text('bodyStrong'), color: 'white',
            background: (!draft.trim() || sending) ? colour.inkFainter : colour.accent,
            cursor: (!draft.trim() || sending) ? 'default' : 'pointer'
          }}>
          {sending ? '…' : warning && !override ? 'Check' : 'Send'}
        </button>
      </div>
    </div>
  )
}

/** One channel, open. */
export function ChannelView({ channel, title, subtitle, user, onBack }) {
  const [messages, setMessages] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const foot = useRef(null)
  const today = new Date().toISOString().slice(0, 10)

  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?channel=${encodeURIComponent(channel)}`, { headers: auth })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not read the channel')
      setMessages(data.messages || [])
    } catch (err) {
      setError(err.message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, user?.token])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    // Only while somebody is looking. A tab left open in a back pocket should
    // not poll all night.
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  useEffect(() => {
    // Guarded rather than assumed: not every environment has it, and a chat
    // that throws on arriving at the newest message is worse than one that
    // simply does not scroll.
    const end = foot.current
    if (typeof end?.scrollIntoView === 'function') end.scrollIntoView({ block: 'end' })
  }, [messages?.length])

  async function send(body, warned) {
    setSending(true)
    // Shown straight away. A message that takes a round trip to appear feels
    // broken on a hospital connection, and the poll will reconcile it.
    const pending = {
      id: `pending_${Date.now()}`, authorName: 'You', author: user?.email,
      text: body, at: new Date().toISOString()
    }
    setMessages(list => [...(list || []), pending])
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ channel, text: body, warned })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'That did not send')
      await load()
    } catch (err) {
      setError(err.message)
      setMessages(list => (list || []).filter(m => m.id !== pending.id))
    }
    setSending(false)
  }

  let lastDay = null
  let lastAuthor = null

  return (
    <Page style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Header eyebrow="Team" title={title} subtitle={subtitle} onBack={onBack} />

      <div style={{ flex: 1, overflowY: 'auto', padding: space.md, minHeight: 0 }}>
        {error && <Banner tone="danger">{error}</Banner>}
        {messages === null && (
          <div style={{ ...text('caption'), color: colour.inkFaint }}>Loading…</div>
        )}
        {messages?.length === 0 && (
          <div style={{ ...text('body'), color: colour.inkMuted }}>
            Nothing here yet. This is the place for it.
          </div>
        )}
        {(messages || []).map(message => {
          const day = dayLabel(message.at, today)
          const newDay = day !== lastDay
          // Consecutive messages from one person read as one turn, not five
          // stamped cards — which is what makes a chat look like a chat.
          const runOn = !newDay && message.author === lastAuthor
          lastDay = day
          lastAuthor = message.author
          return (
            <div key={message.id}>
              {newDay && (
                <div style={{
                  ...text('micro'), textTransform: 'uppercase', color: colour.inkFainter,
                  textAlign: 'center', margin: `${space.md}px 0 ${space.sm}px`
                }}>{day}</div>
              )}
              <Message message={message} mine={message.author === user?.email} runOn={runOn} />
            </div>
          )
        })}
        <div ref={foot} />
      </div>

      <Composer onSend={send} sending={sending} />
    </Page>
  )
}

/** The channel list. */
export default function Chat({ user, onBack }) {
  const [overview, setOverview] = useState(null)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/chat?action=overview', {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      if (!res.ok) return
      setOverview(await res.json())
    } catch {
      // A channel list that will not load is not worth an error screen; the
      // channels are fixed and tapping one still works.
    }
  }, [user])

  useEffect(() => { load() }, [load])

  if (open) {
    return (
      <ChannelView
        channel={open.id}
        title={open.name}
        subtitle={open.detail}
        user={user}
        onBack={() => { setOpen(null); load() }} />
    )
  }

  const channels = overview?.channels
    || [{ id: 'general', name: 'General', detail: 'Anything that is not the others' }]

  return (
    <Page>
      <Header eyebrow="Team" title="Messages" subtitle="The group, where the bookings are" onBack={onBack} />
      <Body>
        <SectionLabel>Channels</SectionLabel>
        {channels.map(channel => (
          <button key={channel.id} onClick={() => setOpen(channel)}
            style={{
              display: 'flex', alignItems: 'center', gap: space.md, width: '100%',
              textAlign: 'left', background: colour.surface,
              border: `1px solid ${colour.line}`, borderRadius: radius.card,
              padding: space.md, marginBottom: space.sm, cursor: 'pointer'
            }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>
                # {channel.name}
              </span>
              <span style={{ ...text('caption'), color: colour.inkFaint }}>{channel.detail}</span>
            </span>
            {channel.unread > 0 && (
              <span style={{
                ...text('micro'), fontWeight: 700, flexShrink: 0,
                background: colour.accent, color: 'white',
                borderRadius: radius.pill, padding: '2px 8px'
              }}>{channel.unread}</span>
            )}
            <span style={{ ...text('body'), color: colour.inkFaint }}>›</span>
          </button>
        ))}

        <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: space.md }}>
          Every booking has its own thread as well — open a case and look for the
          messages at the foot of it.
        </div>
      </Body>
    </Page>
  )
}
