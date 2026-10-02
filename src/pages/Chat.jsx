import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Page, Header, Body, SectionLabel, Banner, Button, Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { identifierWarning } from '../chat/identifiers.js'
import { usePush } from '../push.js'
import { upload } from '@vercel/blob/client'
import { shrink, PHOTO_WARNING } from '../chat/photo.js'

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
      {message.text && (
        <div style={{
          ...text('body'), color: colour.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word'
        }}>
          {message.text}
        </div>
      )}

      {message.photo?.url && (
        <a href={message.photo.url} target="_blank" rel="noreferrer"
          style={{ display: 'block', marginTop: message.text ? 4 : 0, maxWidth: 260 }}>
          <img
            src={message.photo.url}
            alt="Photo"
            // The shape is known before the bytes arrive, so a channel does not
            // jump about while pictures load and nobody loses their place
            // halfway through reading a running order.
            width={message.photo.width || undefined}
            height={message.photo.height || undefined}
            loading="lazy"
            style={{
              display: 'block', width: '100%', height: 'auto', maxWidth: 260,
              borderRadius: radius.control, border: `1px solid ${colour.line}`,
              background: colour.lineSoft
            }} />
        </a>
      )}
    </div>
  )
}

function Composer({ onSend, sending, user }) {
  const [draft, setDraft] = useState('')
  const [override, setOverride] = useState(false)
  const [photo, setPhoto] = useState(null)      // { blob, width, height, preview }
  const [busy, setBusy] = useState('')
  const picker = useRef(null)
  const warning = identifierWarning(draft)

  async function choose(file) {
    if (!file) return
    setBusy('reading')
    try {
      const { blob, width, height } = await shrink(file)
      setPhoto({ blob, width, height, preview: URL.createObjectURL(blob) })
      setOverride(false)
    } catch (err) {
      setBusy(err.message || 'That photo could not be read')
      return
    }
    setBusy('')
  }

  function drop() {
    if (photo?.preview) URL.revokeObjectURL(photo.preview)
    setPhoto(null)
    setOverride(false)
  }

  async function submit() {
    const body = draft.trim()
    if ((!body && !photo) || sending || busy === 'reading') return
    // Warned once, and a photograph always warns — it cannot be read the way
    // text can, and a picture of a booking form carries a full name. A second
    // tap sends it: this insists the warning was seen, it does not refuse.
    if ((warning || photo) && !override) { setOverride(true); return }

    let uploaded = null
    if (photo) {
      setBusy('sending')
      try {
        const result = await upload(`chat/${Date.now()}.jpg`, photo.blob, {
          access: 'public',
          contentType: 'image/jpeg',
          handleUploadUrl: '/api/chat?action=blob-upload',
          // The SDK builds its own request, so the session cannot ride on a
          // header. Checked server-side before a write token is issued.
          clientPayload: JSON.stringify({ token: user?.token || null })
        })
        uploaded = { url: result.url, width: photo.width, height: photo.height }
      } catch {
        setBusy('That photo did not send')
        return
      }
      setBusy('')
    }

    onSend(body, Boolean(warning), uploaded)
    setDraft('')
    drop()
    setOverride(false)
  }

  const blocked = sending || busy === 'reading' || busy === 'sending'
  const nothing = !draft.trim() && !photo

  return (
    <div style={{
      borderTop: `1px solid ${colour.line}`, background: colour.surface,
      padding: `${space.sm}px ${space.md}px calc(${space.sm}px + env(safe-area-inset-bottom, 0px))`
    }}>
      {(warning || (photo && !busy)) && (
        <div style={{
          ...text('caption'), color: colour.ink, background: colour.warningSoft,
          border: `1px solid ${colour.warningLine}`, borderRadius: radius.control,
          padding: space.sm, marginBottom: space.xs
        }}>
          ⚠ {warning || PHOTO_WARNING}
          {override && (
            <span style={{ display: 'block', marginTop: 2, color: colour.inkMuted }}>
              Send again to post it as written.
            </span>
          )}
        </div>
      )}

      {busy && busy !== 'reading' && busy !== 'sending' && (
        <div style={{
          ...text('caption'), color: colour.danger, marginBottom: space.xs
        }}>{busy}</div>
      )}

      {photo && (
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: space.xs }}>
          <img src={photo.preview} alt="" style={{
            display: 'block', maxHeight: 96, borderRadius: radius.control,
            border: `1px solid ${colour.line}`
          }} />
          <button type="button" onClick={drop} aria-label="Remove photo"
            style={{
              position: 'absolute', top: -8, right: -8, width: 26, height: 26,
              borderRadius: radius.pill, border: `1px solid ${colour.line}`,
              background: colour.surface, cursor: 'pointer', ...text('caption'),
              color: colour.inkMuted, lineHeight: 1
            }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: space.sm, alignItems: 'flex-end' }}>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          aria-label="Add a photo"
          style={{ fontSize: 16, display: 'none' }}
          onChange={e => { choose(e.target.files?.[0]); e.target.value = '' }} />
        <button type="button" onClick={() => picker.current?.click()}
          aria-label="Add a photo" disabled={blocked}
          style={{
            width: 40, height: 40, flexShrink: 0, borderRadius: radius.control,
            border: `1px solid ${colour.line}`, background: colour.canvas,
            cursor: blocked ? 'default' : 'pointer', ...text('body'),
            color: colour.inkMuted, padding: 0
          }}>
          {busy === 'reading' ? '…' : '📷'}
        </button>

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
          placeholder={photo ? 'Say something about it (optional)' : 'Message'}
          aria-label="Message"
          style={{
            flex: 1, resize: 'none', minHeight: 40, maxHeight: 140,
            padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
            border: `1px solid ${colour.line}`, borderRadius: radius.control,
            ...text('field'), fontFamily: 'inherit',
            color: colour.ink, background: colour.canvas, outline: 'none'
          }} />
        <button onClick={submit} disabled={nothing || blocked}
          style={{
            padding: `0 ${space.lg}px`, height: 40, borderRadius: radius.control,
            border: 'none', ...text('bodyStrong'), color: 'white',
            background: (nothing || blocked) ? colour.inkFainter : colour.accent,
            cursor: (nothing || blocked) ? 'default' : 'pointer'
          }}>
          {busy === 'sending' ? '…' : sending ? '…' : (warning || photo) && !override ? 'Check' : 'Send'}
        </button>
      </div>
    </div>
  )
}

