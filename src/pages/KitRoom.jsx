import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Page, Header, Banner, EmptyState, Skeleton } from '../design/Shell.jsx'
import { colour, text, space, radius, border, card, site } from '../design/tokens.js'
import { IconKit, IconSearch } from '../design/icons.jsx'
import MoveSheet from './kit/MoveSheet.jsx'
import KitDetail from './kit/KitDetail.jsx'
import AttachAgreements from './kit/AttachAgreements.jsx'
import { needsAgreement } from '../kit/agreements.js'
import { inventoryFor } from '../clinicalPlan/inventory.js'
import { systemsInKit } from '../clinicalPlan/systems.js'

// ─── Kit room ────────────────────────────────────────────────────────────────
// Where every set is, and moving one. Rebuilt 1 Nov 2026: the old page kept
// nothing — a move lived in one phone's memory until the app was reloaded —
// and took three taps through a hospital and a category to reach a kit.
//
// One list now, filtered rather than drilled into. The three places across the
// top are both the summary ("what is at RHH?") and the filter. Kits away from
// home float to the top, because "what has not come back" is the question the
// page is most often opened to answer.

export const PLACE_NAMES = { office: 'TM office / Warehouse', CLV: 'Calvary', RHH: 'RHH' }
// Calvary first, RHH second, the office third (Brent, 2 Nov 2026).
const PLACE_ORDER = ['CLV', 'RHH', 'office']

// A hospital's own logo where one has been added to public/logos, else its
// name in its colour. Replace by dropping calvary.png / rhh.png in that folder
// and naming it here.
const PLACE_LOGOS = { office: '/email-logo.png' }

export const DISTRIBUTORS = {
  signus: { name: 'Signus', logo: '/logos/signus.png' },
  // Cropped and darkened: the original is 85% empty space and hairline grey,
  // which at tile size on a phone drew as nothing at all.
  e4: { name: 'E4 Surgical', logo: '/logos/e4surgical-v2.png' },
  device: { name: 'Device Technologies', logo: '/logos/devicetech.png' },
  kt: { name: 'KT Medical' },
  globus: { name: 'Globus / NuVasive' },
  technomed: { name: 'TechnoMed', logo: '/logos/technomed.png' }
}

// A system made by somebody other than its distributor shows its maker: KT
// distribute Firebird, but the tray says Orthofix.
const SYSTEM_LOGOS = { 'Orthofix Firebird': '/logos/orthofix.png' }

/**
 * The distributor, from the kit, else from what the inventory says its system
 * is, else from the systems its name or system mentions ("Dakota TM loan",
 * "Catenary"), else from the distributor's own name in it ("E4 …").
 *
 * The E4 logos dropped off kits whose distributor was blank — added or edited
 * without one — because only the exact system name was tried.
 */
export function distributorOf(kit) {
  if (kit.distributor) return kit.distributor
  const words = `${kit.system || ''} ${kit.name || ''}`
  for (const candidate of [kit.system, ...systemsInKit(words)]) {
    const d = inventoryFor(candidate)?.distributor
    if (d) return d
  }
  if (/\be4\b/i.test(words)) return 'e4'
  if (/\bsignus\b/i.test(words)) return 'signus'
  if (/\bdevice\b|seaspine/i.test(words)) return 'device'
  if (/\bkt\b/i.test(words)) return 'kt'
  if (/globus|nuvasive/i.test(words)) return 'globus'
  if (/^tm\b|technomed/i.test(words)) return 'technomed'
  return ''
}

function logoFor(kit) {
  return SYSTEM_LOGOS[kit.system] || DISTRIBUTORS[distributorOf(kit)]?.logo || null
}

const KIND = { consignment: 'Consignment', floating: 'TM loan', technomed: 'TechnoMed' }

