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

// ─── Grouped by who we order from ────────────────────────────────────────────
// It used to be Spine / Orthopaedics / Navigation, which put eight of the nine
// spine guides in one undifferentiated list. Nobody looks for "a spine guide".
// They look for the Signus tray, or whatever KT Medical sent for Thursday —
// the distributor is how the kit arrives, who gets rung when a tray is short,
// and who the usage sheet goes to afterwards.
//
// Worth saying once: the distributor is not the manufacturer. Shoreline and
// Mariner are SeaSpine systems bought through Device Technologies; Firebird,
// Forza XP and LONESTAR are Orthofix through KT Medical; Dakota, REFORM and
// Global PLIF are through E4 Surgical. The maker stays on each card, because
// it is what the rep sees printed on the tray.
//
// Spine first, in the order the team lists them. Navigation, Orthopaedics and
// Restricted keep their own sections at the end: Brainlab is a service rather
// than a tray, and Surgeon Preferences is ours.
const DISTRIBUTOR_ORDER = ['signus', 'device', 'e4', 'kt']

const DISTRIBUTOR_NAMES = {
  signus: 'Signus',
  device: 'Device Technologies',
  e4: 'E4 Surgical',
  kt: 'KT Medical',
  globus: 'Nuvasive/Globus'
}

// Spine stays in this list even though every spine guide is tagged with a
// distributor today. It is the fallback: an untagged guide has to land
// somewhere visible, and dropping Spine from here made DIPLOMAT disappear from
// the app entirely the moment it lost its tag. A guide in the wrong section is
// a tidying job; a guide nobody can find is a guide that does not exist.
const GROUP_ORDER = ['Spine', 'Navigation', 'Orthopaedics', 'Restricted']

/**
 * One guide, open full-screen over the list.
 *
 * `focus` is the id of a section to open at — how a booking jumps straight to
 * its surgeon's card instead of landing somebody at the top of a document
 * with seven of them.
 *
 * Exported so a case card can open one directly. The alternative was
 * navigating to the guides tab and leaving somebody to find it, which is the
 * browsing this exists to remove.
 */
/**
 * The guide's own HTML, told to open at a section.
 *
 * Done by appending a script rather than by reaching into the frame: the
 * iframe is sandboxed to scripts only and has no same-origin access back, so
 * the instruction has to travel inside the document.
 *
 * The id is matched against a strict pattern before it is interpolated. It
 * comes from the app's own table rather than from anything a user typed, and
 * that is exactly the assumption that stops being true the first time
 * somebody wires this to a search box.
 */
export function scrollTo(html, id) {
  if (!html || !id || !/^[a-z][a-z0-9-]{0,40}$/.test(id)) return html
  return `${html}
<script>
  (function () {
    var target = document.getElementById(${JSON.stringify(id)})
    if (!target) return
    // The guides expand their own sections on load; going after that rather
    // than racing it.
    requestAnimationFrame(function () {
      if (target.open === false) target.open = true
      var card = target.closest ? (target.closest('details') || target) : target
      if (card && card.open === false) card.open = true
      target.scrollIntoView({ block: 'start' })
    })
  })()
</script>`
}

export function GuideView({ guide, user, onClose, focus }) {
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
            srcDoc={scrollTo(html, focus)}
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
    || `${g.name} ${g.maker} ${g.group} ${DISTRIBUTOR_NAMES[g.distributor] || ''}`
      .toLowerCase().includes(needle)

  const guides = (data?.guides || []).filter(matches)
  const coming = (data?.coming || []).filter(matches)
  // A guide with a distributor is listed under it; everything else falls back
  // to its old group, so adding a guide and forgetting to tag it makes it
  // appear in the wrong place rather than disappear.
  const byDistributor = DISTRIBUTOR_ORDER
    .filter(key => guides.some(g => g.distributor === key))
  const extras = [...new Set(guides
    .map(g => g.distributor)
    .filter(key => key && !DISTRIBUTOR_ORDER.includes(key)))]
  const distributors = [...byDistributor, ...extras]
  const groups = GROUP_ORDER.filter(group =>
    guides.some(g => !g.distributor && g.group === group))

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

        {distributors.map(key => (
          <div key={key}>
            <SectionLabel>{DISTRIBUTOR_NAMES[key] || key}</SectionLabel>
            {guides.filter(g => g.distributor === key).map(g => (
              <GuideCard key={g.slug} guide={g} onOpen={setOpen} />
            ))}
          </div>
        ))}

        {groups.map(group => (
          <div key={group}>
            <SectionLabel>{group}</SectionLabel>
            {guides.filter(g => !g.distributor && g.group === group).map(g => (
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