/**
 * The switch that makes this worth opening.
 *
 * Offered rather than asked for. iOS refuses a permission prompt that did not
 * come from a tap, and a refusal cannot be asked for again — it has to be undone
 * in the phone's settings, which nobody will do. So the app never asks on its
 * own; this does, when somebody chooses.
 */
function Notifications({ user }) {
  const { state, busy, toggle } = usePush(user?.token)
  const [tested, setTested] = useState('')
  if (state === 'unknown') return null

  // Once they are on, this gets out of the way — but not entirely. Nine people
  // turn this on once, and the only other way to find out whether a phone is
  // really registered is to wait for a colleague to send something, which is a
  // poor way to discover it never was.
  if (state === 'on') {
    return (
      <div style={{
        ...text('caption'), color: colour.inkFainter, marginBottom: space.md,
        display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap'
      }}>
        <span>Notifications are on for this device.</span>
        <button
          onClick={async () => {
            setTested('sending')
            try {
              const res = await fetch('/api/push?action=test', {
                headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
              })
              const data = await res.json()
              setTested(data.sent > 0 ? 'sent' : 'none')
            } catch {
              setTested('none')
            }
          }}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            ...text('caption'), fontWeight: 700, color: colour.accentDeep
          }}>
          Send a test
        </button>
        {tested === 'sending' && <span>Sending…</span>}
        {tested === 'sent' && <span>Sent — it should appear in a moment.</span>}
        {tested === 'none' && (
          <span style={{ color: colour.warning }}>
            Nothing was sent. Try turning them off and on again.
          </span>
        )}
      </div>
    )
  }

  const said = {
    // In a Safari tab there is no push at all, and saying "not supported" would
    // be both discouraging and untrue — it is one step away.
    'not-installed': {
      tone: 'info',
      text: 'To get messages on your phone, add this to your Home Screen first — '
        + 'the share button, then “Add to Home Screen”. Then open it from there.',
      action: null
    },
    blocked: {
      tone: 'warning',
      text: 'Notifications are blocked for this app. That can only be undone in '
        + 'your phone’s Settings — find TechnoMed and allow notifications.',
      action: null
    },
    unsupported: {
      tone: 'info',
      text: 'This device cannot show notifications. Messages will still be here '
        + 'when you open the app.',
      action: null
    },
    off: {
      tone: 'info',
      text: 'Turn on notifications and this works like the WhatsApp group — '
        + 'a message here reaches everyone’s phone.',
      action: busy ? 'Just a moment…' : 'Turn on notifications'
    }
  }[state]

  if (!said) return null

  return (
    <Banner
      tone={said.tone}
      action={said.action
        ? (
          <Button onClick={toggle} disabled={busy}>{said.action}</Button>
        )
        : undefined}>
      {said.text}
    </Banner>
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

  async function send(body, warned, photo) {
    setSending(true)
    // Shown straight away. A message that takes a round trip to appear feels
    // broken on a hospital connection, and the poll will reconcile it.
    const pending = {
      id: `pending_${Date.now()}`, authorName: 'You', author: user?.email,
      text: body, photo, at: new Date().toISOString()
    }
    setMessages(list => [...(list || []), pending])
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ channel, text: body, warned, photo })
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

      <Composer onSend={send} sending={sending} user={user} />
    </Page>
  )
}


/**
 * A booking's own thread, opened from the booking.
 *
 * The channels are organised by subject — spine, logistics, theatre lists — and
 * most of what gets said is not about a subject, it is about a case. "Has the
 * Diplomat gone over for Thursday", asked in a channel, is findable for about
 * an hour and then it is gone; asked here it is still attached to the booking
 * in six months when somebody asks why the case moved.
 *
 * The id was reserved when the channels were built (caseChannel in api/chat.js)
 * and there has never been a way in. This is the way in.
 */
export function CaseThread({ eventId, subtitle, user, onClose }) {
  return (
    <Overlay>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 3100, background: colour.canvas,
        display: 'flex', flexDirection: 'column'
      }}>
        <ChannelView
          channel={`case:${eventId}`}
          title="Case messages"
          subtitle={subtitle}
          user={user}
          onBack={onClose} />
      </div>
    </Overlay>
  )
}

/** The channel list. */
export default function Chat({ user, onBack, onRead }) {
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
        onBack={() => { setOpen(null); load(); onRead?.() }} />
    )
  }

  const channels = overview?.channels
    || [{ id: 'general', name: 'General', detail: 'Anything that is not the others' }]

  return (
    <Page>
      <Header eyebrow="Team" title="Messages" subtitle="The group, where the bookings are" onBack={onBack} />
      <Body>
        <Notifications user={user} />

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
