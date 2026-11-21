import React, { useEffect, useMemo, useState } from 'react'
import { Overlay } from '../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../design/tokens.js'
import { useBackLayer } from '../backButton.js'
import { matchesSearch } from '../kit/moveRequest.js'

// ─── A system's rebate codes, from Toni's price list (Brent, 21 Nov 2026) ───
// "Pull those out and add them to the resources under each system." Every
// line of the system's range: description, product code, rebate (PL) code
// and type, with a search. The price shows only for an admin — the server
// leaves it off for everyone else. KT's private and RHH lists are a switch.

const money = n => (n == null ? '—' : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const LIMIT = 200

export default function RebateCodes({ system, user, onClose }) {
  useBackLayer(true, onClose)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [find, setFind] = useState('')
  const [list, setList] = useState('')
  useEffect(() => {
    let live = true
    fetch(`/api/guides?resources=codes&system=${encodeURIComponent(system)}`, { headers: { Authorization: `Bearer ${user?.token || ''}` } })
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok || json.error) throw new Error(json.error || 'Could not load the rebate codes')
        if (live) { setData(json); setList(json.lists?.[0]?.key || '') }
      })
      .catch(err => live && setError(err.message))
    return () => { live = false }
  }, [system, user?.token])

  const current = data?.lists?.find(l => l.key === list) || data?.lists?.[0]
  const lines = useMemo(() => (current?.lines || []).filter(l => matchesSearch(find, `${l.description} ${l.code} ${l.rebate} ${l.type} ${l.range}`)), [current, find])
  const read = data?.readAt ? new Date(data.readAt).toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', year: 'numeric' }) : ''

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div role="dialog" aria-label={`${system} rebate codes`} className="tm-sheet" data-rebate-codes style={{
          background: colour.canvas, width: '100%', maxWidth: 640, height: '92dvh', borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column', overflowX: 'hidden'
        }}>
          <div style={{ padding: space.md, background: colour.surface, borderBottom: border.hairline, display: 'flex', flexDirection: 'column', gap: space.sm }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...text('title'), color: colour.ink }}>{system}</div>
                <div style={{ ...text('caption'), color: colour.inkFaint }}>
                  Rebate codes{data?.withPrices ? ' and prices' : ''} · from the distributor price list{read ? `, read ${read}` : ''}
                </div>
              </div>
              <button onClick={onClose} aria-label="Close" style={{ width: 40, height: 40, borderRadius: radius.control, border: 'none', background: colour.canvas, cursor: 'pointer', ...text('heading') }}>✕</button>
            </div>
            {data?.lists?.length > 1 && (
              <div style={{ display: 'flex', gap: space.xs }}>
                {data.lists.map(l => (
                  <button key={l.key} onClick={() => setList(l.key)} aria-pressed={current?.key === l.key} data-codes-list={l.key}
                    style={{ ...text('caption'), fontWeight: 600, padding: '6px 12px', borderRadius: radius.pill, cursor: 'pointer', ...(current?.key === l.key ? face.navy : face.secondary) }}>
                    {l.hospital === 'RHH' ? 'RHH' : l.hospital === 'private' ? 'Private hospitals' : l.label}
                  </button>
                ))}
              </div>
            )}
            <input value={find} onChange={e => setFind(e.target.value)} type="search" placeholder="Find a code, size or description" aria-label="Find a code" data-codes-find
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', ...text('field'), border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: space.md }}>
            {error && <div role="alert" style={{ ...text('body'), color: colour.danger }}>{error}</div>}
            {!data && !error && <div style={{ ...text('body'), color: colour.inkMuted }}>Loading…</div>}
            {data && !data.lists.length && <div style={{ ...text('body'), color: colour.inkMuted }}>This system is not on the distributor price list.</div>}
            {current && (
              <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
                {lines.length === current.lines.length ? `${lines.length} lines` : `${lines.length} of ${current.lines.length} lines`}
                {lines.length > LIMIT ? ` · showing the first ${LIMIT} — search to narrow` : ''}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
              {lines.slice(0, LIMIT).map((l, i) => (
                <div key={`${l.code}-${i}`} data-code-line style={{ background: colour.surface, border: border.hairline, borderRadius: radius.control, padding: `${space.sm}px ${space.md}px`, display: 'flex', gap: space.sm }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...text('body'), color: colour.ink }}>{l.description || l.code}</div>
                    <div style={{ ...text('caption'), color: colour.inkMuted, overflowWrap: 'anywhere' }}>
                      {l.code}{l.type ? ` · ${l.type}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div data-rebate style={{ ...text('bodyStrong'), color: l.rebate ? colour.accentDeep : colour.inkFainter }}>{l.rebate || 'No rebate code'}</div>
                    {data.withPrices && <div data-price style={{ ...text('caption'), color: colour.inkMuted }}>{money(l.price)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
