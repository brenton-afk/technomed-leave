import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face, site } from '../../design/tokens.js'
import { displayName } from '../../kit/brands.js'
import { useBackLayer } from '../../backButton.js'
import TrayList from './TrayList.jsx'
import KitDocs from './KitDocs.jsx'
import { PLACE_ORDER, setLabel, traysByPlace, caseFor } from '../../kit/systems.js'

// ─── One system: every tray, by the shelf it is on ──────────────────────────
// Brent, 21 Nov 2026, from the layouts he picked ("Inside a system"): a plain
// header — the system's name with Rename, its distributor and tray count,
// + Add a tray and Documents — then one section per place, "On the shelf at
// Calvary · 5". A set's trays are listed where the set is; a tray moved on
// its own is listed where it now is, marked with where it came from and a
// Back button, and its own set says it is away. Each row is a tick, the name
// and what it holds; opening it shows Move, Edit and Print. Tick several and
// the bar at the bottom moves them together.

const PLACES = { CLV: 'Calvary', RHH: 'RHH', office: 'TM office' }

export default function SystemDetail({ system, distributor = '', canEdit, user, post, onClose, onChanged, onMoveTray, onMoveKit, onAddTray, onKitDetails, onRenamed, place = 'all' }) {
  useBackLayer(true, onClose)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [docs, setDocs] = useState(false)
  // Rename the system itself — the name on its tile (Brent, 21 Nov 2026).
  const [naming, setNaming] = useState(null)
  async function rename() {
    const to = String(naming || '').trim()
    if (!to || to === system.name) { setNaming(null); return }
    setBusy('rename'); setError('')
    try { await post('rename-system', { from: system.name, to }); setNaming(null); onRenamed?.(to); await onChanged?.() } catch (err) { setError(err.message) }
    setBusy('')
  }
  // Opened from a hospital's filter, the system shows that hospital's trays
  // only (Brent, 20 Nov 2026); the rest are one tap away.
  const [showAll, setShowAll] = useState(!place || place === 'all')
  const here = p => showAll || p === place
  // Ticked trays, one hospital set at a time (a move is one set's trays).
  const [picked, setPicked] = useState({ kitId: '', trays: [] })
  const toggle = (kit, tray) => setPicked(p => {
    if (p.kitId !== kit.id) return { kitId: kit.id, trays: [tray] }
    const trays = p.trays.includes(tray) ? p.trays.filter(t => t !== tray) : [...p.trays, tray]
    return { kitId: trays.length ? kit.id : '', trays }
  })
  const selectedFor = kit => new Set(picked.kitId === kit.id ? picked.trays : [])
  const pickedKit = system.kits.find(k => k.id === picked.kitId)

  const awayFrom = kit => Object.keys(kit.trayAt || {})
  const when = iso => (iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', weekday: 'short', day: 'numeric', month: 'short' }) : '')
  // A TM loan set has no hospital of its own: it is "the TM loan set" wherever it is.
  const setName = kit => (kit.kind === 'floating'
    ? `${setLabel(kit) ? `${setLabel(kit)} ` : ''}TM loan set`
    : `${PLACES[kit.home] || kit.home}${setLabel(kit) ? ` ${setLabel(kit)}` : ''} set`)
  const counts = traysByPlace(system.kits)
  const trayCount = system.kits.reduce((n, k) => n + (k.trays || []).length, 0)

  // Each place: the sets that are there, and trays from other sets moved in.
  const places = PLACE_ORDER.filter(here).map(p => ({
    place: p,
    sets: system.kits.filter(k => k.at === p),
    movedIn: system.kits.filter(k => k.at !== p)
      .map(kit => ({ kit, trays: Object.entries(kit.trayAt || {}).filter(([, at]) => at.at === p).map(([t]) => t) }))
      .filter(g => g.trays.length)
  })).filter(x => x.sets.length || x.movedIn.length)

  async function check(kit) {
    setBusy(kit.id); setError('')
    try { await post('check', { kitId: kit.id, at: kit.at }); await onChanged?.() } catch (err) { setError(err.message) }
    setBusy('')
  }

  const pillBtn = on => ({ ...text('caption'), fontWeight: 600, padding: '6px 12px', borderRadius: radius.pill, cursor: 'pointer', whiteSpace: 'nowrap', ...(on ? face.primary : face.secondary) })
  const bigBtn = on => ({ ...text('bodyStrong'), padding: `${space.sm + 2}px ${space.md}px`, borderRadius: radius.control, cursor: 'pointer', ...(on ? face.navy : face.secondary) })
  const amber = { background: colour.warningSoft, border: `1px solid ${colour.warningLine}`, borderRadius: radius.control }
  // A set belongs to a hospital when it lives there and is not a loan set; at
  // the office every TechnoMed set is at home.
  const isOwn = (kit, p) => (p === 'office' ? kit.home === 'office' : kit.home === p && kit.kind !== 'floating')
  const setNote = (kit, p) => (kit.kind === 'floating'
    ? (p === 'office' ? 'TechnoMed loan set, at home' : `TechnoMed loan set, on loan to ${PLACES[p]}`)
    : kit.home === p ? `Consigned to ${PLACES[p]}` : `Borrowed from ${PLACES[kit.home] || kit.home}`)
  const setCard = loan => ({ background: colour.surface, borderRadius: radius.card, overflow: 'clip',
    border: loan ? `1.5px solid ${colour.warningLine}` : border.hairline, boxShadow: '0 1px 2px rgba(4,39,70,0.06)' })
  const setHead = loan => ({ padding: `${space.sm + 2}px ${space.md}px`, marginBottom: space.xs,
    background: loan ? colour.warningSoft : colour.accentSoft, borderBottom: loan ? `1px solid ${colour.warningLine}` : border.hairlineSoft })
  const kindChip = loan => ({ ...text('micro'), padding: '3px 8px', borderRadius: radius.pill, whiteSpace: 'nowrap',
    background: loan ? colour.warning : colour.accent, color: '#fff' })

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label={system.name} className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 560, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column', overflowX: 'hidden'
        }}>
          <div style={{ padding: space.md, background: colour.surface, borderBottom: border.hairline, display: 'flex', flexDirection: 'column', gap: space.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
              <button onClick={onClose} aria-label="Back to the kit room" style={{
                width: 40, height: 40, borderRadius: radius.control, border: 'none', background: colour.canvas, color: colour.ink,
                cursor: 'pointer', ...text('heading'), flexShrink: 0
              }}>‹</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                {naming === null ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
                    <div style={{ ...text('title'), color: colour.ink }}>{displayName(system.name)}</div>
                    {canEdit && <button onClick={() => setNaming(system.name)} data-rename-system
                      style={{ background: 'none', border: 'none', padding: 0, ...text('caption'), fontWeight: 600, color: colour.accentDeep, cursor: 'pointer' }}>Rename</button>}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: space.sm, alignItems: 'center' }}>
                    <input value={naming} onChange={e => setNaming(e.target.value)} aria-label="System name" autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setNaming(null) }}
                      style={{ flex: 1, minWidth: 0, padding: '8px 10px', ...text('field'), border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }} />
                    <button onClick={rename} disabled={busy === 'rename'} style={pillBtn(true)}>{busy === 'rename' ? '…' : 'Save'}</button>
                  </div>
                )}
                <div style={{ ...text('caption'), color: colour.inkFaint }}>
                  {distributor ? `${distributor} · ` : ''}{trayCount} {trayCount === 1 ? 'tray' : 'trays'}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: canEdit ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: space.sm }}>
              {canEdit && <button onClick={onAddTray} data-add-tray aria-label={`Add a tray to ${system.name}`} style={bigBtn(true)}>+ Add a tray</button>}
              <button onClick={() => setDocs(d => !d)} aria-expanded={docs} data-system-docs style={bigBtn(false)}>{docs ? 'Hide documents' : 'Documents'}</button>
            </div>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}

            {docs && (
              <section data-docs-panel style={{ marginBottom: space.lg, display: 'flex', flexDirection: 'column', gap: space.md }}>
                {system.kits.map(kit => (
                  <div key={kit.id} style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
                      <div style={{ flex: 1, ...text('bodyStrong'), color: colour.ink }}>{setName(kit)}</div>
                      <button onClick={() => onKitDetails?.(kit)} style={pillBtn(false)}>Set details</button>
                    </div>
                    <TrayList kit={kit} canEdit={canEdit} user={user} post={post} onSaved={onChanged} rows={false} />
                    <KitDocs kit={kit} user={user} post={post} onChanged={onChanged} />
                  </div>
                ))}
              </section>
            )}

            {places.map(({ place: p, sets, movedIn }) => {
              const look = site[p] || site.office
              const n = counts[p] || 0
              return (
                <section key={p} data-place-section={p} style={{ marginBottom: space.lg, display: 'flex', flexDirection: 'column', gap: space.xs }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, paddingBottom: 2 }}>
                    <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: look.ink }} />
                    <h3 style={{ margin: 0, flex: 1, ...text('heading'), color: look.ink }}>On the shelf at {PLACES[p]} · {n}</h3>
                  </div>

                  {/* Brent, 21 Nov 2026: "The Calvary set is too small … If there's a
                      loan set at Calvary that needs to be really clear … a
                      consignment section and a loan section." Each set is its
                      own card under a coloured header; what belongs to the
                      hospital first, anything on loan to it after. */}
                  {[
                    { key: 'own', title: p === 'office' ? 'At the office' : 'Consignment', note: p === 'office' ? 'TechnoMed’s own and loan sets' : `${PLACES[p]}’s own sets`, kits: sets.filter(k => isOwn(k, p)), moved: [] },
                    { key: 'loan', title: 'On loan here', note: 'Brought in for a case — goes back afterwards', kits: sets.filter(k => !isOwn(k, p)), moved: movedIn }
                  ].filter(g => g.kits.length || g.moved.length).map(g => (
                    <div key={g.key} data-set-group={g.key} style={{ display: 'flex', flexDirection: 'column', gap: space.sm, marginTop: space.xs }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
                        <span style={{ ...text('micro'), textTransform: 'uppercase', color: g.key === 'loan' ? colour.warning : colour.accentDeep }}>{g.title}</span>
                        <span style={{ ...text('caption'), color: colour.inkFaint }}>{g.note}</span>
                      </div>
                      {g.kits.map(kit => (
                        <div key={kit.id} data-system-set={kit.id} style={{ ...setCard(g.key === 'loan') }}>
                          <div data-set-header style={{ ...setHead(g.key === 'loan') }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ ...text('heading'), color: colour.ink }}>{setName(kit)}</div>
                                <div style={{ ...text('caption'), color: colour.inkMuted }}>
                                  {setNote(kit, p)}{kit.away ? ` · here since ${when(kit.away.since)}` : ''}
                                </div>
                                {caseFor(kit.away) && (
                                  <div data-set-case style={{ ...text('bodyStrong'), color: g.key === 'loan' ? colour.warning : colour.ink, marginTop: 2 }}>
                                    For {caseFor(kit.away)}
                                  </div>
                                )}
                              </div>
                              <span data-set-kind style={{ ...kindChip(g.key === 'loan') }}>{g.key === 'loan' ? 'LOAN' : kit.kind === 'floating' ? 'TM LOAN' : 'CONSIGNMENT'}</span>
                            </div>
                            <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', marginTop: space.sm }}>
                              {!kit.away && (kit.checkedAt
                                ? <span style={{ ...text('caption'), color: colour.accentDeep, fontWeight: 600, alignSelf: 'center' }}>✓ Checked</span>
                                : <button disabled={busy === kit.id} onClick={() => check(kit)} aria-label={`${setName(kit)}: it's here`}
                                    style={{ ...pillBtn(false), border: `1px solid ${colour.accent}`, color: colour.accentDeep }}>{busy === kit.id ? '…' : "It's here"}</button>)}
                              <button onClick={() => onMoveKit?.(kit)} aria-label={`Move all of the ${setName(kit)}`} style={pillBtn(false)}>{g.key === 'loan' ? 'Send it back' : 'Move all'}</button>
                            </div>
                          </div>
                          <div style={{ padding: `0 ${space.sm}px ${space.sm}px`, display: 'flex', flexDirection: 'column', gap: space.xs }}>
                            <TrayList kit={kit} canEdit={canEdit} user={user} post={post} onSaved={onChanged} compact showWhere={false}
                              except={awayFrom(kit)} selected={selectedFor(kit)} onSelect={t => toggle(kit, t)}
                              onMoveTray={tray => onMoveTray?.(kit, [tray])} />
                            {awayFrom(kit).map(t => (
                              <div key={t} data-away-tray style={{ ...amber, display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.md}px` }}>
                                <span style={{ flex: 1, minWidth: 0, ...text('caption'), color: colour.ink }}>
                                  <strong>{t}</strong> is at {PLACES[kit.trayAt[t].at]}{kit.trayAt[t].byName ? ` · moved by ${kit.trayAt[t].byName}` : ''}{kit.trayAt[t].since ? `, ${when(kit.trayAt[t].since)}` : ''}
                                </span>
                                <button onClick={() => onMoveTray?.(kit, [t], kit.at)} aria-label={`Bring ${t} back`} style={pillBtn(true)}>Back</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {g.moved.map(({ kit, trays }) => (
                        <div key={kit.id} data-transferred style={{ ...setCard(true) }}>
                          <div data-set-header style={{ ...setHead(true), display: 'flex', alignItems: 'center', gap: space.sm }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ ...text('heading'), color: colour.ink }}>{trays.length === 1 ? trays[0] : `${trays.length} trays`}</div>
                              <div style={{ ...text('caption'), color: colour.inkMuted }}>
                                From the {setName(kit)}{kit.trayAt[trays[0]]?.byName ? ` · moved by ${kit.trayAt[trays[0]].byName}` : ''}{kit.trayAt[trays[0]]?.since ? `, ${when(kit.trayAt[trays[0]].since)}` : ''}
                              </div>
                              {caseFor(kit.trayAt[trays[0]]) && (
                                <div data-set-case style={{ ...text('bodyStrong'), color: colour.warning, marginTop: 2 }}>For {caseFor(kit.trayAt[trays[0]])}</div>
                              )}
                            </div>
                            <button onClick={() => onMoveTray?.(kit, trays, kit.at)} aria-label={`Send ${trays.join(', ')} back to ${PLACES[kit.at]}`} style={pillBtn(true)}>Back</button>
                          </div>
                          <div style={{ padding: `0 ${space.sm}px ${space.sm}px` }}>
                            <TrayList kit={kit} canEdit={canEdit} user={user} post={post} onSaved={onChanged} compact only={trays} showWhere={false}
                              selected={selectedFor(kit)} onSelect={t => toggle(kit, t)}
                              onMoveTray={tray => onMoveTray?.(kit, [tray])} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              )
            })}

            {!showAll && system.kits.some(k => k.at !== place || Object.values(k.trayAt || {}).some(p => p.at !== place)) && (
              <button onClick={() => setShowAll(true)} data-show-all-places
                style={{ ...pillBtn(false), width: '100%', padding: '10px 14px' }}>
                Also show {system.name} at the other places
              </button>
            )}
          </div>
          {pickedKit && picked.trays.length > 0 && (
            <div data-selection-bar style={{ padding: space.md, borderTop: border.hairline, display: 'flex', gap: space.sm, alignItems: 'center', background: colour.surface }}>
              <div style={{ flex: 1, minWidth: 0, ...text('caption'), color: colour.inkMuted }}>
                {picked.trays.length} {picked.trays.length === 1 ? 'tray' : 'trays'} ticked
              </div>
              <button onClick={() => setPicked({ kitId: '', trays: [] })} style={pillBtn(false)}>Clear</button>
              <button onClick={() => { const trays = picked.trays; setPicked({ kitId: '', trays: [] }); onMoveTray?.(pickedKit, trays) }}
                style={{ ...pillBtn(true), padding: '10px 16px' }}>Move {picked.trays.length} {picked.trays.length === 1 ? 'tray' : 'trays'}</button>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  )
}
