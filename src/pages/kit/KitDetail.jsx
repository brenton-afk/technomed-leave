import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'

// ─── One kit: its trays, the stock-take, and editing ─────────────────────────
// The stock-take lives here because it is done standing in front of the kit:
// "It's here" if the list is right, or the place it really is if not.

const PLACES = { office: 'TM office', CLV: 'Calvary', RHH: 'RHH' }
const KINDS = { consignment: 'Consignment', floating: 'TM loan', technomed: 'TechnoMed' }

export default function KitDetail({ kit, canEdit, post, onClose, onChanged, onMove }) {
  const isNew = !kit.id
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState(isNew ? { name: '', system: '', distributor: '', kind: 'consignment', home: 'office', trays: [] } : null)
  const [newTray, setNewTray] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn(); await onChanged() } catch (err) { setError(err.message) }
    setBusy(false)
  }

  function startEdit() {
    setDraft({ id: kit.id, name: kit.name, system: kit.system, distributor: kit.distributor, kind: kit.kind, home: kit.home, trays: [...(kit.trays || [])] })
    setEditing(true)
  }

  const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', ...text('field'), border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }
  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.lg}px 0 ${space.sm}px` }
  const btn = (on) => ({ ...text('bodyStrong'), padding: `${space.sm + 2}px ${space.md}px`, borderRadius: radius.control, cursor: 'pointer',
    border: on ? 'none' : border.hairline, background: on ? colour.accent : colour.surface, color: on ? 'white' : colour.ink })

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label={kit.name} className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 520, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...text('heading'), color: colour.ink }}>{isNew ? 'Add a kit' : kit.name}</div>
              {!isNew && (
                <div style={{ ...text('caption'), color: colour.inkFaint }}>
                  {KINDS[kit.kind]} · at {PLACES[kit.at]}{kit.away ? ` (home ${PLACES[kit.home]})` : ''}
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>Close</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}

            {!editing && (
              <>
                <div style={{ ...label, marginTop: 0 }}>Stock-take</div>
                <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
                  {kit.checkedAt
                    ? `Checked by ${kit.checkedBy || 'someone'} on ${new Date(kit.checkedAt).toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short' })}.`
                    : 'Not checked yet. Where is it really?'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: space.sm }}>
                  {Object.keys(PLACES).map(p => (
                    <button key={p} disabled={busy} onClick={() => run(() => post('check', { kitId: kit.id, at: p }))}
                      style={btn(p === kit.at && !kit.checkedAt)}>
                      {p === kit.at ? "It's here" : `At ${PLACES[p]}`}
                    </button>
                  ))}
                </div>

                {kit.away && (
                  <>
                    <div style={label}>Away</div>
                    <div style={{ ...text('body'), color: colour.ink }}>
                      Moved to {PLACES[kit.at]}{kit.away.byName ? ` by ${kit.away.byName}` : ''}
                      {kit.away.since ? ` on ${new Date(kit.away.since).toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', weekday: 'short', day: 'numeric', month: 'short' })}` : ''}.
                      {kit.away.caseDate ? ` For a case on ${kit.away.caseDate.split('-').reverse().slice(0, 2).join('/')}${kit.away.surname ? ` (${kit.away.surname})` : ''}.` : ''}
                    </div>
                    {kit.away.note && <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>{kit.away.note}</div>}
                  </>
                )}

                <div style={label}>Trays · {(kit.trays || []).length}</div>
                {(kit.trays || []).length === 0 && (
                  <div style={{ ...text('caption'), color: colour.inkFaint }}>No trays listed yet{canEdit ? ' — tap Edit to add them.' : '.'}</div>
                )}
                {(kit.trays || []).map(t => {
                  const away = kit.away?.trays?.length && kit.away.trays.includes(t)
                  return (
                    <div key={t} style={{ display: 'flex', ...text('body'), color: colour.ink, padding: `${space.xs + 2}px 0`, borderBottom: border.hairlineSoft }}>
                      <span style={{ flex: 1 }}>{t}</span>
                      {kit.away?.trays?.length > 0 && <span style={{ ...text('caption'), color: away ? colour.warning : colour.inkFaint }}>{away ? `at ${PLACES[kit.at]}` : `at ${PLACES[kit.home]}`}</span>}
                    </div>
                  )
                })}
              </>
            )}

            {editing && draft && (
              <>
                <div style={{ ...label, marginTop: 0 }}>Name</div>
                <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={field} aria-label="Kit name" />
                <div style={label}>Distributor</div>
                <select value={draft.distributor} onChange={e => setDraft(d => ({ ...d, distributor: e.target.value }))} style={field} aria-label="Distributor">
                  <option value="">—</option>
                  {[['signus', 'Signus'], ['e4', 'E4 Surgical'], ['device', 'Device Technologies'], ['kt', 'KT Medical'], ['globus', 'Globus / NuVasive'], ['technomed', 'TechnoMed']]
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div style={label}>Lives at</div>
                <select value={draft.home} onChange={e => setDraft(d => ({ ...d, home: e.target.value }))} style={field} aria-label="Home">
                  {Object.entries(PLACES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div style={label}>Type</div>
                <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))} style={field} aria-label="Type">
                  {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div style={label}>Trays</div>
                {draft.trays.map((t, i) => (
                  <div key={`${t}-${i}`} style={{ display: 'flex', gap: space.sm, alignItems: 'center', padding: `${space.xs}px 0`, borderBottom: border.hairlineSoft }}>
                    <span style={{ flex: 1, ...text('body'), color: colour.ink }}>{t}</span>
                    <button onClick={() => setDraft(d => ({ ...d, trays: d.trays.filter((_, j) => j !== i) }))}
                      aria-label={`Remove tray ${t}`} style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm }}>
                  <input value={newTray} onChange={e => setNewTray(e.target.value)} placeholder="Add a tray" aria-label="New tray"
                    onKeyDown={e => { if (e.key === 'Enter' && newTray.trim()) { setDraft(d => ({ ...d, trays: [...d.trays, newTray.trim()] })); setNewTray('') } }}
                    style={{ ...field, flex: 1, minWidth: 0 }} />
                  <button disabled={!newTray.trim()} onClick={() => { setDraft(d => ({ ...d, trays: [...d.trays, newTray.trim()] })); setNewTray('') }} style={btn(false)}>Add</button>
                </div>
              </>
            )}
          </div>

          <div style={{ padding: space.md, borderTop: border.hairline, display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
            {!editing && <button onClick={onMove} style={{ ...btn(true), flex: 2 }}>Move</button>}
            {!editing && canEdit && <button onClick={startEdit} style={{ ...btn(false), flex: 1 }}>Edit</button>}
            {editing && (
              <>
                <button disabled={busy} onClick={() => run(async () => { await post('save', { kit: draft }); if (isNew) onClose(); else setEditing(false) })} style={{ ...btn(true), flex: 2 }}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => (isNew ? onClose() : setEditing(false))} style={{ ...btn(false), flex: 1 }}>Cancel</button>
                {!isNew && <button disabled={busy} onClick={() => { if (window.confirm(`Remove ${kit.name} from the kit room?`)) run(async () => { await post('remove', { kitId: kit.id }); onClose() }) }}
                  style={{ ...btn(false), flex: '1 0 100%', color: colour.danger }}>Remove this kit</button>}
              </>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
