import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face, site } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'
import TrayList from './TrayList.jsx'
import KitDocs from './KitDocs.jsx'

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
                    title={`Trays at ${PLACES[kit.home] || kit.home}`} onMoveTray={tray => onMoveTray?.(kit, tray)} />
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
        </div>
      </div>
    </Overlay>
  )
}
