import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Page, Header, Body, SectionLabel, Banner, Button, Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius, site } from '../design/tokens.js'
import { chatWarning } from '../chat/identifiers.js'
import { usePush, installHint, installed } from '../push.js'
import { upload } from '@vercel/blob/client'
import { shrink } from '../chat/photo.js'
import { fileTypeOf } from '../chat/fileTypes.js'

// ─── The team's messages (Brent, 6 Nov 2026) ─────────────────────────────────
// "It needs to run faultlessly and seamlessly like WhatsApp … share photos,
// gifs, images, scans, documents … search the chats really easily … adopt
// the advantages of apps like Slack." So: channels, a 2.5-second refresh while
// a channel is open (push notifications the rest of the time), photos, GIFs,
// video and documents, replies, reactions, @mentions, typing, "seen by",
// delete your own, and search across every channel.
//
// Names and UR numbers are allowed in chat (Brent: needed to run the
// business, stored safely and archived); only a date of birth is queried.

const POLL_MS = 2500
const TYPING_EVERY_MS = 3000
export const REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '✅']

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

/** The time beside a chat in the list: today's time, else Yesterday, else the date. */
export function listTime(iso, now = new Date()) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const day = d => d.toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart' })
  if (day(at) === day(now)) return at.toLocaleTimeString('en-AU', { timeZone: 'Australia/Hobart', hour: 'numeric', minute: '2-digit' })
  if (day(at) === day(new Date(now.getTime() - 86400000))) return 'Yesterday'
  return at.toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short' })
}

const sizeOf = n => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

// ─── Looking like WhatsApp, built for us (Brent, 7 Nov 2026) ─────────────────
// "Make it look a bit more slick with the option to put icons for the chats."
// Round icons on every chat (an emoji or a photo, changed by anyone, as in a
// WhatsApp group), the last message under each name, bubbles — yours on the
// right in the accent tint — and a rounded message bar.

/** Names coloured per person in a group, the way WhatsApp tells people apart. */
const NAME_INKS = [colour.accentDeep, site.CLV.ink, site.RHH.ink, colour.warning, colour.navy, colour.inkMuted]
export function nameInk(key) {
  let h = 0
  for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return NAME_INKS[h % NAME_INKS.length]
}

/** The icons offered for a chat. Anything else can be a photo. */
export const ICON_CHOICES = ['💬', '🦴', '📦', '📋', '🛠️', '🏥', '🩺', '🔩', '🧠', '🦷', '🚚', '📅', '⭐', '☕', '🎉', '🔥']

export function ChatAvatar({ icon, name, size = 48 }) {
  const box = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: colour.accentSoft, border: `1px solid ${colour.line}`
  }
  if (icon?.url) {
    return <span data-chat-avatar style={box}><img src={icon.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>
  }
  const glyph = icon?.emoji || String(name || '?').slice(0, 1).toUpperCase()
  return (
    <span data-chat-avatar aria-hidden="true" style={{ ...box, ...text(size >= 44 ? 'title' : 'heading'), lineHeight: 1 }}>
      {glyph}
    </span>
  )
}

/** Choose a chat's icon: an emoji, a photo, or back to the usual. */
function IconSheet({ channel, user, onClose, onSaved }) {
  const [busy, setBusy] = useState('')
  const picker = useRef(null)
  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}

  async function save(body) {
    setBusy('Saving…')
    try {
      const res = await fetch('/api/chat?action=icon', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ channel: channel.id, ...body })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That icon did not save')
      onSaved(data.icon)
      onClose()
    } catch (err) { setBusy(err.message) }
  }

  async function photo(file) {
    if (!file) return
    setBusy('Uploading…')
    try {
      const { blob } = await shrink(file)
      const result = await upload(`chat/icon-${channel.id}-${Date.now()}.jpg`, blob, {
        access: 'public', contentType: 'image/jpeg', handleUploadUrl: '/api/chat?action=blob-upload',
        clientPayload: JSON.stringify({ token: user?.token || null })
      })
      await save({ url: result.url })
    } catch { setBusy('That photo did not upload — try again') }
  }

  return (
    <Overlay>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.35)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div data-icon-sheet onClick={e => e.stopPropagation()} style={{
          background: colour.surface, width: '100%', maxWidth: 520, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          padding: `${space.lg}px ${space.lg}px calc(${space.lg}px + env(safe-area-inset-bottom, 0px))`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.md, marginBottom: space.md }}>
            <ChatAvatar icon={channel.icon} name={channel.name} size={44} />
            <div style={{ flex: 1 }}>
              <div style={{ ...text('heading'), color: colour.ink }}>Icon for {channel.name}</div>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>Everyone in the team sees it</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: space.xs, marginBottom: space.md }}>
            {ICON_CHOICES.map(e => (
              <button key={e} type="button" aria-label={`Use ${e}`} onClick={() => save({ emoji: e })}
                style={{ ...text('title'), aspectRatio: '1', border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.canvas, cursor: 'pointer', padding: 0 }}>{e}</button>
            ))}
          </div>
          <input ref={picker} type="file" accept="image/*" style={{ fontSize: 16, display: 'none' }}
            onChange={e => { photo(e.target.files?.[0]); e.target.value = '' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.sm }}>
            <Button onClick={() => picker.current?.click()}>Use a photo</Button>
            <Button variant="secondary" onClick={() => save({})}>Back to the usual</Button>
          </div>
          {busy && <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: space.sm }}>{busy}</div>}
        </div>
      </div>
    </Overlay>
  )
}

