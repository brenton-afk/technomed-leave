import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Page, Header, Banner, EmptyState, Skeleton } from '../design/Shell.jsx'
import { colour, text, space, radius, border, card } from '../design/tokens.js'
import { IconKit, IconSearch } from '../design/icons.jsx'
import MoveSheet from './kit/MoveSheet.jsx'
import KitDetail from './kit/KitDetail.jsx'
import { inventoryFor } from '../clinicalPlan/inventory.js'

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

/** The distributor, from the kit or else from what the inventory says it is. */
export function distributorOf(kit) {
  return kit.distributor || inventoryFor(kit.system)?.distributor || ''
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
              Open each kit where it sits and tap <strong>It's here</strong>, or pick where it really is.
              This is what makes the emails right.
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

        {!data && !error && [0, 1, 2, 3].map(i => <Skeleton key={i} height={64} style={{ borderRadius: radius.card }} />)}

        {data && shown.length === 0 && (
          <EmptyState icon={IconKit} title="No kits match" detail="Try another place, distributor or search." />
        )}

        {away.length > 0 && (
          <>
            <SectionTitle>Away from home · {away.length}</SectionTitle>
            {away.map(k => (
              <KitCard key={k.id} kit={k} onOpen={() => setOpen(k)}
                onMove={() => setMoving(k)} busy={busy === k.id}
                onReturn={() => act(k.id, () => post('return', { kitId: k.id }))} />
            ))}
          </>
        )}

        {PLACE_ORDER.filter(p => home.some(k => k.at === p)).map(p => (
          <div key={p}>
            <SectionTitle>{PLACE_NAMES[p]} · {home.filter(k => k.at === p).length}</SectionTitle>
            {home.filter(k => k.at === p).map(k => (
              <KitCard key={k.id} kit={k} onOpen={() => setOpen(k)} onMove={() => setMoving(k)} busy={busy === k.id} />
            ))}
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

function KitCard({ kit, onOpen, onMove, onReturn, busy }) {
  const dist = DISTRIBUTORS[distributorOf(kit)]
  const logo = logoFor(kit)
  const trayCount = (kit.trays || []).length
  const awayTrays = kit.away?.trays?.length
  return (
    <div style={{ ...card(), marginBottom: space.sm, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 4, background: kit.away ? colour.warning : kit.checkedAt ? colour.accent : colour.line }} />
      <button onClick={onOpen} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', textAlign: 'left',
        padding: `${space.md}px`, cursor: 'pointer', display: 'flex', gap: space.md, alignItems: 'center' }}>
        {/* Wide rather than square: every one of these is a wordmark, and a
            wordmark squeezed into a square tile is a smudge. */}
        <div style={{ width: 64, height: 40, flexShrink: 0, borderRadius: radius.control, background: colour.canvas,
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 4, boxSizing: 'border-box' }}>
          {logo
            ? <img src={logo} alt={dist?.name || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ ...text('micro'), color: colour.navy, textAlign: 'center' }}>{(dist?.name || kit.system).split(/[\s/]+/)[0].slice(0, 6).toUpperCase()}</span>}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...text('bodyStrong'), color: colour.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kit.name}</div>
          <div style={{ ...text('caption'), color: kit.away ? colour.warning : colour.inkFaint }}>
            {kit.away
              ? `At ${PLACE_NAMES[kit.at]} · ${sinceText(kit.away.since)}${awayTrays && awayTrays < trayCount ? ` · ${awayTrays}/${trayCount} trays` : ''}`
              : `${KIND[kit.kind] || ''}${trayCount ? ` · ${trayCount} trays` : ''}${kit.checkedAt ? '' : ' · not checked'}`}
          </div>
        </div>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: space.md }}>
        {kit.away && onReturn && (
          <button onClick={onReturn} disabled={busy} style={pill(false)}>{busy ? '…' : 'Returned'}</button>
        )}
        <button onClick={onMove} style={pill(true)}>Move</button>
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
