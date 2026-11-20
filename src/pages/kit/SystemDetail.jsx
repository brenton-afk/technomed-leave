import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face, site } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'
import TrayList from './TrayList.jsx'
import KitDocs from './KitDocs.jsx'
import { PLACE_ORDER } from '../../kit/systems.js'

// ─── One system: every tray, wherever it is (Brent, 20 Nov 2026) ─────────────
// One tab per system, the trays inside it. Each hospital's set is a section
// headed by the place — never "Diplomat 2" — with its stock-take tick, "Move
// all trays" (a whole kit still goes in one move) and its documents. The trays
// themselves are where the work is: open, edit, move one tray, repair.

const PLACES = { CLV: 'Calvary', RHH: 'RHH', office: 'TM office / Warehouse' }

export default function SystemDetail({ system, canEdit, user, post, onClose, onChanged, onMoveTray, onMoveKit, onAddTray, onKitDetails }) {
  useBackLayer(true, onClose)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [docsOpen, setDocsOpen] = useState('')
  // Ticked trays, one hospital set at a time (a move is one set's trays).
  const [picked, setPicked] = useState({ kitId: '', trays: [] })
  const toggle = (kit, tray) => setPicked(p => {
    if (p.kitId !== kit.id) return { kitId: kit.id, trays: [tray] }
    const trays = p.trays.includes(tray) ? p.trays.filter(t => t !== tray) : [...p.trays, tray]
    return { kitId: trays.length ? kit.id : '', trays }
  })
  const selectedFor = kit => new Set(picked.kitId === kit.id ? picked.trays : [])
  const pickedKit = system.kits.find(k => k.id === picked.kitId)

  // Trays that have gone somewhere on their own, by where they are now —
  // "we want to be able to see the tray sitting at Calvary clearly".
  const transferred = PLACE_ORDER.map(place => ({
    place,
    groups: system.kits.map(kit => ({
      kit, trays: Object.entries(kit.trayAt || {}).filter(([, p]) => p.at === place).map(([t]) => t)
    })).filter(g => g.trays.length)
  })).filter(x => x.groups.length)
  const awayFrom = kit => Object.keys(kit.trayAt || {})
  const when = iso => (iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short' }) : '')

  async function check(kit) {
    setBusy(kit.id); setError('')
    try { await post('check', { kitId: kit.id, at: kit.at }); await onChanged?.() } catch (err) { setError(err.message) }
    setBusy('')
  }

  const pillBtn = on => ({ ...text('caption'), fontWeight: 600, padding: '6px 10px', borderRadius: radius.pill, cursor: 'pointer', whiteSpace: 'nowrap', ...(on ? face.primary : face.secondary) })
  const trayCount = system.kits.reduce((n, k) => n + (k.trays || []).length, 0)

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label={system.name} className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 560, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column', overflowX: 'hidden'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...text('heading'), color: colour.ink }}>{system.name}</div>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>{trayCount} {trayCount === 1 ? 'tray' : 'trays'}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>Close</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
            {canEdit && (
              <button onClick={onAddTray} data-add-tray aria-label={`Add a tray to ${system.name}`} style={{ ...pillBtn(true), padding: '10px 14px', marginBottom: space.sm }}>+ Add a tray</button>
            )}
            {transferred.length > 0 && (
              <section data-transferred style={{ marginTop: space.md, padding: space.sm, borderRadius: radius.card,
                background: colour.warningSoft, border: `1px solid ${colour.warning}` }}>
                <div style={{ ...text('bodyStrong'), color: colour.ink }}>Transferred trays</div>
                <div style={{ ...text('caption'), color: colour.inkMuted }}>Moved on their own, away from their own set. Move one back when it returns.</div>
                {transferred.map(({ place, groups }) => (
                  <div key={place} style={{ marginTop: space.sm }}>
                    <div style={{ ...text('bodyStrong'), color: (site[place] || site.office).ink }}>Now at {PLACES[place]}</div>
                    {groups.map(({ kit, trays }) => {
                      const p = kit.trayAt[trays[0]] || {}
                      return (
                        <div key={kit.id} style={{ marginTop: space.xs }}>
                          <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: 4 }}>
                            From the {PLACES[kit.home] || kit.home}{kit.kind === 'floating' ? ' TM loan' : ''} set
                            {p.byName ? ` · moved by ${p.byName}` : ''}{p.since ? ` ${when(p.since)}` : ''}
                            {p.caseDate ? ` · for a case on ${p.caseDate.split('-').reverse().slice(0, 2).join('/')}` : ''}
                          </div>
                          <TrayList kit={kit} canEdit={canEdit} user={user} post={post} onSaved={onChanged} compact only={trays}
                            selected={selectedFor(kit)} onSelect={t => toggle(kit, t)}
                            onMoveTray={tray => onMoveTray?.(kit, [tray])} />
                        </div>
                      )
                    })}
                  </div>
                ))}
              </section>
            )}
            {system.kits.map(kit => {
              const look = site[kit.home] || site.office
              const heading = `${PLACES[kit.home] || kit.home}${kit.kind === 'floating' ? ' · TM loan' : ''}`
              return (
                <section key={kit.id} data-system-set={kit.id} style={{ marginTop: space.lg }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', paddingBottom: 6, borderBottom: `2px solid ${look.line}` }}>
                    <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: look.ink }} />
                    <span style={{ ...text('bodyStrong'), color: look.ink, flex: 1, minWidth: 0 }}>{heading}</span>
                    {kit.away && <span style={{ ...text('caption'), color: colour.warning, fontWeight: 600 }}>at {PLACES[kit.at]}</span>}
                    {!kit.away && (kit.checkedAt
                      ? <span style={{ ...text('caption'), color: colour.accentDeep, fontWeight: 600 }}>✓ checked</span>
                      : <button disabled={busy === kit.id} onClick={() => check(kit)} aria-label={`${heading} trays are here`}
                          style={{ ...pillBtn(false), border: `1px solid ${colour.accent}`, color: colour.accentDeep }}>{busy === kit.id ? '…' : "It's here"}</button>)}
                    <button onClick={() => onMoveKit?.(kit)} aria-label={`Move all ${heading} trays`} style={pillBtn(false)}>Move all</button>
                  </div>
                  <TrayList kit={kit} canEdit={canEdit} user={user} post={post} onSaved={onChanged}
                    title={`Trays at ${PLACES[kit.at] || kit.at}`} except={awayFrom(kit)}
                    selected={selectedFor(kit)} onSelect={t => toggle(kit, t)}
                    onMoveTray={tray => onMoveTray?.(kit, [tray])} />
                  <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', marginTop: space.xs }}>
                    <button onClick={() => setDocsOpen(docsOpen === kit.id ? '' : kit.id)} style={pillBtn(false)}>
                      {docsOpen === kit.id ? 'Hide documents' : (kit.kind !== 'floating' && !kit.docs?.consignment ? 'Documents · no agreement yet' : 'Documents')}
                    </button>
                    <button onClick={() => onKitDetails?.(kit)} style={pillBtn(false)}>Set details</button>
                  </div>
                  {docsOpen === kit.id && <KitDocs kit={kit} user={user} post={post} onChanged={onChanged} />}
                </section>
              )
            })}
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