/** One attached file, drawn as what it is. */
export function Attachment({ file }) {
  const type = String(file.type || '')
  if (type.startsWith('image/')) {
    return (
      <a href={file.url} target="_blank" rel="noreferrer" style={{ display: 'block', maxWidth: 260, marginTop: 4 }}>
        <img src={file.url} alt={file.name || 'Photo'} loading="lazy"
          width={file.width || undefined} height={file.height || undefined}
          style={{
            display: 'block', width: '100%', height: 'auto', maxWidth: 260,
            borderRadius: radius.control, border: `1px solid ${colour.line}`, background: colour.lineSoft
          }} />
      </a>
    )
  }
  if (type.startsWith('video/')) {
    return (
      <video src={file.url} controls playsInline preload="metadata"
        style={{ display: 'block', maxWidth: 260, width: '100%', marginTop: 4, borderRadius: radius.control, background: colour.ink }} />
    )
  }
  const ext = (String(file.name || '').split('.').pop() || 'file').slice(0, 4).toUpperCase()
  return (
    <a href={file.url} target="_blank" rel="noreferrer" data-file-card
      style={{
        display: 'flex', alignItems: 'center', gap: space.sm, marginTop: 4, maxWidth: 280,
        padding: space.sm, borderRadius: radius.control, border: `1px solid ${colour.line}`,
        background: colour.surface, textDecoration: 'none'
      }}>
      <span style={{
        ...text('micro'), fontWeight: 700, color: 'white', background: colour.navy,
        borderRadius: 6, padding: '6px 6px', minWidth: 36, textAlign: 'center'
      }}>{ext}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block', overflowWrap: 'anywhere' }}>{file.name}</span>
        <span style={{ ...text('caption'), color: colour.inkFaint }}>{sizeOf(file.size) || 'Open'}</span>
      </span>
    </a>
  )
}

/** Text with @mentions picked out. */
function WithMentions({ value }) {
  const parts = String(value).split(/(@[A-Za-z]+)/g)
  return parts.map((part, i) => (/^@[A-Za-z]+$/.test(part)
    ? <span key={i} style={{ color: colour.accentDeep, fontWeight: 700 }}>{part}</span>
    : <React.Fragment key={i}>{part}</React.Fragment>))
}

