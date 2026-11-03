import React, { useEffect, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'

// ─── The loan set, and the emails behind it ───────────────────────────────────
// "Click on a booking in the portal that has a distributor loan set booked and
// it automatically shows you the information pertaining to the loan set that
// has been arranged including extracted data from the email trail that
// requested it." — Brent, 3 Nov 2026.
//
// Loads on its own when the booking opens. Each distributor's set gets where it
// stands (from a summary of the emails), the facts those emails state, the
// emails themselves, and any attachments — a tray list usually — one tap away.
// See api/_loanTrail.js for where it looks.

const STATUS = {
  confirmed: { label: 'Confirmed', bg: colour.successSoft, ink: colour.accentDeep },
  requested: { label: 'Requested — no reply yet', bg: colour.warningSoft, ink: colour.warning },
  changed: { label: 'Changed', bg: colour.warningSoft, ink: colour.warning },
  cancelled: { label: 'Cancelled', bg: colour.lineSoft, ink: colour.inkMuted },
}

// What a phone can show in a tab. Anything else is downloaded instead: opening
// it in a tab gave a blank page ("some of the link buttons just take you to a
// blank page").
const viewable = att => /^(application\/pdf|image\/)/i.test(att.mediaType || '')
  || /\.(pdf|jpe?g|png|gif|webp|heic)$/i.test(att.filename || '')

function when(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Hobart' })
}

function kb(bytes) {
  if (!bytes) return ''
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function LoanTrail({ eventId, user }) {
  const [state, setState] = useState({ loading: true, sets: [], error: '' })
  const [openEmail, setOpenEmail] = useState(null)
  // Folded away until asked for: "it's a little bit busy". The status, the
  // summary and the facts are what a glance needs; the emails are the evidence.
  const [showEmails, setShowEmails] = useState({})
  const [openSets, setOpenSets] = useState({})

  useEffect(() => {
    if (!eventId) return undefined
    let live = true
    setState({ loading: true, sets: [], error: '' })
    fetch(`/api/calendar/today?action=loantrail&id=${encodeURIComponent(eventId)}`, {
      headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) setState({ loading: false, sets: [], error: data.error || 'The loan set emails could not be read just now.' })
        else setState({ loading: false, sets: data.sets || [], error: '' })
      })
      .catch(() => { if (live) setState({ loading: false, sets: [], error: 'No connection — the loan set emails will show once you are back online.' }) })
    return () => { live = false }
  }, [eventId, user?.token])

  // Opened in a new view: the window is made on the tap itself, because a
  // phone will not let a page open one after waiting for a download.
  async function openAttachment(att) {
    if (!viewable(att)) return downloadAttachment(att)
    const view = window.open('', '_blank')
    try {
      const res = await fetch(`/api/calendar/today?action=loanattachment&t=${encodeURIComponent(att.token)}`, {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not open it')
      const url = URL.createObjectURL(await res.blob())
      if (view) view.location.href = url
      else window.location.assign(url)
    } catch (err) {
      view?.close()
      window.alert(err.message || 'That attachment could not be opened.')
    }
  }

  async function downloadAttachment(att) {
    try {
      const res = await fetch(`/api/calendar/today?action=loanattachment&t=${encodeURIComponent(att.token)}`, {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not download it')
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = att.filename || 'attachment'
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (err) {
      window.alert(err.message || 'That attachment could not be downloaded.')
    }
  }

  if (state.loading) {
    return (
      <div style={box}>
        <div style={{ ...text('caption'), color: colour.inkFaint }}>
          <span style={{ ...heading, display: 'inline', marginRight: space.sm }}>Loan set</span>
          Reading the emails…
        </div>
      </div>
    )
  }
  if (state.error) {
    return (
      <div style={box}>
        <div style={heading}>Loan set</div>
        <div style={{ ...text('caption'), color: colour.inkMuted }}>{state.error}</div>
      </div>
    )
  }
  if (!state.sets.length) return null

  return (
    <>
      {state.sets.map(set => {
        // A status only when there is one to state — "See emails" looked like
        // a button and did nothing.
        const look = STATUS[set.summary?.status] || null
        const emailsOpen = Boolean(showEmails[set.distributor])
        const isOpen = Boolean(openSets[set.distributor])
        return (
          <div key={set.distributor} style={box} data-loan-set={set.distributor}>
            {/* One line until tapped, like the rest of the booking: the set,
                the supplier and where it stands. */}
            <button type="button" aria-expanded={isOpen}
              onClick={() => setOpenSets(v => ({ ...v, [set.distributor]: !isOpen }))}
              style={{ display: 'flex', alignItems: 'center', gap: space.sm, width: '100%', minHeight: 32, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ ...heading, marginBottom: 0, flexShrink: 0, minWidth: 74 }}>Loan set</span>
              <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {set.systems.join(' + ')} · {set.name.split(/[\s/]/)[0]}
              </span>
              {look && (
                <span style={{ ...text('caption'), fontWeight: 700, color: look.ink, background: look.bg, padding: '2px 8px', borderRadius: radius.pill, flexShrink: 0 }}>
                  {look.label}
                </span>
              )}
              <span aria-hidden="true" style={{ ...text('caption'), fontWeight: 600, color: colour.accentDeep, flexShrink: 0 }}>
                {isOpen ? 'Done' : 'Details'}
              </span>
            </button>
            {isOpen && (<>

            {set.summary?.summary && (
              <div style={{ ...text('body'), color: colour.ink, marginTop: 6 }}>{set.summary.summary}</div>
            )}
            {(set.summary?.facts || []).length > 0 && (
              <div style={{ marginTop: 6 }}>
                {set.summary.facts.map((f, i) => (
                  <div key={i} style={{ ...text('caption'), color: colour.ink, display: 'flex', gap: 6 }}>
                    <span style={{ color: colour.inkFaint, minWidth: 92 }}>{f.label}</span>
                    <span style={{ fontWeight: 600 }}>{f.value}</span>
                  </div>
                ))}
              </div>
            )}

            {set.emails.length === 0 && (
              <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: 6 }}>
                {set.searched
                  ? `No emails with ${set.name} about this patient were found in the bookings inbox or the team's mailboxes.`
                  : 'The booking has no patient surname yet, so the emails cannot be found.'}
              </div>
            )}

            {set.emails.length > 0 && (
              <button type="button" aria-expanded={emailsOpen}
                onClick={() => setShowEmails(v => ({ ...v, [set.distributor]: !emailsOpen }))}
                style={{
                  ...text('caption'), fontWeight: 600, color: colour.accentDeep, background: 'none',
                  border: 'none', padding: 0, marginTop: space.sm, cursor: 'pointer'
                }}>
                {emailsOpen ? 'Hide emails' : `Show emails (${set.emails.length})`}
                {!emailsOpen && set.emails.some(m => m.attachments.length)
                  ? ` · ${set.emails.reduce((n, m) => n + m.attachments.length, 0)} attached` : ''}
              </button>
            )}

            {set.emails.length > 0 && emailsOpen && (
              <div style={{ marginTop: space.sm, borderTop: `1px solid ${colour.lineSoft}` }}>
                {set.emails.map((m, i) => {
                  const key = `${set.distributor}-${i}`
                  const open = openEmail === key
                  return (
                    <div key={key} style={{ padding: '6px 0', borderBottom: `1px solid ${colour.lineSoft}` }}>
                      <button type="button" onClick={() => setOpenEmail(open ? null : key)}
                        aria-expanded={open}
                        style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                        <div style={{ ...text('caption'), color: colour.inkFaint }}>
                          {m.outgoing ? '↗' : '↙'} <strong style={{ color: colour.ink }}>{m.from}</strong> · {when(m.at)}
                          {m.attachments.length > 0 ? ` · 📎 ${m.attachments.length}` : ''}
                        </div>
                        <div style={{ ...text('caption'), color: colour.ink, whiteSpace: open ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {m.subject}
                        </div>
                      </button>
                      {open && m.text && (
                        <div style={{ ...text('caption'), color: colour.inkMuted, whiteSpace: 'pre-wrap', marginTop: 4, userSelect: 'text', WebkitUserSelect: 'text' }}>
                          {m.text}
                        </div>
                      )}
                      {m.attachments.filter(a => a.token).map(a => (
                        <button key={a.token} type="button" onClick={() => openAttachment(a)}
                          style={{
                            ...text('caption'), fontWeight: 600, color: colour.accentDeep, marginTop: 4, marginRight: 6,
                            background: colour.accentSoft, border: 'none', borderRadius: radius.pill, padding: '4px 10px', cursor: 'pointer'
                          }}>
                          {viewable(a) ? '📄' : '⬇'} {a.filename}{a.size ? ` · ${kb(a.size)}` : ''}
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
            </>)}
          </div>
        )
      })}
    </>
  )
}

const box = {
  marginBottom: space.sm, padding: `${space.sm}px ${space.md}px`,
  borderRadius: radius.control, background: colour.surface, border: `1px solid ${colour.line}`
}
const heading = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, display: 'block', marginBottom: 4 }
