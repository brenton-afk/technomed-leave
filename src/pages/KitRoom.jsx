import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Page, Header, Banner, EmptyState, Skeleton, BAND_RAISED } from '../design/Shell.jsx'
import { colour, text, space, radius, border, card, site } from '../design/tokens.js'
import { IconKit, IconSearch } from '../design/icons.jsx'
import MoveSheet from './kit/MoveSheet.jsx'
import KitDetail from './kit/KitDetail.jsx'
import AttachAgreements from './kit/AttachAgreements.jsx'
import SystemDetail from './kit/SystemDetail.jsx'
import AddTraySheet from './kit/AddTraySheet.jsx'
import CourierNumbers from './kit/CourierNumbers.jsx'
import KitSettings from './kit/KitSettings.jsx'
import FillAgreements from './kit/FillAgreements.jsx'
import { groupSystems, traysByPlace, systemOf, setLabel, awayLines, PLACE_ORDER } from '../kit/systems.js'
import { brandFor, tileName } from '../kit/brands.js'
import { movingFrom } from '../kit/trayPlaces.js'
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
// Calvary first, RHH second, the office third (Brent, 2 Nov 2026) — PLACE_ORDER in kit/systems.js.

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


export default function KitRoom({ user, onBack, openKit = '' }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [place, setPlace] = useState('all')
  const [query, setQuery] = useState('')
  const [moving, setMoving] = useState(null)
  const [open, setOpen] = useState(null)
  // The kit room is one tile per system (Brent, 20 Nov 2026); this is the one open.
  const [openSystem, setOpenSystem] = useState('')
  const [addingTray, setAddingTray] = useState(null)
  const [openFocus, setOpenFocus] = useState('')
  // One tray moved on its own, from its Move button in the kit (Brent, 20 Nov 2026).
  const [moveTrays, setMoveTrays] = useState(null)
  const [moveTo, setMoveTo] = useState('')
  const [dragging, setDragging] = useState(null)   // { kit, x, y, over }
  const [order, setOrder] = useState(null)
  const [attaching, setAttaching] = useState(false)
  const [filling, setFilling] = useState(false)
  const [editingCouriers, setEditingCouriers] = useState(false)
  const [settings, setSettings] = useState(false)
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
  // Opened from Resources' "Tray list": straight to that kit's trays, once.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !openKit || !data?.kits) return
    const k = data.kits.find(x => x.id === openKit)
    if (k) { opened.current = true; setOpenSystem(systemOf(k).toLowerCase()) }
  }, [data, openKit])

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
  const systems = useMemo(() => groupSystems(kits), [kits])
  const counts = useMemo(() => Object.fromEntries(PLACE_ORDER.map(p => [p, systems.filter(g => p in traysByPlace(g.kits)).length])), [systems])
  const unchecked = kits.filter(k => !k.checkedAt).length

  const shown = systems.filter(g => (place === 'all' || place in traysByPlace(g.kits))
    && (!query || `${g.name} ${g.kits.map(k => `${(k.trays || []).join(' ')} ${DISTRIBUTORS[distributorOf(k)]?.name || ''}`).join(' ')}`
      .toLowerCase().includes(query.toLowerCase())))
  // The shared order a person dragged (kept as kit ids — a system sits where
  // its first set does); anything not in it keeps its place by distributor.
  const arrange = list => {
    const name = g => DISTRIBUTORS[distributorOf(g.kits[0])]?.name || 'zz'
    const sorted = [...list].sort((a, b) => name(a).localeCompare(name(b)) || a.name.localeCompare(b.name))
    const at = new Map((order || []).map((id, i) => [id, i]))
    const pos = g => Math.min(...g.kits.map(k => (at.has(k.id) ? at.get(k.id) : Infinity)))
    return [...sorted].sort((a, b) => {
      const pa = pos(a); const pb = pos(b)
      if (pa === pb) return sorted.indexOf(a) - sorted.indexOf(b)
      return pa - pb
    })
  }

  // ─── Dragging a tile (Brent, 11 Nov 2026) ── hold a system and drop it on
  // another to change the order. Moving between hospitals is done tray by tray
  // (or "Move all") inside the system, since a system now spans the hospitals.
  function startDrag(group, e) {
    e.preventDefault?.()
    try { navigator.vibrate?.(15) } catch { /* not every phone */ }
    setDragging({ group, x: e.clientX, y: e.clientY, over: null })
    let lastY = e.clientY
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
      const tile = document.elementFromPoint(x, y)?.closest?.('[data-system-tile]')
      return tile && tile.dataset.systemTile !== group.key ? { tile: tile.dataset.systemTile } : null
    }
    const move = ev => { lastY = ev.clientY; setDragging(d => d && { ...d, x: ev.clientX, y: ev.clientY, over: target(ev.clientX, ev.clientY) }) }
    const up = ev => {
      stop()
      const over = target(ev.clientX, ev.clientY)
      if (over?.tile) reorder(group.key, over.tile)
    }
    const cancel = () => stop()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  async function reorder(key, beforeKey) {
    const drawn = arrange(systems).map(g => g.key)
    const without = drawn.filter(x => x !== key)
    const at = without.indexOf(beforeKey)
    const nextKeys = [...without.slice(0, at), key, ...without.slice(at)]
    if (nextKeys.join() === drawn.join()) return
    const byKey = new Map(systems.map(g => [g.key, g]))
    const next = nextKeys.flatMap(k => byKey.get(k).kits.map(x => x.id))
    const was = order
    setOrder(next)
    try { await post('order', { ids: next }) } catch (err) { setOrder(was); setError(err.message) }
  }

  const openGroup = openSystem && systems.find(g => g.key === openSystem)

  const trayTotals = useMemo(() => {
    const out = { CLV: 0, RHH: 0, office: 0 }
    for (const g of systems) for (const [p, n] of Object.entries(traysByPlace(g.kits))) out[p] = (out[p] || 0) + n
    return out
  }, [systems])
  const setupDue = data && (unchecked > 0 || !data.settings?.emailsOn)

  return (
    <Page>
      {/* Option C (Brent, 21 Nov 2026): the stock-take and hospital-email
          banners moved behind the ⚙; the band carries the tray counts. */}
      <Header title="Kit room" onBack={onBack}
        right={(
          <button onClick={() => setSettings(true)} aria-label="Kit room settings" data-kit-settings style={{
            width: 40, height: 40, borderRadius: radius.control, ...BAND_RAISED, color: 'white', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
            {setupDue && <span aria-hidden="true" style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, background: colour.warning }} />}
          </button>
        )}>
        {/* The three places: tray counts and the filter at once. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: space.sm, marginTop: space.sm }}>
          {PLACE_ORDER.map(p => {
            const on = place === p
            const n = trayTotals[p] || 0
            return (
              <button key={p} onClick={() => setPlace(on ? 'all' : p)} aria-pressed={on} data-place-tile={p}
                style={{
                  padding: `${space.sm}px ${space.sm + 2}px`, textAlign: 'left', cursor: 'pointer', borderRadius: radius.control,
                  ...BAND_RAISED, border: `1px solid ${on ? 'white' : site[p].ink}`,
                  ...(on ? { background: site[p].ink } : {})
                }}>
                <div style={{ ...text('title'), color: 'white' }}>{data ? n : '–'}</div>
                <div style={{ ...text('caption'), color: 'rgba(255,255,255,0.8)' }}>{p === 'office' ? 'at the office' : `${n === 1 ? 'tray' : 'trays'} at ${PLACE_NAMES[p]}`}</div>
              </button>
            )
          })}
        </div>
      </Header>
      <div className="tm-measure" style={{ padding: space.lg, paddingBottom: space.xxxl }}>

        {error && <Banner tone="danger">{error}</Banner>}

        <div style={{ display: 'flex', gap: space.sm, alignItems: 'center', marginBottom: space.sm }}>
          <div style={{ flex: 1, ...text('caption'), color: colour.inkFaint }}>
            {data ? `${shown.length} ${shown.length === 1 ? 'system' : 'systems'}${place !== 'all' ? ` at ${PLACE_NAMES[place]}` : ''}` : 'Loading…'}
          </div>
          {data?.canEdit && (
            <button onClick={() => setAddingTray({ system: null })} data-add-tray style={{ ...pill(true), padding: '8px 14px' }}>+ Add a tray</button>
          )}
        </div>

        <div style={{ position: 'relative', marginBottom: space.md }}>
          <span style={{ position: 'absolute', left: 12, top: 11, color: colour.inkFainter, display: 'flex' }}><IconSearch size={18} /></span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search systems, trays or distributors"
            aria-label="Search kits" style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 38px', ...text('field'),
              border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink
            }} />
        </div>

        {!data && !error && (
          <TileGrid>{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={132} style={{ borderRadius: radius.card }} />)}</TileGrid>
        )}

        {data && shown.length === 0 && (
          <EmptyState icon={IconKit} title="No systems match" detail="Try another place or search." />
        )}

        {shown.length > 0 && (
          <TileGrid>
            {arrange(shown).map(g => (
              <SystemTile key={g.key} group={g} onOpen={() => setOpenSystem(g.key)}
                onGrab={e => startDrag(g, e)} lifted={dragging?.group.key === g.key} target={dragging?.over?.tile === g.key} />
            ))}
          </TileGrid>
        )}
        {data && shown.length > 1 && (
          <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.sm }}>
            Press and hold a system to change the order.
          </div>
        )}

        {dragging && (
          <div aria-hidden="true" style={{
            position: 'fixed', left: dragging.x - 70, top: dragging.y - 24, width: 140, zIndex: 4000, pointerEvents: 'none',
            ...card(), padding: space.sm, background: colour.surface, boxShadow: '0 8px 24px rgba(4,39,70,0.25)', transform: 'rotate(-2deg)',
            ...text('bodyStrong'), color: colour.ink
          }}>{dragging.group.name}</div>
        )}
      </div>

      {settings && (
        <KitSettings data={data} kits={kits} busy={busy} onClose={() => setSettings(false)}
          onEmails={on => act('emails', () => post('settings', { emailsOn: on }))}
          onCouriers={() => setEditingCouriers(true)}
          onAgreements={() => setAttaching(true)}
          onFill={() => setFilling(true)}
          onReset={() => {
            if (!window.confirm('Put every tray back where it lives? Nobody is emailed.')) return
            act('reset', () => post('reset-all', {}))
          }}
          history={<HistoryLink user={user} />} />
      )}
      {editingCouriers && <CourierNumbers couriers={data?.couriers || []} post={post} onClose={() => setEditingCouriers(false)} onSaved={load} />}
      {filling && <FillAgreements post={post} onClose={() => setFilling(false)} onDone={load} />}
      {attaching && <AttachAgreements user={user} post={post} onClose={() => setAttaching(false)} onDone={load} />}
      {/* Stays open under the move sheet: closing it as the sheet opened took
          the sheet's back-button step with it, and Move did nothing (Brent,
          20 Nov 2026). */}
      {openGroup && (
        <SystemDetail key={openGroup.key} system={openGroup} distributor={DISTRIBUTORS[distributorOf(openGroup.kits[0])]?.name || ''} place={place} onRenamed={to => setOpenSystem(to.toLowerCase())} canEdit={Boolean(data?.canEdit)} user={user} post={post}
          onClose={() => setOpenSystem('')} onChanged={load}
          onAddTray={() => setAddingTray({ system: openGroup })}
          onMoveTray={(kit, trays, to = '') => { setMoveTo(to); setMoveTrays(trays); setMoving(kit) }}
          onMoveKit={kit => { setMoveTo(''); setMoveTrays(null); setMoving(kit) }}
          onKitDetails={kit => { setOpenFocus(''); setOpen(kit) }} />
      )}
      {addingTray && (
        <AddTraySheet system={addingTray.system} systems={systems} post={post}
          onClose={() => setAddingTray(null)} onDone={load} />
      )}
      {moving && (
        <MoveSheet kit={{ ...moving, name: setLabel(moving) || systemOf(moving), at: moveTrays?.length ? movingFrom(moving, moveTrays) : moving.at }} initialTo={moveTo} initialTrays={moveTrays} couriers={data?.couriers || []} onMoved={load} user={user} emailsOn={Boolean(data?.settings?.emailsOn)} today={data?.today}
          post={post} onClose={() => setMoving(null)} onDone={() => { setMoving(null); load() }} />
      )}
      {open && (
        <KitDetail key={open.id || 'new'} kit={(open.id && kits.find(k => k.id === open.id)) || open} canEdit={Boolean(data?.canEdit)}
          canRemove={Boolean(data?.canRemove)} focus={openFocus} user={user} post={post}
          onClose={() => setOpen(null)} onChanged={load}
          onMove={(tray = '') => { setMoveTo(''); setMoveTrays(tray ? [tray] : null); setMoving(kits.find(k => k.id === open.id) || open) }} />
      )}
    </Page>
  )
}