function Message({ message, mine, runOn, open, onToggle, onReact, onReply, onDelete, mentionsMe, seenAll }) {
  const files = [...(message.photo?.url ? [{ ...message.photo, type: 'image/jpeg', name: 'Photo' }] : []), ...(message.files || [])]
  const reactions = Object.entries(message.reactions || {})
  const corner = runOn ? 12 : 3
  return (
    <div data-message={message.id} style={{
      display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start',
      marginTop: runOn ? 2 : space.sm
    }}>
      <div data-bubble={mine ? 'mine' : 'theirs'} role="button" tabIndex={0} onClick={onToggle} style={{
        cursor: 'pointer', maxWidth: '82%', minWidth: 72, boxSizing: 'border-box',
        background: mine ? colour.accentSoft : colour.surface,
        border: `1px solid ${mentionsMe ? colour.accent : mine ? 'rgba(24,154,133,0.22)' : colour.line}`,
        borderRadius: mine ? `12px ${corner}px 12px 12px` : `${corner}px 12px 12px 12px`,
        boxShadow: '0 1px 1px rgba(4,39,70,0.06)', padding: '6px 9px 4px'
      }}>
        {!runOn && !mine && (
          <div style={{ ...text('caption'), fontWeight: 700, color: nameInk(message.author || message.authorName) }}>
            {message.authorName}
          </div>
        )}
        {message.replyTo && (
          <div style={{
            ...text('caption'), color: colour.inkMuted, borderLeft: `3px solid ${nameInk(message.replyTo.authorName)}`,
            padding: `2px ${space.sm}px`, margin: '2px 0 4px', background: 'rgba(4,39,70,0.05)', borderRadius: 6
          }}>
            <strong style={{ color: nameInk(message.replyTo.authorName), display: 'block' }}>{message.replyTo.authorName}</strong>
            {message.replyTo.text}
          </div>
        )}
        {!message.deleted && files.map(f => <Attachment key={f.url} file={f} />)}
        {message.deleted
          ? <div style={{ ...text('body'), color: colour.inkFaint, fontStyle: 'italic' }}>🚫 This message was deleted</div>
          : message.text && (
            // Wrapped, not truncated, and whitespace kept: people paste list
            // orders in here and a line break is part of what they wrote.
            <div style={{ ...text('body'), color: colour.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <WithMentions value={message.text} />
            </div>
          )}
        <div style={{ ...text('micro'), fontWeight: 400, letterSpacing: 0, color: colour.inkFainter, textAlign: 'right', marginTop: 1 }}>
          {message.pending ? 'Sending…' : timeOf(message.at)}
          {mine && !message.pending && (
            <span aria-label={seenAll ? 'Seen' : 'Sent'} style={{ marginLeft: 4, color: seenAll ? colour.accent : colour.inkFainter }}>✓✓</span>
          )}
        </div>
      </div>

      {reactions.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: -4, padding: '0 6px' }}>
          {reactions.map(([emoji, people]) => (
            <button key={emoji} type="button" onClick={() => onReact(emoji)} title={people.join(', ')}
              style={{
                ...text('caption'), border: `1px solid ${colour.line}`, background: colour.surface,
                borderRadius: radius.pill, padding: '0 7px', cursor: 'pointer', boxShadow: '0 1px 2px rgba(4,39,70,0.08)'
              }}>{emoji} {people.length}</button>
          ))}
        </div>
      )}

      {open && !message.deleted && !message.pending && (
        <div data-message-actions style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 4,
          padding: 4, background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.pill,
          boxShadow: '0 2px 8px rgba(4,39,70,0.10)', width: 'fit-content', maxWidth: '100%'
        }}>
          {REACTIONS.map(emoji => (
            <button key={emoji} type="button" aria-label={`React ${emoji}`} onClick={() => onReact(emoji)}
              style={{ ...text('heading'), border: 'none', background: 'none', cursor: 'pointer', padding: '2px 4px' }}>{emoji}</button>
          ))}
          <button type="button" onClick={onReply} style={actionStyle}>Reply</button>
          {message.text && (
            <button type="button" style={actionStyle}
              onClick={() => { try { navigator.clipboard?.writeText(message.text) } catch { /* not allowed here */ } onToggle() }}>Copy</button>
          )}
          {mine && <button type="button" onClick={onDelete} style={{ ...actionStyle, color: colour.danger }}>Delete</button>}
        </div>
      )}
    </div>
  )
}

const actionStyle = {
  ...text('caption'), fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer',
  color: colour.navy, padding: '4px 8px'
}

// Anything at all, as in WhatsApp — a type nobody can name goes as a file card.
const ACCEPT = undefined

