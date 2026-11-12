import React, { useState, useEffect, useRef } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import TrayList from './TrayList.jsx'
import KitDocs from './KitDocs.jsx'

// ─── One kit: its trays, the stock-take, and editing ─────────────────────────
// The stock-take lives here because it is done standing in front of the kit:
// "It's here" if the list is right, or the place it really is if not.

const PLACES = { office: 'TM office / Warehouse', CLV: 'Calvary', RHH: 'RHH' }
const KINDS = { consignment: 'Consignment', floating: 'TM loan', technomed: 'TechnoMed' }

export default function KitDetail({ kit, canEdit, canRemove = canEdit, user, post, onClose, onChanged, onMove, focus = '' }) {
  // A tile's "Tray list" or "Agreement" chip opens the kit at that part.
  const trayRef = useRef(null)
  const docsRef = useRef(null)
  useEffect(() => {
    const el = focus === 'trays' ? trayRef.current : focus === 'docs' ? docsRef.current : null
    if (el) setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120)
  }, [focus])
  const isNew = !kit.id
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState(isNew ? { name: '', system: '', distributor: '', kind: 'consignment', home: 'office', trays: [] } : null)
  const [newTray, setNewTray] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [confirmed, setConfirmed] = useState('')

  async function run(fn) {
    setBusy(true); setError('')
    try { await fn(); await onChanged() } catch (err) { setError(err.message) }
    setBusy(false)
  }

  // "Tapping 'it's here' makes it go green and acknowledges that the staff
  // member has put it in the right place." One tap: it saves, says so in
  // green, and the sheet closes itself — nothing left to cancel out of.
  async function check(place) {
    setBusy(true); setError('')
    try {
      await post('check', { kitId: kit.id, at: place })
      setConfirmed(place === kit.at ? `Checked — ${kit.name} is at ${PLACES[place]}` : `Updated — ${kit.name} is at ${PLACES[place]}`)
      await onChanged()
      setTimeout(onClose, 900)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  function startEdit() {
    // `was` remembers each tray's name when editing began, so a rename can be
    // carried into the tray list and onto a kit that is away.
    setDraft({ id: kit.id, name: kit.name, system: kit.system, distributor: kit.distributor, kind: kit.kind, home: kit.home,
      trays: [...(kit.trays || [])], was: [...(kit.trays || [])] })
    setEditing(true)
  }

  const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', ...text('field'), border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }
  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.lg}px 0 ${space.sm}px` }
  const btn = (on) => ({ ...text('bodyStrong'), padding: `${space.sm + 2}px ${space.md}px`, borderRadius: radius.control, cursor: 'pointer',
    ...(on ? face.primary : face.secondary) })

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
            {confirmed && (
              <div role="status" style={{ ...text('bodyStrong'), background: colour.successSoft, color: colour.accentDeep,
                border: `1px solid ${colour.accent}`, borderRadius: radius.control, padding: space.md, marginBottom: space.sm }}>
                ✓ {confirmed}
              </div>
            )}
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
                    <button key={p} disabled={busy} onClick={() => check(p)}
                      style={p === kit.at
                        ? { ...btn(true), ...(kit.checkedAt ? { background: colour.successSoft, color: colour.accentDeep, border: `1px solid ${colour.accent}` } : {}) }
                        : btn(false)}>
                      {p === kit.at ? (kit.checkedAt ? '✓ Here' : "It's here") : `At ${PLACES[p]}`}
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

                {!isNew && (
                  <div ref={docsRef} style={{ scrollMarginTop: 8 }}>
                    <KitDocs kit={kit} user={user} post={post} onChanged={onChanged} />
                  </div>
                )}
                {!isNew && (
                  <div ref={trayRef} style={{ scrollMarginTop: 8 }}>
                    <TrayList kit={kit} canEdit={canEdit} user={user} post={post} onSaved={onChanged} />
                  </div>
                )}
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
                {/* Each name can be typed over. "I need to be able to edit the
                    tray name from an existing kit." */}
                {draft.trays.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: space.sm, alignItems: 'center', padding: `${space.xs}px 0`, borderBottom: border.hairlineSoft }}>
                    <input value={t} aria-label={`Tray name ${i + 1}`}
                      onChange={e => setDraft(d => ({ ...d, trays: d.trays.map((x, j) => (j === i ? e.target.value : x)) }))}
                      style={{ ...field, flex: 1, minWidth: 0 }} />
                    <button onClick={() => setDraft(d => ({ ...d, trays: d.trays.filter((_, j) => j !== i), was: (d.was || []).filter((_, j) => j !== i) }))}
                      aria-label={`Remove tray ${t}`} style={{ ...text('caption'), color: colour.danger, background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: space.sm, marginTop: space.sm }}>
                  <input value={newTray} onChange={e => setNewTray(e.target.value)} placeholder="Add a tray" aria-label="New tray"
                    onKeyDown={e => { if (e.key === 'Enter' && newTray.trim()) { setDraft(d => ({ ...d, trays: [...d.trays, newTray.trim()], was: [...(d.was || []), null] })); setNewTray('') } }}
                    style={{ ...field, flex: 1, minWidth: 0 }} />
                  <button disabled={!newTray.trim()} onClick={() => { setDraft(d => ({ ...d, trays: [...d.trays, newTray.trim()], was: [...(d.was || []), null] })); setNewTray('') }} style={btn(false)}>Add</button>
                </div>
              </>
            )}
          </div>

          <div style={{ padding: space.md, borderTop: border.hairline, display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
            {!editing && <button onClick={onMove} style={{ ...btn(true), flex: 2 }}>Move</button>}
            {!editing && canEdit && <button onClick={startEdit} style={{ ...btn(false), flex: 1 }}>Edit</button>}
            {editing && (
              <>
                <button disabled={busy} onClick={() => run(async () => {
                  const renames = (draft.was || []).map((from, i) => ({ from, to: String(draft.trays[i] || '').trim() }))
                    .filter(r => r.from && r.to && r.from !== r.to)
                  const { was, ...kitDraft } = draft
                  await post('save', { kit: kitDraft, renames })
                  if (isNew) onClose(); else setEditing(false)
                })} style={{ ...btn(true), flex: 2 }}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => (isNew ? onClose() : setEditing(false))} style={{ ...btn(false), flex: 1 }}>Cancel</button>
                {!isNew && canRemove && <button disabled={busy} onClick={() => { if (window.confirm(`Remove ${kit.name} from the kit room?`)) run(async () => { await post('remove', { kitId: kit.id }); onClose() }) }}
                  style={{ ...btn(false), flex: '1 0 100%', color: colour.danger }}>Remove this kit</button>}
              </>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
