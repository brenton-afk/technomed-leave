import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Page, Header, Body, Banner, EmptyState, Skeleton, Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius, border } from '../design/tokens.js'
import { IconFolder } from '../design/icons.jsx'
import DocViewer from '../kit/DocViewer.jsx'
import { hasDoc } from '../kit/docCache.js'

// ─── Resources (Brent, 12 Nov 2026) ──────────────────────────────────────────
// "The items I want in there are the ARTG certificates, the full surgical
// techniques, the rebate codes and prices and a tray list." One card per
// system we carry, grouped by distributor, four buttons on each. The files are
// the ones already in Dropbox (api/_resources.js finds them by name and links
// them where they are); "Change" picks another, or says there is none, for
// everyone. The tray list opens the system's kit in the Kit room.

export const SLOT_LABELS = { artg: 'ARTG', technique: 'Surgical technique', rebate: 'Rebate codes & prices' }

export default function Resources({ user, onOpenKit }) {
  const headers = { Authorization: `Bearer ${user?.token || ''}` }
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [viewing, setViewing] = useState(null)
  const [opening, setOpening] = useState('')
  const [changing, setChanging] = useState(null) // { system, distributor, slot }
  const [choices, setChoices] = useState(null)
  const [note, setNote] = useState('')

  const load = useCallback(async (fresh = false) => {
    try {
      const res = await fetch(`/api/guides?resources=list${fresh ? '&fresh=1' : ''}`, { headers })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not load the resources')
      setData(json); setError('')
    } catch (err) { setError(err.message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])
  useEffect(() => { load() }, [load])

  async function open(file) {
    setOpening(file.path); setNote('')
    // Already on this phone (and still the current version): open it with no
    // trip to Dropbox at all (Brent, 12 Nov 2026: "super quick").
    if (file.rev && await hasDoc(file.path, file.rev)) {
      setViewing({ name: file.name, url: '', path: file.path, rev: file.rev })
      setOpening('')
      return
    }
    try {
      const res = await fetch(`/api/guides?resources=open&path=${encodeURIComponent(file.path)}`, { headers })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not open that file')
      setViewing({ name: file.name, url: json.url, path: json.path || file.path, rev: json.rev || '' })
    } catch (err) { setNote(err.message) }
    setOpening('')
  }

  async function startChange(sys, slot) {
    setChanging({ system: sys.system, distributor: sys.distributor, slot, current: sys.slots[slot] }); setChoices(null)
    try {
      const res = await fetch(`/api/guides?resources=files&distributor=${encodeURIComponent(sys.distributor)}&slot=${slot}`, { headers })
      const json = await res.json().catch(() => ({}))
      setChoices(json.files || [])
    } catch { setChoices([]) }
  }
  async function pick(path) {
    const c = changing
    setChanging(null)
    try {
      const res = await fetch('/api/guides?resources=pick', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: c.system, slot: c.slot, path })
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not save that')
      await load()
    } catch (err) { setNote(err.message) }
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = []
    for (const s of data?.systems || []) {
      if (q && !`${s.system} ${s.distributorName}`.toLowerCase().includes(q)) continue
      let g = out.find(x => x.name === s.distributorName)
      if (!g) out.push(g = { name: s.distributorName, systems: [] })
      g.systems.push(s)
    }
    return out
  }, [data, query])

  const chip = on => ({
    ...text('caption'), fontWeight: 700, minHeight: 40, padding: `0 ${space.sm}px`, borderRadius: radius.control, cursor: on ? 'pointer' : 'default',
    border: on ? `1px solid ${colour.accent}` : `1px dashed ${colour.line}`, background: on ? colour.accentSoft : colour.canvas,
    color: on ? colour.accentDeep : colour.inkFaint, textAlign: 'left', width: '100%', minWidth: 0, padding: `6px ${space.sm}px`
  })
  const link = { ...text('caption'), border: 'none', background: 'none', color: colour.inkFaint, cursor: 'pointer', padding: '2px 0', textDecoration: 'underline' }

  return (
    <Page>
      <Header eyebrow="Reference" title="Resources" subtitle="ARTG, surgical techniques, rebate codes and tray lists for every system we carry" />
      <Body>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a system or distributor" aria-label="Find a system"
          style={{ ...text('body'), fontSize: 16, width: '100%', boxSizing: 'border-box', padding: `${space.xs}px ${space.sm}px`, border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink, marginBottom: space.sm }} />
        {error && <Banner tone="danger">{error}</Banner>}
        {note && <div role="status" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{note}</div>}
        {!data && !error && <div style={{ display: 'grid', gap: space.sm }}>{[0, 1, 2].map(i => <Skeleton key={i} height={92} />)}</div>}
        {data && groups.length === 0 && <EmptyState icon={IconFolder} title="Nothing matches" detail="Try another name." />}

        {groups.map(g => (
          <section key={g.name} style={{ marginBottom: space.md }}>
            <div style={{ ...text('caption'), fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.sm}px 0 ${space.xs}px` }}>{g.name}</div>
            {g.systems.map(s => (
              <div key={s.system} data-resource-system={s.system}
                style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.sm, marginBottom: space.xs }}>
                <div style={{ ...text('heading'), color: colour.ink, marginBottom: space.xs }}>{s.system}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(SLOT_LABELS).map(([slot, label]) => {
                    const f = s.slots[slot]?.file
                    return (
                      <div key={slot} style={{ display: 'flex', flexDirection: 'column', flex: '1 1 140px', minWidth: 0 }}>
                        <button type="button" data-resource-slot={slot} disabled={!f || opening === f?.path} onClick={() => f && open(f)} style={chip(Boolean(f))}
                          title={f?.name || ''}>
                          {opening && opening === f?.path ? 'Opening…' : label}
                          <span style={{ display: 'block', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f ? f.name : s.slots[slot]?.none ? 'None' : 'Not found'}
                          </span>
                        </button>
                        {data.canEdit && <button type="button" onClick={() => startChange(s, slot)} style={link}>{f ? 'Change' : 'Choose a file'}</button>}
                      </div>
                    )
                  })}
                  <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 140px', minWidth: 0 }}>
                    {s.trays.length ? s.trays.map(k => (
                      <button key={k.id} type="button" data-resource-slot="trays" onClick={() => onOpenKit?.(k.id)} style={{ ...chip(true), marginBottom: 4 }}>
                        Tray list
                        <span style={{ display: 'block', fontWeight: 400 }}>{k.name} · {k.trays} tray{k.trays === 1 ? '' : 's'}</span>
                      </button>
                    )) : (
                      <button type="button" data-resource-slot="trays" disabled style={chip(false)}>
                        Tray list<span style={{ display: 'block', fontWeight: 400 }}>Not uploaded yet — Kit room</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </section>
        ))}
        {data && <button type="button" onClick={() => { setData(null); load(true) }} style={link}>Look in Dropbox again</button>}
      </Body>

      {changing && (<Overlay>
        <div role="dialog" aria-label={`Choose the ${SLOT_LABELS[changing.slot]}`} onClick={() => setChanging(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 3600, background: 'rgba(4,39,70,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: colour.surface, width: '100%', maxWidth: 640, maxHeight: '80dvh', overflowY: 'auto', overflowX: 'hidden', borderRadius: `${radius.card}px ${radius.card}px 0 0`, padding: space.md, paddingBottom: `calc(${space.md}px + env(safe-area-inset-bottom, 0px))` }}>
            <div style={{ ...text('heading'), color: colour.ink }}>{changing.system} — {SLOT_LABELS[changing.slot]}</div>
            <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>Pick the right file for everyone. Files from this distributor's Dropbox folder.</div>
            {choices === null && <Skeleton height={40} />}
            {choices?.length === 0 && <div style={{ ...text('body'), color: colour.inkMuted }}>No {SLOT_LABELS[changing.slot]} files found for this distributor.</div>}
            {(choices || []).map(c => (
              <button key={c.path} type="button" onClick={() => pick(c.path)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: `${space.xs}px 0`, border: 'none', borderBottom: border.hairlineSoft, background: 'none', cursor: 'pointer' }}>
                <span style={{ ...text('bodyStrong'), color: c.path === changing.current?.file?.path ? colour.accentDeep : colour.ink, display: 'block' }}>{c.path === changing.current?.file?.path ? '✓ ' : ''}{c.name}</span>
                <span style={{ ...text('caption'), color: colour.inkFaint }}>{c.path.split('/').slice(2, -1).join(' › ')}</span>
              </button>
            ))}
            <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => pick('none')} style={link}>There isn't one</button>
              {changing.current?.picked && <button type="button" onClick={() => pick(null)} style={link}>Let the portal choose</button>}
              <button type="button" onClick={() => setChanging(null)} style={link}>Cancel</button>
            </div>
          </div>
        </div>
      </Overlay>)}
      {viewing && <DocViewer name={viewing.name} url={viewing.url} path={viewing.path} rev={viewing.rev} onClose={() => setViewing(null)} />}
    </Page>
  )
}
