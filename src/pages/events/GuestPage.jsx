import React, { useEffect, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { whenText, answerText, REPLY_LABEL } from '../../events/model.js'

// ─── A guest's own invitation (Events, 25 Nov 2026) ─────────────────────────
// Opened from /e/{token} with no login: the invite, the details, Yes / Maybe /
// Can't make it, the event's own questions, then a confirmation they can come
// back to and change. ?stop=1 is the unsubscribe link from the email.

const api = (what, token, init) => fetch(`/api/guides?rsvp=${what}&t=${encodeURIComponent(token)}`, init)
  .then(async r => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))

export function guestTokenFromPath(path = (typeof location !== 'undefined' ? location.pathname : '')) {
  const m = /^\/e\/([\w-]{16,40})\/?$/.exec(path)
  return m ? m[1] : null
}

const chip = on => ({
  borderRadius: radius.pill, padding: '8px 13px', cursor: 'pointer', ...text('bodyStrong'),
  border: on ? `2px solid ${colour.accent}` : `1px solid ${colour.line}`,
  background: on ? colour.accentSoft : colour.surface, color: on ? colour.accentDeep : colour.ink
})
const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: radius.control, border: `1px solid ${colour.line}`, ...text('field'), background: colour.surface, color: colour.ink }
const label = { ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', display: 'block', marginBottom: 6 }

function Question({ q, value, onChange }) {
  if (q.type === 'chips') {
    const picked = value || []
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {q.options.map(o => {
          const on = picked.includes(o)
          return <button key={o} type="button" aria-pressed={on} style={chip(on)}
            onClick={() => onChange(on ? picked.filter(p => p !== o) : [...picked.filter(p => p !== 'None' || o === 'None'), o].filter(p => o !== 'None' || p === 'None'))}>{o}</button>
        })}
      </div>
    )
  }
  if (q.type === 'one') {
    const pick = typeof value === 'object' && value ? value.pick : value
    const note = typeof value === 'object' && value ? value.note : ''
    return (
      <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {q.options.map(o => <button key={o} type="button" aria-pressed={pick === o} style={chip(pick === o)}
            onClick={() => onChange(q.note ? { pick: o, note } : o)}>{o}</button>)}
        </div>
        {q.note && pick && (
          <input aria-label={`${q.label}: anything else`} placeholder="Size, milk, sugar…" value={note || ''}
            onChange={e => onChange({ pick, note: e.target.value })} style={{ ...field, marginTop: 8 }} />
        )}
      </>
    )
  }
  if (q.type === 'plus') {
    const v = value || { coming: false }
    return (
      <>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" aria-pressed={v.coming} style={chip(v.coming)} onClick={() => onChange({ ...v, coming: true })}>Yes</button>
          <button type="button" aria-pressed={!v.coming} style={chip(!v.coming)} onClick={() => onChange({ coming: false })}>No</button>
        </div>
        {v.coming && (
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <input aria-label="Their name" placeholder="Their name" value={v.name || ''} onChange={e => onChange({ ...v, name: e.target.value })} style={field} />
            <input aria-label="Their dietary needs" placeholder="Their dietary needs (if any)" value={v.diet || ''} onChange={e => onChange({ ...v, diet: e.target.value })} style={field} />
          </div>
        )}
      </>
    )
  }
  if (q.type === 'time') return <input type="time" aria-label={q.label} value={value || ''} onChange={e => onChange(e.target.value)} style={field} />
  return <textarea aria-label={q.label} placeholder={q.hint || ''} rows={2} value={value || ''} onChange={e => onChange(e.target.value)} style={{ ...field, resize: 'vertical' }} />
}

