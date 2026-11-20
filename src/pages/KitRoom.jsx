import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Page, Header, Banner, EmptyState, Skeleton } from '../design/Shell.jsx'
import { colour, text, space, radius, border, card, site } from '../design/tokens.js'
import { IconKit, IconSearch } from '../design/icons.jsx'
import MoveSheet from './kit/MoveSheet.jsx'
import KitDetail from './kit/KitDetail.jsx'
import AttachAgreements from './kit/AttachAgreements.jsx'
import SystemDetail from './kit/SystemDetail.jsx'
import AddTraySheet from './kit/AddTraySheet.jsx'
import CourierNumbers from './kit/CourierNumbers.jsx'
import { groupSystems, traysByPlace, systemOf, setLabel, PLACE_ORDER } from '../kit/systems.js'
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

export default function KitRoom({ user, onBack, openKit = '' }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [place, setPlace] = useState('all')
  const [query, setQuery] = useState('')
  const [distributor, setDistributor] = useState('')
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
  const [editingCouriers, setEditingCouriers] = useState(false)
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
    && (!distributor || g.kits.some(k => distributorOf(k) === distributor))
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

  const presentDistributors = [...new Set(kits.map(distributorOf).filter(Boolean))]
  const openGroup = openSystem && systems.find(g => g.key === openSystem)
  const awaySets = kits.filter(k => k.away).length

  return (
    <Page>
      <Header eyebrow="Kit and stock" title="Kit room" onBack={onBack}
        subtitle={data ? `${systems.length} systems · ${kits.reduce((n, k) => n + (k.trays || []).length, 0)} trays${awaySets ? ` · ${awaySets} away from home` : ''}` : 'Loading…'} />
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
            <div style={{ ...text('bodyStrong'), color: colour.ink }}>Stock-take: {kits.length - unchecked} of {kits.length} hospital sets checked</div>
            <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>
              Open a system and tap <strong>It's here</strong> beside each hospital's trays you can see — it turns green.
              A tray somewhere else: Move it to where it really is.
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
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search systems or trays"
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

        {data?.canEdit && (
          <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', marginBottom: space.md }}>
            <button onClick={() => setAddingTray({ system: null })} data-add-tray style={pill(true)}>+ Add a tray</button>
          </div>
        )}

        {!data && !error && (
          <TileGrid>{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={132} style={{ borderRadius: radius.card }} />)}</TileGrid>
        )}

        {data && shown.length === 0 && (
          <EmptyState icon={IconKit} title="No systems match" detail="Try another place, distributor or search." />
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

        {data?.canRemove && (
          <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', marginTop: space.lg }}>
            <button onClick={() => setAttaching(true)} data-attach-agreements style={pill(false)}>Attach agreements from Dropbox</button>
            <button onClick={() => setEditingCouriers(true)} data-courier-numbers style={pill(false)}>Courier numbers</button>
            {/* Brent, 20 Nov 2026: "reset all trays to their original locations in one tap". */}
            <button data-reset-all disabled={busy === 'reset' || !awaySets && !kits.some(k => Object.keys(k.trayAt || {}).length)}
              onClick={() => {
                if (!window.confirm('Put every tray back where it lives? Nobody is emailed.')) return
                act('reset', () => post('reset-all', {}))
              }} style={pill(false)}>{busy === 'reset' ? 'Resetting…' : 'Reset all trays to home'}</button>
          </div>
        )}

        {data && <HistoryLink user={user} />}
      </div>

      {editingCouriers && <CourierNumbers couriers={data?.couriers || []} post={post} onClose={() => setEditingCouriers(false)} onSaved={load} />}
      {attaching && <AttachAgreements user={user} post={post} onClose={() => setAttaching(false)} onDone={load} />}
      {/* Stays open under the move sheet: closing it as the sheet opened took
          the sheet's back-button step with it, and Move did nothing (Brent,
          20 Nov 2026). */}
      {openGroup && (
        <SystemDetail key={openGroup.key} system={openGroup} place={place} canEdit={Boolean(data?.canEdit)} user={user} post={post}
          onClose={() => setOpenSystem('')} onChanged={load}
          onAddTray={() => setAddingTray({ system: openGroup })}
          onMoveTray={(kit, trays) => { setMoveTo(''); setMoveTrays(trays); setMoving(kit) }}
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

/** One system: its logo, name, trays and where they are. */
function SystemTile({ group, onOpen, onGrab, lifted, target }) {
  const hold = useHold(onGrab)
  const first = group.kits[0]
  const dist = DISTRIBUTORS[distributorOf(first)]
  const logo = SYSTEM_LOGOS[group.name] || logoFor(first)
  const where = traysByPlace(group.kits)
  const total = Object.values(where).reduce((a, b) => a + b, 0)
  const awaySets = group.kits.filter(k => k.away).length
  const checked = group.kits.filter(k => k.checkedAt).length
  const allChecked = checked === group.kits.length
  return (
    <div data-system-tile={group.key} {...hold} style={{
      ...card(), display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, position: 'relative',
      opacity: lifted ? 0.4 : 1, WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none',
      boxShadow: target ? `0 0 0 2px ${colour.accent}` : undefined,
      borderTop: `3px solid ${awaySets ? colour.warning : allChecked ? colour.accent : colour.line}`
    }}>
      <button onClick={onOpen} aria-label={`Open ${group.name}`} style={{
        background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer',
        padding: space.sm, flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'stretch'
      }}>
        <div style={{ height: 34, marginBottom: 6, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
          {logo
            ? <img src={logo} alt={dist?.name || ''} style={{ maxWidth: '78%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ ...text('micro'), color: colour.navy, letterSpacing: '0.6px' }}>{(dist?.name || group.name).toUpperCase()}</span>}
        </div>
        <div style={{ ...text('bodyStrong'), color: colour.ink, lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {group.name}
        </div>
        <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>{total} {total === 1 ? 'tray' : 'trays'}</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {/* Trays at each place — "RHH · 4 trays" (Brent, 21 Nov 2026: "what do
              the numbers … mean?"). A set with none listed yet says so. */}
          {PLACE_ORDER.filter(p => p in where).map(p => (
            <span key={p} style={{ ...text('caption'), fontWeight: 600, padding: '1px 6px', borderRadius: radius.pill,
              background: site[p].soft, color: site[p].ink, border: `1px solid ${site[p].line}`, whiteSpace: 'nowrap' }}>
              {p === 'office' ? 'Office' : PLACE_NAMES[p]} · {where[p] ? `${where[p]} ${where[p] === 1 ? 'tray' : 'trays'}` : 'no trays listed'}
            </span>
          ))}
        </div>
        {awaySets > 0 && <div style={{ ...text('caption'), color: colour.warning, fontWeight: 600, marginTop: 4 }}>Trays away from home</div>}
        {allChecked && !awaySets && <div style={{ ...text('caption'), color: colour.accentDeep, fontWeight: 600, marginTop: 4 }}>✓ checked</div>}
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