function sinceText(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days`
}

export default function KitRoom({ user, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [place, setPlace] = useState('all')
  const [query, setQuery] = useState('')
  const [distributor, setDistributor] = useState('')
  const [moving, setMoving] = useState(null)
  const [open, setOpen] = useState(null)
  const [openFocus, setOpenFocus] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [dragging, setDragging] = useState(null)   // { kit, x, y, over }
  const [order, setOrder] = useState(null)
  const [attaching, setAttaching] = useState(false)
  const [busy, setBusy] = useState('')
  const headers = { Authorization: `Bearer ${user?.token || ''}` }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/guides?kits=list', { headers })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not load the kit room')
      setData(json); setError(''); setOrder(json.order || [])
    } catch (err) { setError(err.message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])

  useEffect(() => { load() }, [load])

  async function post(what, body) {
    const res = await fetch(`/api/guides?kits=${what}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    const json = await res.json()
    if (!res.ok || json.error) throw new Error(json.error || 'That did not work')
    return json
  }

  async function act(key, fn) {
    setBusy(key); setError('')
    try { await fn(); await load() } catch (err) { setError(err.message) }
    setBusy('')
  }

  const kits = data?.kits || []
  const counts = useMemo(() => Object.fromEntries(PLACE_ORDER.map(p => [p, kits.filter(k => k.at === p).length])), [kits])
  const unchecked = kits.filter(k => !k.checkedAt).length

  const shown = kits.filter(k => (place === 'all' || k.at === place)
    && (!distributor || distributorOf(k) === distributor)
    && (!query || `${k.name} ${k.system} ${(k.trays || []).join(' ')} ${DISTRIBUTORS[k.distributor]?.name || ''}`
      .toLowerCase().includes(query.toLowerCase())))
  // The shared order a person dragged, where there is one; anything not in it
  // keeps its place by distributor after the ordered ones.
  const arrange = list => {
    const sorted = byDistributor(list)
    const at = new Map((order || []).map((id, i) => [id, i]))
    return [...sorted].sort((a, b) => (at.has(a.id) ? at.get(a.id) : 1e6 + sorted.indexOf(a)) - (at.has(b.id) ? at.get(b.id) : 1e6 + sorted.indexOf(b)))
  }
  const away = shown.filter(k => k.away)
  const home = shown.filter(k => !k.away)

  // ─── Dragging a tile (Brent, 11 Nov 2026: "the tiles … need to be able to be
  // moved easily") ── hold the ⋮⋮ grip and drag: onto another kit to put it
  // there in the order, onto another place to move it there (the move sheet
  // opens with that place chosen — a move still sends its email). Pointer
  // events, so a finger and a mouse work the same.
  function startDrag(kit, e) {
    e.preventDefault?.()
    // A phone gets a small buzz when the tile comes up, as on a home screen.
    try { navigator.vibrate?.(15) } catch { /* not every phone */ }
    setDragging({ kit, x: e.clientX, y: e.clientY, over: null })
    let lastY = e.clientY
    // While a tile is held the page must not scroll under the finger —
    // and near the top or bottom edge it scrolls on purpose, so a tile can be
    // carried further than one screen.
    const noScroll = ev => ev.preventDefault()
    window.addEventListener('touchmove', noScroll, { passive: false })
    const scroller = document.querySelector('.tm-scroll')
    const edge = setInterval(() => {
      if (!scroller) return
      const box = scroller.getBoundingClientRect()
      if (lastY < box.top + 70) scroller.scrollTop -= 14
      else if (lastY > box.bottom - 90) scroller.scrollTop += 14
    }, 16)
    const stop = () => {
      clearInterval(edge)
      window.removeEventListener('touchmove', noScroll)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      setDragging(null)
    }
    const target = (x, y) => {
      const el = document.elementFromPoint(x, y)
      const tile = el?.closest?.('[data-kit-tile]')
      if (tile && tile.dataset.kitTile !== kit.id) return { tile: tile.dataset.kitTile, place: tile.dataset.place }
      const place = el?.closest?.('[data-drop-place]')
      return place ? { place: place.dataset.dropPlace } : null
    }
    const move = ev => { lastY = ev.clientY; setDragging(d => d && { ...d, x: ev.clientX, y: ev.clientY, over: target(ev.clientX, ev.clientY) }) }
    const up = ev => {
      stop()
      const over = target(ev.clientX, ev.clientY)
      if (!over) return
      if (over.place && over.place !== kit.at) { setMoveTo(over.place); setMoving(kit); return }
      if (over.tile) reorder(kit.id, over.tile)
    }
    const cancel = () => stop()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  async function reorder(id, beforeId) {
    // The whole room's order as it is drawn now, with the one tile moved.
    const drawn = [...arrange(kits.filter(k => k.away)), ...PLACE_ORDER.flatMap(p => arrange(kits.filter(k => !k.away && k.at === p)))].map(k => k.id)
    const without = drawn.filter(x => x !== id)
    const at = without.indexOf(beforeId)
    const next = [...without.slice(0, at), id, ...without.slice(at)]
    if (next.join() === drawn.join()) return
    const was = order
    setOrder(next)
    try { await post('order', { ids: next }) } catch (err) { setOrder(was); setError(err.message) }
  }

  const tile = (k, extra) => (
    <KitTile key={k.id} kit={k} onOpen={(focus = '') => { setOpenFocus(focus); setOpen(k) }}
      onMove={() => { setMoveTo(''); setMoving(k) }} busy={busy === k.id}
      onGrab={e => startDrag(k, e)} lifted={dragging?.kit.id === k.id} target={dragging?.over?.tile === k.id}
      {...extra} />
  )
  const presentDistributors = [...new Set(kits.map(distributorOf).filter(Boolean))]

  return (
    <Page>
      <Header eyebrow="Kit and stock" title="Kit room" onBack={onBack}
        subtitle={data ? `${kits.length} kits · ${kits.filter(k => k.away).length} away from home` : 'Loading…'} />
      <div className="tm-measure" style={{ padding: space.lg, paddingBottom: space.xxxl }}>

        {error && <Banner tone="danger">{error}</Banner>}

        {data && !data.settings?.emailsOn && (
          <Banner tone="warning">
            <strong>Hospital emails are off.</strong> Moves are recorded and you will see the email that would go
            to Calvary or RHH, but nothing is sent. {data.isAdmin
              ? 'Turn them on once the stock-take below is finished.'
              : 'Brent or Erin will turn them on once the stock-take is done.'}
            {data.isAdmin && unchecked === 0 && (
              <div style={{ marginTop: space.sm }}>
                <button onClick={() => act('emails', () => post('settings', { emailsOn: true }))}
                  disabled={busy === 'emails'} style={pill(true)}>Turn hospital emails on</button>
              </div>
            )}
          </Banner>
        )}
        {data?.settings?.emailsOn && data.isAdmin && (
          <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.md }}>
            Hospital emails are on.{' '}
            <button onClick={() => act('emails', () => post('settings', { emailsOn: false }))}
              style={{ ...linkButton }}>Turn off</button>
          </div>
        )}

        {data && unchecked > 0 && (
          <div style={{ ...card(), padding: space.md, marginBottom: space.md }}>
            <div style={{ ...text('bodyStrong'), color: colour.ink }}>Stock-take: {kits.length - unchecked} of {kits.length} checked</div>
            <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>
              Tap <strong>It's here</strong> on each kit you can see where the list says it is — it turns green.
              If it is somewhere else, open it and pick where it really is.
            </div>
            <div style={{ height: 6, background: colour.lineSoft, borderRadius: radius.pill, marginTop: space.sm, overflow: 'hidden' }}>
              <div style={{ width: `${((kits.length - unchecked) / Math.max(kits.length, 1)) * 100}%`, height: '100%', background: colour.accent }} />
            </div>
          </div>
        )}

        {/* The three places: summary and filter at once. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: space.sm, marginBottom: space.md }}>
          {PLACE_ORDER.map(p => {
            const on = place === p
            return (
              <button key={p} onClick={() => setPlace(on ? 'all' : p)} aria-pressed={on}
                style={{
                  ...card(), padding: `${space.md}px ${space.sm}px`, textAlign: 'left', cursor: 'pointer',
                  background: on ? site[p].ink : site[p].soft, borderColor: on ? site[p].ink : site[p].line
                }}>
                <div style={{ ...text('title'), color: on ? 'white' : site[p].ink }}>{data ? counts[p] : '–'}</div>
                <div style={{ ...text('caption'), fontWeight: 600, color: on ? 'rgba(255,255,255,0.85)' : site[p].ink }}>{PLACE_NAMES[p]}</div>
              </button>
            )
          })}
        </div>

        <div style={{ position: 'relative', marginBottom: space.sm }}>
          <span style={{ position: 'absolute', left: 12, top: 11, color: colour.inkFainter, display: 'flex' }}><IconSearch size={18} /></span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search kits or trays"
            aria-label="Search kits" style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 38px', ...text('field'),
              border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink
            }} />
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: space.lg }}>
          <button onClick={() => setDistributor('')} style={pill(!distributor)}>All</button>
          {presentDistributors.map(d => (
            <button key={d} onClick={() => setDistributor(distributor === d ? '' : d)} style={pill(distributor === d)}>
              {DISTRIBUTORS[d]?.name || d}
            </button>
          ))}
        </div>

        {data && kits.length > 1 && (
          <div style={{ ...text('caption'), color: colour.inkFaint, margin: `-${space.sm}px 0 ${space.md}px` }}>
            Press and hold a tile to pick it up — drop it on another kit to change the order, or on Calvary, RHH or the office to move it there.
          </div>
        )}

        {!data && !error && (
          <TileGrid>{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={132} style={{ borderRadius: radius.card }} />)}</TileGrid>
        )}

        {data && shown.length === 0 && (
          <EmptyState icon={IconKit} title="No kits match" detail="Try another place, distributor or search." />
        )}

        {away.length > 0 && (
          <>
            <SectionTitle>Away from home · {away.length}</SectionTitle>
            <TileGrid>
              {arrange(away).map(k => tile(k, { onReturn: () => act(k.id, () => post('return', { kitId: k.id })) }))}
            </TileGrid>
          </>
        )}

        {PLACE_ORDER.filter(p => home.some(k => k.at === p) || dragging).map(p => (
          <div key={p} data-drop-place={p} style={{
            borderRadius: radius.card,
            outline: dragging && dragging.over?.place === p && !dragging.over?.tile && p !== dragging.kit.at ? `2px dashed ${colour.accent}` : 'none',
            outlineOffset: 4
          }}>
            <PlaceHeading place={p} count={home.filter(k => k.at === p).length} />
            {dragging && p !== dragging.kit.at && (
              <div style={{ ...text('caption'), color: colour.accentDeep, marginBottom: space.xs }}>Drop here to move {dragging.kit.name} to {PLACE_NAMES[p]}</div>
            )}
            <TileGrid>
              {arrange(home.filter(k => k.at === p)).map(k => tile(k, { onCheck: () => act(k.id, () => post('check', { kitId: k.id, at: k.at })) }))}
            </TileGrid>
          </div>
        ))}

        {dragging && (
          <div aria-hidden="true" style={{
            position: 'fixed', left: dragging.x - 70, top: dragging.y - 24, width: 140, zIndex: 4000, pointerEvents: 'none',
            ...card(), padding: space.sm, background: colour.surface, boxShadow: '0 8px 24px rgba(4,39,70,0.25)', transform: 'rotate(-2deg)',
            ...text('bodyStrong'), color: colour.ink
          }}>{dragging.kit.name}</div>
        )}

        <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', marginTop: space.lg }}>
          {data?.canEdit && (
            <button onClick={() => setOpen({ id: '', name: '', trays: [] })} style={pill(false)}>+ Add a kit</button>
          )}
          {data?.canRemove && (
            <button onClick={() => setAttaching(true)} data-attach-agreements style={pill(false)}>Attach agreements from Dropbox</button>
          )}
        </div>

        {data && <HistoryLink user={user} />}
      </div>

      {attaching && <AttachAgreements user={user} post={post} onClose={() => setAttaching(false)} onDone={load} />}
      {moving && (
        <MoveSheet kit={moving} initialTo={moveTo} user={user} emailsOn={Boolean(data?.settings?.emailsOn)} today={data?.today}
          post={post} onClose={() => setMoving(null)} onDone={() => { setMoving(null); load() }} />
      )}
      {open && (
        <KitDetail key={open.id || 'new'} kit={(open.id && kits.find(k => k.id === open.id)) || open} canEdit={Boolean(data?.canEdit)}
          canRemove={Boolean(data?.canRemove)} focus={openFocus} user={user} post={post}
          onClose={() => setOpen(null)} onChanged={load}
          onMove={() => { setMoveTo(''); setMoving(kits.find(k => k.id === open.id) || open); setOpen(null) }} />
      )}
    </Page>
  )
}

function PlaceBadge({ place, size = 'heading' }) {
  const look = site[place] || site.office
  if (PLACE_LOGOS[place]) {
    return <img src={PLACE_LOGOS[place]} alt={look.name} style={{ height: 28, maxWidth: 120, objectFit: 'contain' }} />
  }
  // Until the logo is added: a block of the hospital's colour. Its name in a
  // badge beside its name in the heading said the same thing twice.
  return <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, background: look.ink, flexShrink: 0 }} />
}

/** A place's heading: bigger than a section label, with its badge and colour. */
function PlaceHeading({ place, count }) {
  const look = site[place] || site.office
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: space.sm,
      margin: `${space.xl}px 0 ${space.sm}px`, paddingBottom: 6, borderBottom: `2px solid ${look.line}`
    }}>
      <PlaceBadge place={place} />
      <span style={{ ...text('heading'), color: look.ink }}>{PLACE_NAMES[place]}</span>
      <span style={{ ...text('caption'), color: colour.inkFaint }}>{count} {count === 1 ? 'kit' : 'kits'}</span>
    </div>
  )
}

