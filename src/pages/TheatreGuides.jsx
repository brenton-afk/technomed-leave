import React, { useState, useEffect, useCallback } from 'react'
import { Page, Header, Body, SectionLabel, Banner, Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'

// ─── Theatre guides ───────────────────────────────────────────────────────────
// Field references for the systems the team carries, read in the perioperative
// environment on a phone.
//
// Each guide is one self-contained HTML page, so it is shown in an iframe rather
// than rebuilt in React. That is not laziness: they are condensed from the
// manufacturers' own technique documents and carry their own disclaimers, and
// reinterpreting them through another layout is how a step gets lost.
//
// The list is drawn here rather than using the bundled hub page, because the hub
// navigates between folders by relative link and nothing behind a login can
// follow those. Drawing it in the app also means the search and the grouping
// behave like the rest of the portal.

const GROUP_ORDER = ['Spine', 'Orthopaedics', 'Navigation', 'Restricted']

/** One guide, open full-screen over the list. */
function GuideView({ guide, user, onClose }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setHtml(null)
    setError('')
    fetch(`/api/guides?guide=${encodeURIComponent(guide.slug)}`, {
      headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
    })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not open that guide')
        return res.text()
      })
      .then(body => { if (live) setHtml(body) })
      .catch(err => { if (live) setError(err.message) })
    return () => { live = false }
  }, [guide.slug, user])

  return (
    <Overlay>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: colour.canvas,
        display: 'flex', flexDirection: 'column'
      }}>
        <div style={{
          padding: `calc(env(safe-area-inset-top, 0px) + ${space.sm}px) ${space.md}px ${space.sm}px`,
          background: colour.navy, display: 'flex', alignItems: 'center', gap: space.sm, flexShrink: 0
        }}>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: radius.control, color: 'white', padding: `8px ${space.md}px`,
            ...text('bodyStrong'), cursor: 'pointer'
          }}>‹ All guides</button>
          <span style={{ ...text('bodyStrong'), color: 'white', flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {guide.name}
          </span>
        </div>

        {error && <Banner tone="danger">{error}</Banner>}

        {!html && !error && (
          <div style={{ padding: space.xl, textAlign: 'center', ...text('caption'), color: colour.inkFaint }}>
            Opening {guide.name}…
          </div>
        )}

        {html && (
          // srcdoc, not a URL: the page needs the session header to be fetched
          // at all, and an iframe cannot send one. The guides make no external
          // requests, so nothing is lost by inlining them.
          //
          // Sandboxed to scripts only. They need scripts — the sections and
          // tables expand — and they need nothing else: no forms, no popups, no
          // access back into the portal that framed them.
          <iframe
            title={guide.name}
            srcDoc={html}
            sandbox="allow-scripts"
            style={{ flex: 1, width: '100%', border: 'none', background: 'white' }} />
        )}
      </div>
    </Overlay>
  )
}

function GuideCard({ guide, onOpen }) {
  return (
    <button onClick={() => onOpen(guide)}
      style={{
        display: 'flex', alignItems: 'center', gap: space.md, width: '100%', textAlign: 'left',
        background: colour.surface, border: `1px solid ${colour.line}`,
        borderRadius: radius.card, padding: space.md, marginBottom: space.sm, cursor: 'pointer'
      }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>
          {guide.name}
        </span>
        <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block' }}>
          {guide.maker}{guide.revision ? ` · ${guide.revision}` : ''}
        </span>
      </span>
      {guide.restricted && (
        <span style={{
          ...text('micro'), textTransform: 'uppercase', flexShrink: 0,
          background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
          color: colour.ink, borderRadius: radius.pill, padding: '2px 8px'
        }}>Restricted</span>
      )}
      <span style={{ ...text('body'), color: colour.inkFaint }}>›</span>
    </button>
  )
}

export default function TheatreGuides({ user, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/guides', {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the guides')
      setData(body)
    } catch (err) {
      setError(err.message)
    }
  }, [user])

  useEffect(() => { load() }, [load])

  const needle = query.trim().toLowerCase()
  const matches = g => !needle
    || `${g.name} ${g.maker} ${g.group}`.toLowerCase().includes(needle)

  const guides = (data?.guides || []).filter(matches)
  const coming = (data?.coming || []).filter(matches)
  const groups = GROUP_ORDER.filter(group => guides.some(g => g.group === group))

  return (
    <Page>
      <Header eyebrow="Kit and reference" title="Theatre guides"
        subtitle="Field references for the systems we carry" onBack={onBack} />
      <Body>
        {error && <Banner tone="danger">{error}</Banner>}

        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a system or manufacturer"
          aria-label="Search the guides"
          style={{
            width: '100%', padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
            border: `1px solid ${colour.line}`, borderRadius: radius.control,
            ...text('field'), color: colour.ink, background: colour.surface,
            outline: 'none', marginBottom: space.md
          }} />

        {!data && !error && (
          <div style={{ ...text('caption'), color: colour.inkFaint }}>Loading…</div>
        )}

        {groups.map(group => (
          <div key={group}>
            <SectionLabel>{group}</SectionLabel>
            {guides.filter(g => g.group === group).map(g => (
              <GuideCard key={g.slug} guide={g} onOpen={setOpen} />
            ))}
          </div>
        ))}

        {coming.length > 0 && (
          <>
            <SectionLabel>Being packaged</SectionLabel>
            {/* Listed so a guide that is not here yet reads as not built rather
                than as missing. */}
            {coming.map(g => (
              <div key={g.name} style={{
                display: 'flex', gap: space.md, padding: space.md, marginBottom: space.sm,
                border: `1px dashed ${colour.line}`, borderRadius: radius.card
              }}>
                <span style={{ flex: 1 }}>
                  <span style={{ ...text('body'), color: colour.inkMuted, display: 'block' }}>{g.name}</span>
                  <span style={{ ...text('caption'), color: colour.inkFainter }}>{g.maker}</span>
                </span>
              </div>
            ))}
          </>
        )}

        {data && !guides.length && !coming.length && (
          <div style={{ ...text('body'), color: colour.inkMuted }}>
            Nothing matches “{query}”.
          </div>
        )}

        <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: space.lg }}>
          A field reference, not a substitute for the manufacturer's instructions
          for use. Each guide shows the source revision it was built from.
        </div>
      </Body>

      {open && <GuideView guide={open} user={user} onClose={() => setOpen(null)} />}
    </Page>
  )
}
