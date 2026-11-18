import React, { useEffect, useState } from 'react'

// ─── Admin → Price lists (Brent, 18 Nov 2026) ────────────────────────────────
// The distributor price lists the portal keeps (api/_priceStore.js), read from
// Toni's workbook in Dropbox. What it holds, a search across every list, and
// Read it again after the spreadsheet changes. Internal only — admins.

const money = n => (n == null ? '—' : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`)
const when = iso => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export default function PriceLists({ user }) {
  const auth = { Authorization: `Bearer ${user?.token || ''}` }
  const [status, setStatus] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await fetch('/api/guides?prices=status', { headers: auth })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not read the price lists')
      setStatus(d)
    } catch (err) { setError(err.message) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function reread() {
    setBusy('refresh'); setError('')
    try {
      const res = await fetch('/api/guides?prices=refresh', { method: 'POST', headers: auth })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not read the workbook')
      await load()
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  async function search(e) {
    e?.preventDefault()
    if (q.trim().length < 2) return
    setBusy('search'); setError('')
    try {
      const res = await fetch(`/api/guides?prices=search&q=${encodeURIComponent(q.trim())}`, { headers: auth })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Search failed')
      setResults(d.results || [])
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  const meta = status?.meta
  const card = { background: 'white', borderRadius: 12, padding: 14, marginBottom: 12, border: '1px solid rgba(26,43,74,0.08)' }
  return (
    <div data-price-lists>
      <div style={{ ...card, background: '#fff8e6', fontSize: 12.5, color: '#856404', lineHeight: 1.5 }}>
        Internal only. Partner pricing is commercially confidential and must not be shared with customers or other partners.
      </div>
      {error && <div style={{ background: '#fdecea', color: '#c0392b', padding: '12px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#042746' }}>What the portal holds</div>
        {!status && <div style={{ fontSize: 13, color: '#6b7a8d', marginTop: 6 }}>Loading…</div>}
        {status && !meta && <div style={{ fontSize: 13, color: '#6b7a8d', marginTop: 6 }}>Nothing yet — tap Read it from Dropbox.</div>}
        {meta && (
          <div style={{ fontSize: 12.5, color: '#6b7a8d', marginTop: 4, lineHeight: 1.5 }}>
            {meta.file} · {status.folder} · read {when(meta.readAt)}{meta.by ? ` by ${meta.by}` : ''}
          </div>
        )}
        {status?.lists?.map(l => (
          <div key={l.key} data-price-list={l.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid rgba(26,43,74,0.06)', color: '#042746' }}>
            <span>{l.label}</span><span style={{ color: l.count ? '#042746' : '#c0392b' }}>{l.count ? `${l.count} lines` : 'none'}</span>
          </div>
        ))}
        {meta?.notes?.['kt-rhh'] && <div style={{ fontSize: 12, color: '#856404', marginTop: 8 }}>KT (RHH): {meta.notes['kt-rhh']}</div>}
        <button type="button" onClick={reread} disabled={Boolean(busy)}
          style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, border: 'none', background: '#189a85', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          {busy === 'refresh' ? 'Reading…' : meta ? 'Read it again from Dropbox' : 'Read it from Dropbox'}
        </button>
        <div style={{ fontSize: 12, color: '#6b7a8d', marginTop: 6, lineHeight: 1.5 }}>
          Edit the spreadsheet in Dropbox; the portal reads it again overnight when it has changed, or now with this button.
          Every scanned usage line is checked against these lists.
        </div>
      </div>

      <form onSubmit={search} style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#042746', marginBottom: 8 }}>Look up a product</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Code, description, range or rebate code" aria-label="Search the price lists"
            style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(26,43,74,0.15)', fontSize: 16 }} />
          <button type="submit" disabled={busy === 'search' || q.trim().length < 2}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #189a85', background: 'white', color: '#189a85', fontWeight: 600, fontSize: 13 }}>Search</button>
        </div>
        {results && results.length === 0 && <div style={{ fontSize: 13, color: '#6b7a8d', marginTop: 10 }}>Nothing on any list matches.</div>}
        {results?.map((r, i) => (
          <div key={`${r.list}-${r.code}-${i}`} data-price-row style={{ padding: '8px 0', borderBottom: '1px solid rgba(26,43,74,0.06)', fontSize: 13, color: '#042746' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{r.code}</strong><strong>{money(r.price)}</strong>
            </div>
            <div style={{ color: '#23313e' }}>{r.description}</div>
            <div style={{ fontSize: 12, color: '#6b7a8d' }}>
              {[r.distributor, r.range, r.type, r.rebate, r.setting, r.supply, r.artg && `ARTG ${r.artg}`].filter(Boolean).join(' · ')}
            </div>
            {r.notes && <div style={{ fontSize: 12, color: '#856404' }}>{r.notes}</div>}
          </div>
        ))}
      </form>
    </div>
  )
}