/** A picked file, ready to upload: photos shrunk, everything else as it is. */
async function prepare(file) {
  const type = fileTypeOf(file)
  if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name || 'That file'} is over 100 MB`)
  // A GIF stays a GIF — shrinking it would freeze it on its first frame. A
  // picture this browser cannot draw (a HEIC on a PC) goes as it is rather than
  // not at all.
  if (type.startsWith('image/') && !['image/gif', 'image/svg+xml'].includes(type)) {
    try {
      // Shrinking a big or unusual photo can hang on some phones; after 10s the
      // original goes as it is instead.
      const { blob, width, height } = await withTimeout(() => shrink(file), 10000, 'shrink took too long')
      return { blob, type: 'image/jpeg', name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', size: blob.size, width, height, preview: URL.createObjectURL(blob) }
    } catch { /* fall through and send the original */ }
  }
  return { blob: file, type, name: file.name || 'file', size: file.size, preview: type.startsWith('image/') ? URL.createObjectURL(file) : null }
}

const DIRECT_MAX = 3 * 1024 * 1024

function asBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('That file could not be read'))
    reader.readAsDataURL(blob)
  })
}

/**
 * One file into storage, two ways (8 Nov 2026: "portal feedback not uploading
 * attachments"). Straight to Blob storage first; if that is stopped — a
 * hospital network, an old phone — through the portal's own server. The reason
 * is kept, so a failure says what happened instead of "check the signal".
 */
export async function uploadFile(f, token, { direct = upload, fetcher = fetch, onProgress, timeoutMs } = {}) {
  // Never wait for ever (Toni, 9 Nov 2026: "still stalling when trying to
  // upload attachments"). The direct upload had no limit, so on a poor
  // connection it could sit there indefinitely and the second route was never
  // tried. Now it is given a time that grows with the file, then abandoned.
  const limit = timeoutMs ?? directTimeout(f.size)
  let first = ''
  try {
    const result = await withTimeout(signal => direct(`chat/${Date.now()}-${f.name}`, f.blob, {
      access: 'public', contentType: f.type, handleUploadUrl: '/api/chat?action=blob-upload',
      clientPayload: JSON.stringify({ token: token || null }),
      abortSignal: signal,
      onUploadProgress: e => onProgress?.(Math.round(e?.percentage ?? 0))
    }), limit, 'it took too long')
    return result.url
  } catch (err) {
    first = err?.message || 'upload refused'
  }
  if (f.size > DIRECT_MAX) throw new Error(`${f.name} did not upload (${first}). Files over 3 MB need a better connection — try again on wifi.`)
  onProgress?.(null)
  const body = JSON.stringify({ name: f.name, type: f.type, data: await asBase64(f.blob) })
  const res = await withTimeout(signal => fetcher('/api/chat?action=upload', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body
  }), FALLBACK_TIMEOUT_MS, 'the connection is too slow')
    .catch(err => { throw new Error(`${f.name} did not upload (${first}; then ${err.message}). Try again on a better connection.`) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(`${f.name} did not upload (${data.error || first}). Try again.`)
  return data.url
}

const FALLBACK_TIMEOUT_MS = 45000

/** How long the direct upload gets: 25s, plus 15s a megabyte, at most 3 minutes. */
export function directTimeout(bytes) {
  return Math.min(180000, 25000 + Math.ceil((bytes || 0) / (1024 * 1024)) * 15000)
}

/** Runs `start(signal)`, aborting it and rejecting with `why` after `ms`. */
function withTimeout(start, ms, why) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  let timer
  return Promise.race([
    Promise.resolve().then(() => start(ctrl?.signal)),
    new Promise((_, reject) => { timer = setTimeout(() => { ctrl?.abort(); reject(new Error(why)) }, ms) })
  ]).finally(() => clearTimeout(timer))
}

function Composer({ onSend, onTyping, sending, user, replyTo, onCancelReply, incoming }) {
  const [draft, setDraft] = useState('')
  const [override, setOverride] = useState(false)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState('')
  const picker = useRef(null)
  const lastTyping = useRef(0)
  const warning = chatWarning(draft)

  // Files dropped on the conversation arrive here.
  useEffect(() => { if (incoming?.files?.length) choose(incoming.files) }, [incoming]) // eslint-disable-line react-hooks/exhaustive-deps

  // A screenshot pasted into the message box, as WhatsApp Desktop takes it.
  function paste(e) {
    const files = [...(e.clipboardData?.files || [])]
    if (!files.length) return
    e.preventDefault()
    choose(files)
  }

  async function choose(list) {
    const picked = [...(list || [])].slice(0, 10)
    if (!picked.length) return
    setBusy('reading')
    try {
      const ready = []
      for (const f of picked) ready.push(await prepare(f))
      setFiles(now => [...now, ...ready].slice(0, 10))
    } catch (err) {
      setBusy(err.message || 'That file could not be read')
      return
    }
    setBusy('')
  }

  function drop(i) {
    setFiles(now => {
      if (now[i]?.preview) URL.revokeObjectURL(now[i].preview)
      return now.filter((_, n) => n !== i)
    })
  }

  async function submit() {
    const body = draft.trim()
    if ((!body && !files.length) || sending || busy === 'reading') return
    if (warning && !override) { setOverride(true); return }

    const uploaded = []
    if (files.length) {
      setBusy('sending')
      try {
        for (const [n, f] of files.entries()) {
          const label = files.length > 1 ? `Sending ${n + 1} of ${files.length}` : 'Sending'
          setProgress(`${label}…`)
          const url = await uploadFile(f, user?.token, {
            onProgress: pct => setProgress(pct == null ? `${label} — trying another way…` : `${label} · ${pct}%`)
          })
          uploaded.push({ url, type: f.type, name: f.name, size: f.size, width: f.width, height: f.height })
        }
      } catch (err) {
        setProgress('')
        setBusy(err.message || 'That did not send — try again')
        return
      }
      setProgress('')
      setBusy('')
    }

    onSend(body, Boolean(warning), uploaded)
    setDraft('')
    files.forEach(f => f.preview && URL.revokeObjectURL(f.preview))
    setFiles([])
    setOverride(false)
  }

  const blocked = sending || busy === 'reading' || busy === 'sending'
  const nothing = !draft.trim() && !files.length

  return (
    <div data-composer style={{
      borderTop: `1px solid ${colour.line}`, background: colour.canvas,
      padding: `${space.sm}px ${space.sm}px calc(${space.sm}px + env(safe-area-inset-bottom, 0px))`
    }}>
      {replyTo && (
        <div data-replying style={{
          display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.xs,
          borderLeft: `3px solid ${colour.accent}`, background: colour.lineSoft, borderRadius: 4, padding: `2px ${space.sm}px`
        }}>
          <span style={{ ...text('caption'), color: colour.inkMuted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Replying to <strong style={{ color: colour.ink }}>{replyTo.authorName}</strong> {replyTo.text || (replyTo.files?.[0]?.name) || ''}
          </span>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" style={{ ...actionStyle, padding: 2 }}>✕</button>
        </div>
      )}

      {warning && (
        <div style={{
          ...text('caption'), color: colour.ink, background: colour.warningSoft,
          border: `1px solid ${colour.warningLine}`, borderRadius: radius.control,
          padding: space.sm, marginBottom: space.xs
        }}>
          ⚠ {warning}
          {override && <span style={{ display: 'block', marginTop: 2, color: colour.inkMuted }}>Send again to post it as written.</span>}
        </div>
      )}

      {progress && (
        <div data-upload-progress style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.xs }}>{progress}</div>
      )}
      {busy && busy !== 'reading' && busy !== 'sending' && (
        <div style={{ ...text('caption'), color: colour.danger, marginBottom: space.xs }}>{busy}</div>
      )}

      {files.length > 0 && (
        <div style={{ display: 'flex', gap: space.sm, overflowX: 'auto', marginBottom: space.xs, paddingTop: 8 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
              border: `1px solid ${colour.line}`, borderRadius: radius.control, padding: 4, background: colour.canvas }}>
              {f.preview
                ? <img src={f.preview} alt="" style={{ display: 'block', height: 56, borderRadius: 6 }} />
                : <span style={{ ...text('caption'), color: colour.ink, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📎 {f.name}</span>}
              <button type="button" onClick={() => drop(i)} aria-label={`Remove ${f.name}`}
                style={{ ...actionStyle, padding: 2, color: colour.inkMuted }}>✕</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: space.sm, alignItems: 'flex-end' }}>
        <input ref={picker} type="file" multiple accept={ACCEPT} aria-label="Attach photos or files"
          style={{ fontSize: 16, display: 'none' }}
          onChange={e => { choose(e.target.files); e.target.value = '' }} />
        <button type="button" onClick={() => picker.current?.click()}
          aria-label="Attach photos or files" disabled={blocked}
          style={{
            width: 42, height: 42, flexShrink: 0, borderRadius: '50%',
            border: 'none', background: 'transparent',
            cursor: blocked ? 'default' : 'pointer', color: colour.inkMuted, padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
          {busy === 'reading' ? '…' : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9" />
            </svg>
          )}
        </button>

        <textarea
          value={draft}
          onChange={e => {
            setDraft(e.target.value); setOverride(false)
            const now = Date.now()
            if (e.target.value && now - lastTyping.current > TYPING_EVERY_MS) { lastTyping.current = now; onTyping() }
          }}
          onPaste={paste}
          onKeyDown={e => {
            // Enter sends, Shift+Enter makes a line. On a phone the on-screen
            // return key inserts a line, which is what anyone expects there.
            if (e.key === 'Enter' && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder={files.length ? 'Add a caption (optional)' : 'Message'}
          aria-label="Message"
          style={{
            flex: 1, resize: 'none', minHeight: 42, maxHeight: 140,
            padding: `10px ${space.lg}px`, boxSizing: 'border-box',
            border: `1px solid ${colour.line}`, borderRadius: 21,
            ...text('field'), fontFamily: 'inherit',
            color: colour.ink, background: colour.surface, outline: 'none'
          }} />
        <button onClick={submit} disabled={nothing || blocked}
          aria-label={warning && !override ? 'Check' : 'Send'}
          style={{
            width: 42, height: 42, flexShrink: 0, borderRadius: '50%',
            border: 'none', color: 'white', padding: 0,
            background: (nothing || blocked) ? colour.inkFainter : warning && !override ? colour.warning : colour.accent,
            cursor: (nothing || blocked) ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
          {busy === 'sending' || sending ? '…' : warning && !override ? <span style={text('heading')}>!</span> : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3.4 20.4l17.4-7.5a1 1 0 000-1.8L3.4 3.6a1 1 0 00-1.4 1.1L3.9 11l9.1 1-9.1 1-1.9 6.3a1 1 0 001.4 1.1z" />
            </svg>
          )}
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
      text: `To get messages on your phone, install this app first. ${installHint()}`,
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
      // Two different situations wore the same sentence. A browser that has no
      // push at all is a dead end and should say so; the same browser running
      // a shortcut rather than the installed app is one step from working, and
      // telling that person "this device cannot show notifications" is both
      // discouraging and untrue.
      text: installed()
        ? 'This device cannot show notifications. Messages will still be here '
          + 'when you open the app.'
        : `This browser cannot show notifications here. ${installHint()}`,
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
export function ChannelView({ channel, title, subtitle, user, onBack, focus, icon, onIcon }) {
  const [messages, setMessages] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [typing, setTyping] = useState([])
  const [seenBy, setSeenBy] = useState({})
  const [total, setTotal] = useState(0)
  const [openId, setOpenId] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [incoming, setIncoming] = useState(null)
  const [dragging, setDragging] = useState(false)
  const foot = useRef(null)
  const lastCount = useRef(0)
  const today = new Date().toISOString().slice(0, 10)

  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}
  const post = (action, body) => fetch(`/api/chat?action=${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(body)
  }).then(r => r.json())

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?channel=${encodeURIComponent(channel)}`, { headers: auth })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not read the channel')
      // Messages still on their way keep their place until the server has them.
      setMessages(list => [...(data.messages || []), ...(list || []).filter(m => m.pending)])
      setTyping(data.typing || [])
      setSeenBy(data.seenBy || {})
      setTotal(data.total || 0)
      setError('')
    } catch (err) {
      setError(err.message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, user?.token])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    // Only while somebody is looking. A tab left open in a back pocket should
    // not poll all night; push notifications cover the rest.
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('online', tick)
    }
  }, [load])

  useEffect(() => {
    // Only when something new arrives — not on every poll, which would tug the
    // page away from somebody reading further up.
    const count = messages?.length || 0
    if (count === lastCount.current) return
    lastCount.current = count
    const target = focus ? document.querySelector(`[data-message="${focus}"]`) : null
    const end = target || foot.current
    if (typeof end?.scrollIntoView === 'function') end.scrollIntoView({ block: target ? 'center' : 'end' })
  }, [messages?.length, focus])

  async function send(body, warned, files) {
    setSending(true)
    // Shown straight away. A message that takes a round trip to appear feels
    // broken on a hospital connection, and the poll will reconcile it.
    const pending = {
      id: `pending_${Date.now()}`, authorName: 'You', author: user?.email, pending: true,
      text: body, files, replyTo: replyTo ? { authorName: replyTo.authorName, text: replyTo.text } : null,
      at: new Date().toISOString()
    }
    setMessages(list => [...(list || []), pending])
    const answering = replyTo?.id || null
    setReplyTo(null)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ channel, text: body, warned, files, replyTo: answering })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'That did not send')
      setMessages(list => (list || []).filter(m => m.id !== pending.id))
      await load()
    } catch (err) {
      setError(err.message)
      setMessages(list => (list || []).filter(m => m.id !== pending.id))
    }
    setSending(false)
  }

  async function react(id, emoji) {
    setOpenId(null)
    const data = await post('react', { id, emoji }).catch(() => null)
    if (data?.message) setMessages(list => (list || []).map(m => (m.id === id ? data.message : m)))
  }

  async function remove(id) {
    setOpenId(null)
    if (!window.confirm('Delete this message for everyone?')) return
    const data = await post('delete', { id }).catch(() => null)
    if (data?.message) setMessages(list => (list || []).map(m => (m.id === id ? data.message : m)))
    else if (data?.error) setError(data.error)
  }

  // "Seen by": everyone whose read mark is at or past my latest message.
  const myLast = [...(messages || [])].reverse().find(m => m.author === user?.email && !m.pending)
  const seen = myLast ? Object.entries(seenBy).filter(([, n]) => n >= (myLast.seq || total)).map(([name]) => name) : []

  let lastDay = null
  let lastAuthor = null

  return (
    <Page style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div data-drop-zone style={{ display: 'contents' }}
        onDragOver={e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }}
        onDrop={e => { const files = [...(e.dataTransfer?.files || [])]; setDragging(false); if (files.length) { e.preventDefault(); setIncoming({ files }) } }}>
      <Header eyebrow="Team" title={title}
        subtitle={subtitle}
        onBack={onBack} compact
        right={icon ? (
          <button type="button" onClick={onIcon} disabled={!onIcon} aria-label={onIcon ? `Change the icon for ${title}` : title}
            style={{ border: 'none', background: 'none', padding: 0, cursor: onIcon ? 'pointer' : 'default', flexShrink: 0 }}>
            <ChatAvatar icon={icon} name={title} size={40} />
          </button>
        ) : null} />

      <div data-chat-wall style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: `${space.sm}px ${space.md}px ${space.md}px`, minHeight: 0,
        backgroundColor: colour.canvas,
        backgroundImage: `radial-gradient(${colour.line} 1px, transparent 1.2px)`, backgroundSize: '18px 18px'
      }}>
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
          const runOn = !newDay && message.author === lastAuthor && !message.replyTo
          lastDay = day
          lastAuthor = message.author
          const mine = message.author === user?.email
          return (
            <div key={message.id}>
              {newDay && (
                <div style={{ textAlign: 'center', margin: `${space.md}px 0 ${space.xs}px` }}>
                  <span style={{
                    ...text('micro'), textTransform: 'uppercase', color: colour.inkMuted, background: colour.surface,
                    border: `1px solid ${colour.line}`, borderRadius: radius.pill, padding: '3px 10px'
                  }}>{day}</span>
                </div>
              )}
              <Message message={message} mine={mine} runOn={runOn}
                mentionsMe={!mine && (message.mentions || []).includes(user?.email)}
                open={openId === message.id}
                onToggle={() => setOpenId(id => (id === message.id ? null : message.id))}
                onReact={emoji => react(message.id, emoji)}
                onReply={() => { setReplyTo(message); setOpenId(null) }}
                onDelete={() => remove(message.id)}
                seenAll={mine && message.id === myLast?.id && seen.length > 0} />
              {myLast && message.id === myLast.id && seen.length > 0 && (
                <div data-seen-by style={{ ...text('micro'), color: colour.inkFainter, textAlign: 'right' }}>
                  ✓✓ Seen by {seen.join(', ')}
                </div>
              )}
            </div>
          )
        })}
        {typing.length > 0 && (
          <div data-typing style={{
            ...text('caption'), color: colour.inkFaint, fontStyle: 'italic', marginTop: space.sm,
            background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: '3px 12px 12px 12px',
            padding: '6px 10px', width: 'fit-content'
          }}>
            {typing.join(', ')} {typing.length === 1 ? 'is' : 'are'} typing…
          </div>
        )}
        <div ref={foot} />
      </div>

      {dragging && (
        <div style={{ ...text('bodyStrong'), textAlign: 'center', padding: space.sm, background: colour.accentSoft, color: colour.accentDeep, borderTop: `1px dashed ${colour.accent}` }}>
          Drop to attach
        </div>
      )}
      <Composer onSend={send} sending={sending} user={user} incoming={incoming}
        onTyping={() => post('typing', { channel }).catch(() => {})}
        replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
    </div>
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

/** Search across every channel. */
function ChatSearch({ user, onOpen }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState(null)
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setFound(null); return undefined }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat?action=search&q=${encodeURIComponent(term)}`,
          { headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {} })
        const data = await res.json()
        setFound(data.results || [])
      } catch { setFound([]) }
    }, 300)
    return () => clearTimeout(timer)
  }, [q, user?.token])

  return (
    <div style={{ marginBottom: space.md }}>
      <input type="search" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search messages, people and files" aria-label="Search messages"
        style={{
          width: '100%', boxSizing: 'border-box', padding: `${space.sm}px ${space.md}px`,
          border: `1px solid ${colour.line}`, borderRadius: radius.pill, background: colour.surface,
          ...text('field'), color: colour.ink, outline: 'none'
        }} />
      {found && (
        <div style={{ marginTop: space.sm }}>
          {!found.length && <div style={{ ...text('caption'), color: colour.inkFaint }}>No messages found.</div>}
          {found.map(m => (
            <button key={m.id} type="button" data-chat-result onClick={() => onOpen(m)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.control,
                padding: `${space.sm}px ${space.md}px`, marginBottom: space.xs
              }}>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>
                # {m.channelName} · {m.authorName} · {String(m.at).slice(0, 10)}
              </div>
              <div style={{ ...text('body'), color: colour.ink, overflowWrap: 'anywhere' }}>
                {m.text || (m.files || []).map(f => `📎 ${f.name}`).join(' ') || (m.photo ? '📷 Photo' : '')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The channel list. */
export default function Chat({ user, onBack, onRead }) {
  const [overview, setOverview] = useState(null)
  const [open, setOpen] = useState(null)
  const [choosing, setChoosing] = useState(null)

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
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !open) load() }, 10000)
    return () => clearInterval(timer)
  }, [load, open])

  if (open) {
    return (
      <>
        <ChannelView
          channel={open.id}
          title={open.name}
          subtitle={open.detail}
          focus={open.focus}
          icon={open.icon || { emoji: '💬' }}
          onIcon={() => setChoosing(open)}
          user={user}
          onBack={() => { setOpen(null); load(); onRead?.() }} />
        {choosing && (
          <IconSheet channel={choosing} user={user} onClose={() => setChoosing(null)}
            onSaved={icon => { setOpen(o => (o ? { ...o, icon } : o)); load() }} />
        )}
      </>
    )
  }

  const channels = overview?.channels
    || [{ id: 'general', name: 'General', detail: 'Anything that is not the others' }]

  return (
    <Page>
      <Header eyebrow="Team" title="Messages" subtitle="The group, where the bookings are" onBack={onBack} />
      <Body>
        <Notifications user={user} />
        <ChatSearch user={user} onOpen={m => {
          const ch = channels.find(c => c.id === m.channel)
          setOpen({ id: m.channel, name: ch?.name || m.channelName, detail: ch?.detail || '', focus: m.id })
        }} />

        <SectionLabel>Channels</SectionLabel>
        <div data-chat-list style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, overflow: 'hidden' }}>
          {channels.map((channel, i) => (
            <div key={channel.id} style={{ display: 'flex', alignItems: 'center', gap: space.md, padding: `${space.sm + 2}px ${space.md}px`, borderTop: i ? `1px solid ${colour.lineSoft}` : 'none' }}>
              <button type="button" onClick={() => setChoosing(channel)} aria-label={`Change the icon for ${channel.name}`}
                style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
                <ChatAvatar icon={channel.icon} name={channel.name} />
              </button>
              <button type="button" onClick={() => setOpen(channel)} data-channel={channel.id}
                style={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: space.sm }}>
                  <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {channel.name}
                  </span>
                  {channel.last?.at && (
                    <span style={{ ...text('caption'), color: channel.unread > 0 ? colour.accent : colour.inkFainter, flexShrink: 0, fontWeight: channel.unread > 0 ? 700 : 400 }}>
                      {listTime(channel.last.at)}
                    </span>
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginTop: 1 }}>
                  <span style={{ ...text('caption'), color: colour.inkFaint, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {channel.last
                      ? <>{channel.last.author === user?.email ? <span style={{ color: colour.accent }}>✓✓ </span> : <strong style={{ fontWeight: 600 }}>{channel.last.authorName}: </strong>}{channel.last.text}</>
                      : channel.detail}
                  </span>
                  {channel.unread > 0 && (
                    <span style={{
                      ...text('micro'), fontWeight: 700, flexShrink: 0, minWidth: 20, textAlign: 'center',
                      background: colour.accent, color: 'white', borderRadius: radius.pill, padding: '2px 6px'
                    }}>{channel.unread}</span>
                  )}
                </span>
              </button>
            </div>
          ))}
        </div>

        <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: space.md }}>
          Tap a chat's icon to change it. Every booking has its own thread as
          well — open a case and look for the messages at the foot of it.
        </div>
      </Body>
      {choosing && (
        <IconSheet channel={choosing} user={user} onClose={() => setChoosing(null)} onSaved={() => load()} />
      )}
    </Page>
  )
}
