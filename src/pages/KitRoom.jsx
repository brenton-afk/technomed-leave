import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Page, Header, Banner, EmptyState, Skeleton } from '../design/Shell.jsx'
import { colour, text, space, radius, border, card } from '../design/tokens.js'
import { IconKit, IconSearch } from '../design/icons.jsx'
import MoveSheet from './kit/MoveSheet.jsx'
import KitDetail from './kit/KitDetail.jsx'
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

export const PLACE_NAMES = { office: 'TM office', CLV: 'Calvary', RHH: 'RHH' }
const PLACE_ORDER = ['office', 'CLV', 'RHH']

export const DISTRIBUTORS = {
  signus: { name: 'Signus', logo: '/logos/signus.png' },
  e4: { name: 'E4 Surgical', logo: '/logos/e4surgical.png' },
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
  const [busy, setBusy] = useState('')
  const headers = { Authorization: `Bearer ${user?.token || ''}` }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/guides?kits=list', { headers })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not load the kit room')
      setData(json); setError('')
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
  const away = shown.filter(k => k.away)
  const home = shown.filter(k => !k.away)
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
                  background: on ? colour.navy : colour.surface, borderColor: on ? colour.navy : colour.line
                }}>
                <div style={{ ...text('title'), color: on ? 'white' : colour.ink }}>{data ? counts[p] : '–'}</div>
                <div style={{ ...text('caption'), color: on ? 'rgba(255,255,255,0.75)' : colour.inkFaint }}>{PLACE_NAMES[p]}</div>
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
              {byDistributor(away).map(k => (
                <KitTile key={k.id} kit={k} onOpen={() => setOpen(k)}
                  onMove={() => setMoving(k)} busy={busy === k.id}
                  onReturn={() => act(k.id, () => post('return', { kitId: k.id }))} />
              ))}
            </TileGrid>
          </>
        )}

        {PLACE_ORDER.filter(p => home.some(k => k.at === p)).map(p => (
          <div key={p}>
            <SectionTitle>{PLACE_NAMES[p]} · {home.filter(k => k.at === p).length}</SectionTitle>
            <TileGrid>
              {byDistributor(home.filter(k => k.at === p)).map(k => (
                <KitTile key={k.id} kit={k} onOpen={() => setOpen(k)} onMove={() => setMoving(k)} busy={busy === k.id}
                  onCheck={() => act(k.id, () => post('check', { kitId: k.id, at: k.at }))} />
              ))}
            </TileGrid>
          </div>
        ))}

        {data?.canEdit && (
          <button onClick={() => setOpen({ id: '', name: '', trays: [] })} style={{ ...pill(false), marginTop: space.lg }}>+ Add a kit</button>
        )}

        {data && <HistoryLink user={user} />}
      </div>

      {moving && (
        <MoveSheet kit={moving} user={user} emailsOn={Boolean(data?.settings?.emailsOn)} today={data?.today}
          post={post} onClose={() => setMoving(null)} onDone={() => { setMoving(null); load() }} />
      )}
      {open && (
        <KitDetail key={open.id || 'new'} kit={(open.id && kits.find(k => k.id === open.id)) || open} canEdit={Boolean(data?.canEdit)} user={user} post={post}
          onClose={() => setOpen(null)} onChanged={load}
          onMove={() => { setMoving(kits.find(k => k.id === open.id) || open); setOpen(null) }} />
      )}
    </Page>
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

function KitTile({ kit, onOpen, onMove, onReturn, onCheck, busy }) {
  const dist = DISTRIBUTORS[distributorOf(kit)]
  const logo = logoFor(kit)
  const trayCount = (kit.trays || []).length
  const awayTrays = kit.away?.trays?.length
  const checked = !kit.away && kit.checkedAt
  const status = kit.away
    ? `At ${PLACE_NAMES[kit.at]} · ${sinceText(kit.away.since)}${awayTrays && awayTrays < trayCount ? ` · ${awayTrays}/${trayCount} trays` : ''}`
    : `${KIND[kit.kind] || ''}${trayCount ? ` · ${trayCount} ${trayCount === 1 ? 'tray' : 'trays'}` : ''}`
  const small = { ...pill(false), padding: '5px 8px', flex: 1, textAlign: 'center' }

  return (
    <div style={{
      ...card(), display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0,
      borderTop: `3px solid ${kit.away ? colour.warning : checked ? colour.accent : colour.line}`,
      ...(checked ? { background: colour.successSoft } : {})
    }}>
      <button onClick={onOpen} aria-label={`Open ${kit.name}`} style={{
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

const linkButton = { background: 'none', border: 'none', padding: 0, color: colour.accentDeep, cursor: 'pointer', ...text('caption'), fontWeight: 600 }