export default function GuestPage({ token }) {
  const [view, setView] = useState(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState('invite')
  const [status, setStatus] = useState(null)
  const [answers, setAnswers] = useState({})
  const [busy, setBusy] = useState(false)
  const stopAsked = typeof location !== 'undefined' && /[?&]stop=1/.test(location.search)
  const [stopped, setStopped] = useState(false)

  useEffect(() => {
    api('view', token).then(({ ok, data }) => {
      if (!ok) { setError(data.error || 'This invitation could not be opened.'); return }
      setView(data)
      setAnswers(data.guest.answers || {})
      if (['yes', 'maybe', 'no', 'waitlist'].includes(data.guest.status)) { setStatus(data.guest.status === 'waitlist' ? 'yes' : data.guest.status); setStep('done') }
    }).catch(() => setError('No connection — try again in a moment.'))
  }, [token])

  async function send() {
    setBusy(true); setError('')
    try {
      const { ok, data } = await api('reply', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, answers }) })
      if (!ok) throw new Error(data.error || 'Your reply did not save.')
      setView(data); setStep('done')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function stop() {
    setBusy(true)
    const { ok } = await api('stop', token, { method: 'POST' }).catch(() => ({ ok: false }))
    setBusy(false); if (ok) setStopped(true); else setError('That did not go through — try again.')
  }

  const shell = children => (
    <div data-guest-page style={{ minHeight: '100dvh', background: colour.canvas, color: colour.ink, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ background: colour.surface, borderBottom: `1px solid ${colour.line}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src="/logo-mark.png" alt="" width="26" height="26" style={{ borderRadius: 6 }} />
        <span style={{ ...text('bodyStrong'), color: colour.navy }}>TechnoMed Events</span>
        {view && <span style={{ marginLeft: 'auto', ...text('caption'), color: colour.inkFaint }}>For {view.guest.name}</span>}
      </div>
      <main style={{ maxWidth: 520, margin: '0 auto', padding: space.lg, display: 'flex', flexDirection: 'column', gap: space.md }}>{children}</main>
    </div>
  )

  if (error && !view) return shell(<div role="alert" style={{ ...text('body'), padding: space.xl, textAlign: 'center' }}>{error}</div>)
  if (!view) return shell(<div style={{ ...text('body'), color: colour.inkFaint, padding: space.xl, textAlign: 'center' }}>Opening your invitation…</div>)
  const { event, guest } = view

  if (stopAsked) {
    return shell(
      <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.lg, display: 'grid', gap: space.md }}>
        <div style={{ ...text('title') }}>{stopped ? 'Done — no more event invitations' : 'Stop TechnoMed event invitations?'}</div>
        <div style={{ ...text('body'), color: colour.inkMuted }}>{stopped ? "You won't be sent invitations by email or text again. Tell us if you change your mind." : 'We will stop sending you invitations to TechnoMed events by email and text.'}</div>
        {!stopped && <button type="button" disabled={busy} onClick={stop} style={{ ...chip(true), padding: 14, textAlign: 'center' }}>Yes, stop them</button>}
      </div>
    )
  }

  const details = [
    ['When', whenText(event.start)],
    ['Where', [event.venue, event.address].filter(Boolean).join(', ')],
    ['Dress', event.dress],
    ['Reply by', event.replyBy ? whenText(event.replyBy).split(' · ')[0] : '']
  ].filter(r => r[1])

  const top = (
    <>
      {event.invite?.kind === 'image' ? (
        <img data-invite-image src={`/api/guides?rsvp=invite&t=${encodeURIComponent(token)}`} alt={`Invitation: ${event.title}`}
          style={{ width: '100%', borderRadius: 18, display: 'block', boxShadow: '0 8px 24px rgba(4,39,70,0.18)' }} />
      ) : (
        <div style={{ borderRadius: 18, padding: '36px 20px', textAlign: 'center', color: 'white', background: `linear-gradient(160deg, ${colour.navySoft}, ${colour.navy} 55%, ${colour.navyDeep})` }}>
          <div style={{ ...text('micro'), color: '#7fd8c8' }}>TECHNOMED INVITES YOU TO</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 30, lineHeight: 1.15, fontWeight: 700, margin: '10px 0' }}>{event.title}</div>
          <div style={{ ...text('bodyStrong') }}>{whenText(event.start)}</div>
          {event.venue && <div style={{ ...text('caption'), opacity: 0.8 }}>{event.venue}</div>}
          {event.invite?.kind === 'pdf' && <a href={`/api/guides?rsvp=invite&t=${encodeURIComponent(token)}`} style={{ display: 'inline-block', marginTop: 12, color: '#7fd8c8', ...text('bodyStrong') }}>Open the invitation (PDF)</a>}
        </div>
      )}
      <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: '12px 14px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px' }}>
        {details.map(([k, v]) => (
          <React.Fragment key={k}>
            <span style={{ ...text('micro'), color: colour.inkFaint, paddingTop: 3 }}>{k.toUpperCase()}</span>
            <span style={{ ...text('body') }}>{v}{k === 'Where' && event.mapUrl && <> · <a href={event.mapUrl}>Map</a></>}</span>
          </React.Fragment>
        ))}
      </div>
      {event.details && <div style={{ ...text('body'), whiteSpace: 'pre-line', color: colour.inkMuted }}>{event.details}</div>}
    </>
  )

  if (step === 'done') {
    const s = guest.status
    const heading = s === 'yes' ? `See you there, ${guest.name.split(' ')[0] === 'Dr' ? guest.name : guest.name.split(' ')[0]}`
      : s === 'waitlist' ? "You're on the waitlist" : s === 'maybe' ? 'Thanks — marked as maybe' : 'Thanks for letting us know'
    const said = event.form.map(q => [q.label, answerText(q, guest.answers?.[q.id])]).filter(r => r[1])
    return shell(
      <>
        <div data-guest-done style={{ textAlign: 'center', display: 'grid', gap: 6, padding: `${space.md}px 0` }}>
          <div style={{ ...text('title') }}>{heading}</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>{event.title} · {whenText(event.start)}</div>
          {s === 'waitlist' && <div style={{ ...text('body'), color: colour.warning }}>The event is full. We'll let you know if a place comes up.</div>}
        </div>
        {said.length > 0 && (
          <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: '12px 14px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px' }}>
            <span style={{ ...text('micro'), color: colour.inkFaint, paddingTop: 3 }}>REPLY</span><span>{REPLY_LABEL[s]}</span>
            {said.map(([k, v]) => <React.Fragment key={k}><span style={{ ...text('micro'), color: colour.inkFaint, paddingTop: 3 }}>{k.toUpperCase()}</span><span>{v}</span></React.Fragment>)}
          </div>
        )}
        {top}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(s === 'yes' || s === 'maybe') && <a href={`/api/guides?rsvp=ics&t=${encodeURIComponent(token)}`} style={{ textAlign: 'center', textDecoration: 'none', background: colour.navy, color: 'white', borderRadius: 12, padding: 13, ...text('bodyStrong') }}>Add to calendar</a>}
          {event.open && <button type="button" data-change-reply onClick={() => setStep('reply')} style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: 12, padding: 12, ...text('bodyStrong'), cursor: 'pointer', gridColumn: s === 'yes' || s === 'maybe' ? 'auto' : '1 / -1' }}>Change my reply</button>}
        </div>
        <div style={{ textAlign: 'center', ...text('caption'), color: colour.inkFaint }}>{event.hostLine}</div>
      </>
    )
  }

  if (step === 'reply') {
    return shell(
      <>
        <div style={{ ...text('title') }}>{event.title}</div>
        <div>
          <span style={label}>Your reply</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            {['yes', 'maybe', 'no'].map(s => <button key={s} type="button" data-reply={s} aria-pressed={status === s} style={{ ...chip(status === s), borderRadius: 12, padding: '11px 4px' }} onClick={() => setStatus(s)}>{REPLY_LABEL[s]}</button>)}
          </div>
        </div>
        {status !== 'no' && event.form.map(q => (
          <div key={q.id} data-question={q.id}>
            <span style={label}>{q.label}</span>
            <Question q={q} value={answers[q.id]} onChange={v => setAnswers(a => ({ ...a, [q.id]: v }))} />
          </div>
        ))}
        {error && <div role="alert" style={{ color: colour.danger, ...text('body') }}>{error}</div>}
        <button type="button" data-send-reply disabled={busy || !status} onClick={send}
          style={{ background: colour.accent, color: 'white', border: 'none', borderRadius: 14, padding: 15, ...text('heading'), cursor: 'pointer', opacity: busy || !status ? 0.6 : 1 }}>
          {busy ? 'Saving…' : 'Send my reply'}
        </button>
      </>
    )
  }

  return shell(
    <>
      {top}
      {event.placesLeft != null && event.open && <div style={{ ...text('caption'), color: colour.warning }}>{event.placesLeft > 0 ? `${event.placesLeft} places left` : 'Full — reply to join the waitlist'}</div>}
      {event.open ? (
        <>
          <div style={{ ...text('heading') }}>Can you come?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            {['yes', 'maybe', 'no'].map(s => (
              <button key={s} type="button" data-start-reply={s} onClick={() => { setStatus(s); setStep('reply') }}
                style={{ borderRadius: 12, padding: '13px 4px', cursor: 'pointer', ...text('bodyStrong'), border: s === 'yes' ? 'none' : `1px solid ${colour.line}`, background: s === 'yes' ? colour.accent : colour.surface, color: s === 'yes' ? 'white' : colour.ink }}>
                {REPLY_LABEL[s]}
              </button>
            ))}
          </div>
        </>
      ) : <div style={{ ...text('body'), color: colour.inkFaint }}>Replies have closed for this event.</div>}
      <div style={{ textAlign: 'center', ...text('caption'), color: colour.inkFaint }}>{event.hostLine} · <a href={`/e/${token}?stop=1`} style={{ color: colour.inkFaint }}>Stop event invites</a></div>
    </>
  )
}