function SectionTitle({ children }) {
  return <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.lg}px 0 ${space.sm}px` }}>{children}</div>
}

// ─── Tiles, not rows ─────────────────────────────────────────────────────────
// "The tabs in a list are hard to find. I'd prefer tiles on the page or similar
// so you can see more kits on the screen at once." — Brent, 2 Nov 2026.
//
// Two across on a phone, as many as fit on a wider screen. The logo leads,
// because it is what the eye finds first on a shelf of trays; within each place
// the kits run distributor by distributor, so the logos fall into runs and a
// kit is found by its maker before its name is read.

/** Within a place, grouped by distributor, then by name. */
function byDistributor(kits) {
  const name = k => DISTRIBUTORS[distributorOf(k)]?.name || 'zz'
  return [...kits].sort((a, b) => name(a).localeCompare(name(b)) || String(a.name).localeCompare(String(b.name)))
}

function TileGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: space.sm }}>
      {children}
    </div>
  )
}

// Press and hold anywhere on a tile to pick it up (Brent, 11 Nov 2026: "I
// thought I'd be able to move the kit room tiles around on the page"). A tap
// still opens the kit; moving before the hold is up is a scroll, not a drag.
const HOLD_MS = 380
function useHold(onGrab) {
  const timer = React.useRef(null)
  const start = React.useRef(null)
  const fired = React.useRef(false)
  const clear = () => { clearTimeout(timer.current); timer.current = null }
  return {
    onPointerDown: e => {
      if (!onGrab || e.button > 0) return
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      const ev = { clientX: e.clientX, clientY: e.clientY }
      clear()
      timer.current = setTimeout(() => { fired.current = true; onGrab(ev) }, HOLD_MS)
    },
    onPointerMove: e => {
      if (timer.current && start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    // The tap that ends a hold is not a tap on whatever was under it.
    onClickCapture: e => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false } },
    onContextMenu: e => { if (onGrab) e.preventDefault() }
  }
}

function KitTile({ kit, onOpen, onMove, onReturn, onCheck, busy, onGrab, lifted, target }) {
  const hold = useHold(onGrab)
  const dist = DISTRIBUTORS[distributorOf(kit)]
  const logo = logoFor(kit)
  const trayCount = (kit.trays || []).length
  const awayTrays = kit.away?.trays?.length
  const checked = !kit.away && kit.checkedAt
  const tint = site[kit.at] || site.office
  const status = kit.away
    ? `At ${PLACE_NAMES[kit.at]} · ${sinceText(kit.away.since)}${awayTrays && awayTrays < trayCount ? ` · ${awayTrays}/${trayCount} trays` : ''}`
    : `${KIND[kit.kind] || ''}${trayCount ? ` · ${trayCount} ${trayCount === 1 ? 'tray' : 'trays'}` : ''}`
  const small = { ...pill(false), padding: '5px 8px', flex: 1, textAlign: 'center' }

  return (
    <div data-kit-tile={kit.id} data-place={kit.at} {...hold} style={{
      ...card(), display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, position: 'relative',
      opacity: lifted ? 0.4 : 1, WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
      boxShadow: target ? `0 0 0 2px ${colour.accent}` : undefined,
      // Tinted by where it is now, so a Calvary set reads as Calvary wherever
      // it is listed; the top edge carries its state.
      background: tint.soft, borderColor: tint.line,
      borderTop: `3px solid ${kit.away ? colour.warning : checked ? colour.accent : tint.line}`
    }}>
      {onGrab && (
        <span role="button" aria-label={`Drag ${kit.name}`} title="Drag to move or reorder"
          onPointerDown={e => { e.stopPropagation(); onGrab(e) }}
          style={{
            position: 'absolute', top: 4, right: 4, zIndex: 1, width: 36, height: 36, display: 'flex', alignItems: 'center',
            justifyContent: 'center', touchAction: 'none', cursor: 'grab', color: colour.inkMuted, ...text('bodyStrong'), userSelect: 'none',
            borderRadius: radius.control, background: 'rgba(255,255,255,0.7)'
          }}>⋮⋮</span>
      )}
      <button onClick={() => onOpen()} aria-label={`Open ${kit.name}`} style={{
        background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer',
        padding: `${space.sm}px ${space.sm}px 6px`, flex: 1, minWidth: 0,
        // A button centres its content; a tile beside a taller one must not
        // have its logo and name drift down to meet it.
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch'
      }}>
        <div style={{
          height: 34, marginBottom: 6, display: 'flex', alignItems: 'center',
          justifyContent: 'flex-start', overflow: 'hidden'
        }}>
          {logo
            ? <img src={logo} alt={dist?.name || ''} style={{ maxWidth: '78%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ ...text('micro'), color: colour.navy, letterSpacing: '0.6px' }}>
                {(dist?.name || kit.system || '').toUpperCase()}
              </span>}
        </div>
        <div style={{
          ...text('bodyStrong'), color: colour.ink, lineHeight: 1.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
        }}>{kit.name}</div>
        <div style={{ ...text('caption'), color: kit.away ? colour.warning : colour.inkFaint, marginTop: 2 }}>
          {status}
        </div>
        {checked && (
          <div style={{ ...text('caption'), color: colour.accentDeep, fontWeight: 600 }}>
            ✓ checked{kit.checkedBy ? ` by ${kit.checkedBy}` : ''}
          </div>
        )}
      </button>
      {/* The tray list and the agreement, one tap from the tile. */}
      {/* One row, never wrapping: a tile is as short as it can be. */}
      <div style={{ display: 'flex', gap: 4, padding: `0 ${space.sm}px 6px` }}>
        <button onClick={() => onOpen('trays')} data-tile-trays
          style={needsAgreement(kit) ? { ...chip, flex: '0 0 auto' } : chip}>{needsAgreement(kit) ? 'Trays' : 'Tray list'}</button>
        {needsAgreement(kit) && <button onClick={() => onOpen('docs')} data-tile-docs
          aria-label={kit.docs?.consignment ? 'Agreement on file' : 'Add an agreement'}
          style={{ ...chip, ...(kit.docs?.consignment ? {} : { color: colour.inkFaint, borderStyle: 'dashed' }) }}>
          {kit.docs?.consignment ? 'Agreement ✓' : 'Agreement'}
        </button>}
      </div>
      <div style={{ display: 'flex', gap: 4, padding: `0 ${space.sm}px ${space.sm}px` }}>
        {kit.away && onReturn && (
          <button onClick={onReturn} disabled={busy} style={small}>{busy ? '…' : 'Returned'}</button>
        )}
        {/* The stock-take from the tile itself: one tap, it goes green. */}
        {!kit.away && !kit.checkedAt && onCheck && (
          <button onClick={onCheck} disabled={busy} aria-label={`${kit.name} is here`}
            style={{ ...small, border: `1px solid ${colour.accent}`, color: colour.accentDeep }}>
            {busy ? '…' : "It's here"}
          </button>
        )}
        <button onClick={onMove} style={{ ...pill(true), padding: '5px 8px', flex: 1, textAlign: 'center' }}>Move</button>
      </div>
    </div>
  )
}

function HistoryLink({ user }) {
  const [history, setHistory] = useState(null)
  async function show() {
    if (history) { setHistory(null); return }
    try {
      const res = await fetch('/api/guides?kits=history', { headers: { Authorization: `Bearer ${user?.token || ''}` } })
      setHistory((await res.json()).history || [])
    } catch { setHistory([]) }
  }
  return (
    <div style={{ marginTop: space.xl }}>
      <button onClick={show} style={{ ...linkButton, ...text('bodyStrong') }}>
        {history ? 'Hide movement history' : 'Movement history'}
      </button>
      {history && history.length === 0 && <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.sm }}>Nothing yet.</div>}
      {history && history.map((h, i) => (
        <div key={i} style={{ padding: `${space.sm}px 0`, borderBottom: border.hairlineSoft }}>
          <div style={{ ...text('body'), color: colour.ink }}>{h.kitName ? <strong>{h.kitName}</strong> : null}{h.kitName ? ' — ' : ''}{h.text}</div>
          <div style={{ ...text('caption'), color: colour.inkFainter }}>
            {new Date(h.at).toLocaleString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            {h.by ? ` · ${h.by}` : ''}
          </div>
        </div>
      ))}
    </div>
  )
}

export function pill(on) {
  return {
    ...text('caption'), fontWeight: 600, padding: '6px 12px', borderRadius: radius.pill, whiteSpace: 'nowrap',
    border: on ? 'none' : border.hairline, background: on ? colour.navy : colour.surface,
    color: on ? 'white' : colour.ink, cursor: 'pointer'
  }
}

const chip = {
  ...text('caption'), fontWeight: 600, padding: '3px 6px', borderRadius: radius.pill, cursor: 'pointer',
  border: `1px solid ${colour.line}`, background: colour.surface, color: colour.accentDeep, whiteSpace: 'nowrap',
  flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center'
}

const linkButton = { background: 'none', border: 'none', padding: 0, color: colour.accentDeep, cursor: 'pointer', ...text('caption'), fontWeight: 600 }
