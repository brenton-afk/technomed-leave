import React, { useEffect, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { itemGaps, suggestedCode } from '../../usageItemCheck.js'

// ─── Amend a usage that has already gone ─────────────────────────────────────
// "I had forgotten to add the crosslink to my usage … how we could make an
// amendment or update post sending?" — Aimee, 4 Nov 2026. Edit the items, see
// what each distributor will be told, and send a correction to those whose
// items changed — no one else. See api/_usageAmend.js.

export default function AmendUsage({ usageId, user, onClose, onDone }) {
  const [record, setRecord] = useState(null)
  const [distributors, setDistributors] = useState([])
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState({ productName: '', referenceCode: '', size: '', quantity: 1, distributorKey: '' })
  const [sendAnyway, setSendAnyway] = useState(false)
  const [changes, setChanges] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token || ''}` }

  useEffect(() => {
    let live = true
    fetch(`/api/usage/agent?action=record&id=${encodeURIComponent(usageId)}`, { headers })
      .then(r => r.json())
      .then(d => {
        if (!live) return
        if (d.error) { setError(d.error); return }
        setRecord(d.record)
        setDistributors(d.distributors || [])
        setItems((d.record.items || []).map(i => ({ ...i })))
      })
      .catch(() => live && setError('No connection — try again when you are back online.'))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usageId])

  const edit = (id, patch) => { setChanges(null); setSendAnyway(false); setItems(list => list.map(i => (i.id === id ? { ...i, ...patch } : i))) }
  const editNew = (item, patch) => { setChanges(null); setSendAnyway(false); setItems(list => list.map(i => (i === item ? { ...i, ...patch } : i))) }
  const add = () => {
    if (!draft.productName.trim()) return
    setChanges(null); setSendAnyway(false)
    setItems(list => [...list, { ...draft, productName: draft.productName.trim(), referenceCode: draft.referenceCode.trim(), size: draft.size.trim(), quantity: Number(draft.quantity) || 1 }])
    setDraft({ productName: '', referenceCode: '', size: '', quantity: 1, distributorKey: '' })
  }
  // Lines new to this amendment that a distributor could not resupply from —
  // no code, or a rod or screw with no size (Brent, 9 Nov 2026, a case's
  // rods). The server holds the send until they are fixed or sent anyway.
  const gaps = items.filter(i => !i.id && !i.excluded).map(i => ({ item: i, gaps: itemGaps(i), suggestion: suggestedCode(i) })).filter(g => g.gaps.length)
  const draftHint = suggestedCode(draft)

  async function post(body) {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/usage/agent?action=amend', {
        method: 'POST', headers, body: JSON.stringify({ usageId, items, ...(sendAnyway ? { confirmGaps: true } : {}), ...body })
      })
      const data = await res.json()
      if (data.code === 'gaps') throw new Error('Some lines are missing a product code or size — fix them, or tick “Send without them” below.')
      if (!res.ok && !data.results) throw new Error(data.error || 'That did not work')
      return data
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const check = async () => { const d = await post({ preview: true }); if (d) setChanges(d.changes || []) }
  const send = async testOnly => {
    const d = await post({ testOnly })
    if (!d) return
    setDone(d)
    if (!testOnly) onDone?.()
  }

  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, display: 'block', marginBottom: 4 }
  const input = {
    width: '100%', boxSizing: 'border-box', minWidth: 0, minHeight: 40, padding: `6px ${space.sm}px`,
    border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, ...text('field'), color: colour.ink
  }
  const button = primary => ({
    flex: 1, minHeight: 44, cursor: busy ? 'default' : 'pointer', borderRadius: radius.control, ...text('bodyStrong'),
    border: primary ? 'none' : `1px solid ${colour.line}`, background: primary ? colour.accent : colour.surface,
    color: primary ? 'white' : colour.ink, opacity: busy ? 0.6 : 1
  })

  return (
    <div style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md, marginBottom: space.md }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: space.sm }}>
        <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Amend this usage</span>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', ...text('body'), color: colour.inkFaint, minHeight: 44 }}>Close</button>
      </div>
      {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}
      {!record && !error && <div style={{ ...text('caption'), color: colour.inkFaint }}>Loading…</div>}

      {record && !done && (
        <>
          <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
            Change a quantity, take an item off, or add one that was missed. Only the distributors whose items change are sent a correction.
          </div>
          {items.map(item => (
            <div key={item.id || item.productName} style={{
              display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.xs}px 0`,
              borderBottom: `1px solid ${colour.lineSoft}`, opacity: item.excluded ? 0.45 : 1
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...text('caption'), fontWeight: 700, color: colour.ink, textDecoration: item.excluded ? 'line-through' : 'none' }}>
                  {item.productName || item.description} {item.size}
                </div>
                <div style={{ ...text('micro'), textTransform: 'none', color: colour.inkFaint }}>{item.distributor || (item.id ? 'Not sent' : 'New')}{!item.id && item.referenceCode ? ` · ${item.referenceCode}` : ''}</div>
                {/* The code can be corrected too (Mat, 10 Nov 2026: a sticker was
                    obscured and the code read short), so resupply can match it. */}
                {item.id && (
                  <input aria-label={`Product code of ${item.productName || item.description}`} data-amend-code
                    value={item.referenceCode || ''} placeholder="Product code"
                    onChange={e => edit(item.id, { referenceCode: e.target.value })}
                    disabled={item.excluded}
                    style={{ ...input, marginTop: 4, minHeight: 34, padding: '0 8px', width: '100%' }} />
                )}
              </div>
              <input type="number" min="0" aria-label={`Quantity of ${item.productName}`} value={item.quantity ?? 1}
                onChange={e => (item.id ? edit(item.id, { quantity: Number(e.target.value) }) : null)}
                disabled={!item.id || item.excluded} style={{ ...input, width: 64 }} />
              {item.id
                ? <button type="button" onClick={() => edit(item.id, { excluded: !item.excluded })}
                    style={{ ...button(false), flex: 'none', minWidth: 72, minHeight: 40, ...text('caption'), fontWeight: 700 }}>
                    {item.excluded ? 'Put back' : 'Remove'}
                  </button>
                : <button type="button" onClick={() => { setChanges(null); setItems(list => list.filter(i => i !== item)) }}
                    style={{ ...button(false), flex: 'none', minWidth: 72, minHeight: 40, ...text('caption'), fontWeight: 700 }}>Undo</button>}
            </div>
          ))}

          <div style={{ marginTop: space.md }}>
            <span style={label}>Add an item that was missed</span>
            <input aria-label="Item" placeholder="e.g. Diplomat curved rod" value={draft.productName}
              onChange={e => setDraft(d => ({ ...d, productName: e.target.value }))} style={{ ...input, marginBottom: space.xs }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) 64px', gap: space.xs, marginBottom: space.xs }}>
              <input aria-label="Product code" placeholder="Product code" value={draft.referenceCode}
                onChange={e => setDraft(d => ({ ...d, referenceCode: e.target.value }))} style={input} />
              <input aria-label="Size" placeholder="Size" value={draft.size}
                onChange={e => setDraft(d => ({ ...d, size: e.target.value }))} style={input} />
              <input aria-label="Quantity" type="number" min="1" value={draft.quantity}
                onChange={e => setDraft(d => ({ ...d, quantity: e.target.value }))} style={input} />
            </div>
            <div style={{ display: 'flex', gap: space.xs }}>
              <select aria-label="Distributor" value={draft.distributorKey}
                onChange={e => setDraft(d => ({ ...d, distributorKey: e.target.value }))} style={{ ...input, flex: 2 }}>
                <option value="">Distributor — work it out</option>
                {distributors.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}
              </select>
              <button type="button" onClick={add} style={{ ...button(false), minHeight: 40 }}>Add</button>
            </div>
            {draftHint && (
              <button type="button" data-use-code onClick={() => setDraft(d => ({ ...d, referenceCode: draftHint }))}
                style={{ ...button(false), flex: 'none', minHeight: 36, marginTop: space.xs, ...text('caption'), fontWeight: 700, padding: `0 ${space.sm}px` }}>
                Use code {draftHint}
              </button>
            )}
          </div>

          {gaps.length > 0 && (
            <div data-amend-gaps style={{ marginTop: space.md, padding: space.sm, background: colour.warningSoft, borderRadius: radius.control, border: `1px solid ${colour.warning}` }}>
              <div style={{ ...text('caption'), fontWeight: 700, color: colour.ink, marginBottom: 4 }}>
                Before this goes — the distributor resupplies by code and size:
              </div>
              {gaps.map(g => (
                <div key={g.item.productName + g.item.size} style={{ ...text('caption'), color: colour.ink, marginBottom: 4 }}>
                  {g.item.productName} {g.item.size}: {g.gaps.join(' · ')}
                  {g.suggestion && (
                    <button type="button" onClick={() => editNew(g.item, { referenceCode: g.suggestion })}
                      style={{ marginLeft: 6, background: 'none', border: `1px solid ${colour.accent}`, borderRadius: radius.control, color: colour.accent, cursor: 'pointer', ...text('caption'), fontWeight: 700, minHeight: 32 }}>
                      Use {g.suggestion}
                    </button>
                  )}
                </div>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: space.xs, ...text('caption'), color: colour.ink, marginTop: 4 }}>
                <input type="checkbox" checked={sendAnyway} onChange={e => setSendAnyway(e.target.checked)} style={{ width: 20, height: 20, fontSize: 16 }} />
                Send without them
              </label>
            </div>
          )}

          {changes && (
            <div style={{ marginTop: space.md, padding: space.sm, background: colour.canvas, borderRadius: radius.control }}>
              {changes.length === 0
                ? <div style={{ ...text('caption'), color: colour.inkMuted }}>Nothing has changed for any distributor.</div>
                : changes.map(c => (
                  <div key={c.key} style={{ marginBottom: space.xs }}>
                    <div style={{ ...text('caption'), fontWeight: 700, color: colour.ink }}>{c.name} will be sent:</div>
                    {c.lines.map(l => <div key={l} style={{ ...text('caption'), color: colour.ink }}>{l}</div>)}
                  </div>
                ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: space.sm, marginTop: space.md }}>
            {!changes || !changes.length
              ? <button type="button" disabled={busy} onClick={check} style={button(true)}>Check changes</button>
              : <>
                  <button type="button" disabled={busy || (gaps.length > 0 && !sendAnyway)} onClick={() => send(false)} data-send-correction
                    style={{ ...button(true), opacity: busy || (gaps.length > 0 && !sendAnyway) ? 0.5 : 1 }}>Send correction</button>
                  <button type="button" disabled={busy} onClick={() => send(true)} style={button(false)}>Test to me</button>
                </>}
          </div>
        </>
      )}

      {done && (
        <div>
          {done.results.map(r => (
            r.needsFirstSend ? (
              <div key={r.key} data-needs-first-send style={{ ...text('caption'), color: colour.warning, marginBottom: 4 }}>
                ! {r.error}
              </div>
            ) : (
              <div key={r.key} style={{ ...text('caption'), color: r.ok ? colour.accentDeep : colour.danger, marginBottom: 4 }}>
                {r.ok ? '✓' : '✕'} {r.test ? 'Test sent to you' : `Correction sent to ${r.name}`}{r.ok ? '' : ` — ${r.error}`}
              </div>
            )
          ))}
          {done.filed && <div style={{ ...text('caption'), color: colour.inkMuted }}>Corrected sheet filed in Dropbox beside the original.</div>}
          <button type="button" onClick={done.test ? () => setDone(null) : onClose} style={{ ...button(false), marginTop: space.sm, width: '100%' }}>
            {done.test ? 'Back to the amendment' : 'Done'}
          </button>
        </div>
      )}
    </div>
  )
}
