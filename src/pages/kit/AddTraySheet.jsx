import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'
import { kitForNewTray, PLACE_ORDER } from '../../kit/systems.js'

// ─── Add a tray (Brent, 20 Nov 2026) ─────────────────────────────────────────
// "We want the add kit button to be an add tray button … click on Diplomat,
// then from within Diplomat add a tray to that overarching label." Opened from
// a system it knows the system; from the room it asks (or takes a new one).

const PLACES = { CLV: 'Calvary', RHH: 'RHH', office: 'TM office' }
const DISTS = [['signus', 'Signus'], ['e4', 'E4 Surgical'], ['device', 'Device Technologies'], ['kt', 'KT Medical'], ['globus', 'Globus / NuVasive'], ['technomed', 'TechnoMed']]

export default function AddTraySheet({ system = null, systems = [], post, onClose, onDone }) {
  useBackLayer(true, onClose)
  const [pick, setPick] = useState(system ? system.key : '')
  const [newSystem, setNewSystem] = useState('')
  const [distributor, setDistributor] = useState('')
  const chosen = system || systems.find(s => s.key === pick) || null
  const isNewSystem = !system && pick === '__new'
  const [place, setPlace] = useState(chosen?.kits?.[0]?.home || 'CLV')
  const [tray, setTray] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const systemName = isNewSystem ? newSystem.trim() : chosen?.name || ''
  const ready = systemName && tray.trim() && !busy

  async function save() {
    setBusy(true); setError('')
    try {
      const { kit } = kitForNewTray(isNewSystem ? null : chosen, { system: systemName, place, tray, distributor })
      await post('save', { kit })
      await onDone?.()
      onClose()
    } catch (err) { setError(err.message); setBusy(false) }
  }

  const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', ...text('field'), border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }
  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.lg}px 0 ${space.sm}px` }
  const btn = on => ({ ...text('bodyStrong'), padding: `${space.sm + 2}px ${space.md}px`, borderRadius: radius.control, cursor: 'pointer', ...(on ? face.primary : face.secondary) })

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label="Add a tray" className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 520, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column', overflowX: 'hidden'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1, ...text('heading'), color: colour.ink }}>{system ? `Add a tray to ${system.name}` : 'Add a tray'}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden' }}>
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
            {!system && (
              <>
                <div style={{ ...label, marginTop: 0 }}>System</div>
                <select value={pick} onChange={e => { setPick(e.target.value); const s = systems.find(x => x.key === e.target.value); if (s) setPlace(s.kits[0]?.home || 'CLV') }}
                  style={field} aria-label="System">
                  <option value="">Choose…</option>
                  {systems.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                  <option value="__new">A new system…</option>
                </select>
                {isNewSystem && (
                  <>
                    <input value={newSystem} onChange={e => setNewSystem(e.target.value)} placeholder="System name, e.g. Diplomat"
                      aria-label="New system name" style={{ ...field, marginTop: space.sm }} />
                    <select value={distributor} onChange={e => setDistributor(e.target.value)} style={{ ...field, marginTop: space.sm }} aria-label="Distributor">
                      <option value="">Distributor…</option>
                      {DISTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </>
                )}
              </>
            )}
            <div style={{ ...label, ...(system ? { marginTop: 0 } : {}) }}>Tray name</div>
            <input value={tray} onChange={e => setTray(e.target.value)} aria-label="Tray name"
              placeholder={`e.g. ${systemName || 'Diplomat'} Pedicle Screws 1`} style={field}
              onKeyDown={e => { if (e.key === 'Enter' && ready) save() }} />
            <div style={label}>Where it lives</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: space.sm }}>
              {PLACE_ORDER.map(p => (
                <button key={p} onClick={() => setPlace(p)} aria-pressed={place === p} style={btn(place === p)}>{PLACES[p]}</button>
              ))}
            </div>
          </div>
          <div style={{ padding: space.md, borderTop: border.hairline, display: 'flex', gap: space.sm }}>
            <button disabled={!ready} onClick={save} style={{ ...btn(true), flex: 2, opacity: ready ? 1 : 0.5 }}>{busy ? 'Adding…' : 'Add the tray'}</button>
            <button onClick={onClose} style={{ ...btn(false), flex: 1 }}>Cancel</button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