// ─── Tiles, not rows ─────────────────────────────────────────────────────────
// "The tabs in a list are hard to find. I'd prefer tiles on the page or similar
// so you can see more kits on the screen at once." — Brent, 2 Nov 2026.
//
// Two across on a phone, as many as fit on a wider screen. The logo leads,
// because it is what the eye finds first on a shelf of trays; within each place
// the kits run distributor by distributor, so the logos fall into runs and a
// kit is found by its maker before its name is read.

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

/**
 * One system (option C, Brent 21 Nov 2026): its distributor, its name, a bar
 * of where its trays are — Calvary, RHH, the office — the same in words, and
 * a line for anything away from home, said as where it is now.
 */
function SystemTile({ group, onOpen, onGrab, lifted, target }) {
  const hold = useHold(onGrab)
  const first = group.kits[0]
  const dist = DISTRIBUTORS[distributorOf(first)]
  const brand = brandFor(group.name)
  const where = traysByPlace(group.kits)
  const total = Object.values(where).reduce((a, b) => a + b, 0)
  const away = awayLines(group.kits)
  const moving = away.length
  const checked = group.kits.filter(k => k.checkedAt).length
  const allChecked = checked === group.kits.length
  const words = PLACE_ORDER.filter(p => p in where)
    .map(p => `${p === 'office' ? 'Office' : PLACE_NAMES[p]} ${where[p] || 0}`).join(' · ')
  return (
    <div data-system-tile={group.key} {...hold} style={{
      ...card(), display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0,
      opacity: lifted ? 0.4 : 1, WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
      boxShadow: target ? `0 0 0 2px ${colour.accent}` : undefined
    }}>
      <button onClick={onOpen} aria-label={`Open ${group.name}`} style={{
        background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer',
        padding: 0, flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch'
      }}>
        {/* Option B (Brent, 21 Nov 2026): the system's picture across the top. */}
        <div data-tile-art style={{ display: 'grid', height: 88, background: '#ffffff', borderBottom: border.hairlineSoft }}>
          {brand.pic
            ? <img src={brand.pic} alt="" draggable={false} loading="lazy" style={{ gridArea: '1 / 1', width: '100%', height: 88, objectFit: 'contain', pointerEvents: 'none' }} />
            : <span aria-hidden="true" style={{ gridArea: '1 / 1', placeSelf: 'center', ...text('display'), color: brand.ink || colour.accentDeep }}>{brand.initial}</span>}
        </div>
        <div style={{ padding: `${space.sm}px ${space.md}px ${space.md}px`, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {/* The maker as its logo where we have one, beside the text, never over
            the picture (Brent, 21 Nov 2026: the SeaSpine logo covered the
            screw); else its name in its colour. */}
        {brand.logo
          ? <div data-tile-maker style={{ height: 24, display: 'flex', alignItems: 'center', alignSelf: 'flex-start' }}>
              <span style={{ display: 'flex', alignItems: 'center',
                ...(brand.logoBg && brand.logoBg.toLowerCase() !== '#ffffff' ? { background: brand.logoBg, borderRadius: 4, padding: '2px 5px' } : {}) }}>
                <img data-tile-logo src={brand.logo} alt={brand.maker} draggable={false} style={{ height: brand.logoH - (brand.logoBg && brand.logoBg.toLowerCase() !== '#ffffff' ? 4 : 0), width: 'auto', maxWidth: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
              </span>
            </div>
          : <div data-tile-maker style={{ ...text('micro'), textTransform: 'uppercase', letterSpacing: '0.6px', color: brand.ink || colour.inkFaint,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand.maker || dist?.name || 'No distributor'}</div>}
        <div style={{ ...text('heading'), color: colour.ink, lineHeight: 1.2,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{tileName(group.name)}</div>
        <div aria-hidden="true" data-place-bar style={{ display: 'flex', height: 8, borderRadius: radius.pill, overflow: 'hidden', background: colour.lineSoft }}>
          {total > 0 && PLACE_ORDER.filter(p => where[p]).map(p => (
            <div key={p} style={{ width: `${(where[p] / total) * 100}%`, background: site[p].ink }} />
          ))}
        </div>
        <div style={{ ...text('caption'), color: colour.inkMuted }}>{total ? words : 'No trays listed yet'}</div>
        {away.map(line => <div key={line} data-away-line style={{ ...text('caption'), fontWeight: 600, color: colour.warning }}>{line}</div>)}
        {allChecked && !moving && <div style={{ ...text('caption'), fontWeight: 600, color: colour.accentDeep }}>✓ checked</div>}
        </div>
      </button>
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

const linkButton = { background: 'none', border: 'none', padding: 0, color: colour.accentDeep, cursor: 'pointer', ...text('caption'), fontWeight: 600 }
