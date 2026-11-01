import React, { useState, useEffect, useCallback } from 'react'

// ─── TOIL, person by person ──────────────────────────────────────────────────
// "A balance history (ledger) per staff member, so balances can be checked
// against Xero" and "an opening balance per person (e.g. from Xero) with a
// note."
//
// The app's balance beside Xero's, and every line behind it, so a difference
// can be traced to where it starts. The opening balance is the hours the app
// never saw — accrued before it kept the balance — set here with where the
// number came from.

const KIND = { opening: 'Opening', accrued: 'Earned', taken: 'Taken' }

export default function ToilLedger({ user }) {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ hours: '', note: '', asAt: '' })
  const [saving, setSaving] = useState(false)
  const headers = { Authorization: `Bearer ${user?.token || ''}` }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/timesheet/agent?action=toil&all=1', { headers })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Could not load TOIL')
      setPeople(data.people || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])

  useEffect(() => { load() }, [load])

  async function saveOpening(email) {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/timesheet/agent?action=toilopening', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, hours: Number(draft.hours), note: draft.note, asAt: draft.asAt })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Not saved')
      setEditing(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const card = { background: 'white', borderRadius: 12, padding: 14, marginBottom: 10 }
  const input = { padding: '8px 10px', border: '1px solid #dfe5ec', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }

  return (
    <div>
      {loading && <div style={{ textAlign: 'center', padding: 40, color: '#6b7a8d' }}>Loading…</div>}
      {error && <div role="alert" style={{ background: '#fdecea', color: '#c0392b', padding: '12px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {!loading && people.map(p => (
        <div key={p.email} style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <strong style={{ flex: 1, color: '#042746', fontSize: 15 }}>{p.name}</strong>
            <strong style={{ color: '#189a85', fontSize: 16 }}>{p.balance}h</strong>
          </div>
          <div style={{ fontSize: 12.5, color: p.check?.agrees === false ? '#b45309' : '#6b7a8d', marginTop: 2 }}>
            {p.xero != null ? `Xero ${p.xero}h — ` : ''}{p.check?.note}
          </div>
          {(p.pending?.accrued > 0 || p.pending?.taken > 0) && (
            <div style={{ fontSize: 12.5, color: '#6b7a8d' }}>
              Awaiting approval: {p.pending.accrued > 0 ? `+${p.pending.accrued}h earned ` : ''}
              {p.pending.taken > 0 ? `−${p.pending.taken}h taken` : ''}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => setOpen(open === p.email ? null : p.email)}
              style={{ padding: '6px 12px', borderRadius: 16, border: '1px solid #dfe5ec', background: 'white', fontSize: 13, cursor: 'pointer' }}>
              {open === p.email ? 'Hide history' : 'History'}
            </button>
            <button onClick={() => {
              setEditing(p.email)
              setDraft({ hours: String(p.opening || ''), note: p.openingNote || '', asAt: '' })
            }}
              style={{ padding: '6px 12px', borderRadius: 16, border: '1px solid #dfe5ec', background: 'white', fontSize: 13, cursor: 'pointer' }}>
              Opening balance{p.opening ? ` (${p.opening}h)` : ''}
            </button>
          </div>

          {editing === p.email && (
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 13, color: '#042746' }}>Hours
                <input type="number" step="0.25" value={draft.hours} aria-label={`Opening TOIL hours for ${p.name}`}
                  onChange={e => setDraft(d => ({ ...d, hours: e.target.value }))} style={{ ...input, width: '100%' }} />
              </label>
              <label style={{ fontSize: 13, color: '#042746' }}>As at
                <input type="date" value={draft.asAt} onChange={e => setDraft(d => ({ ...d, asAt: e.target.value }))} style={{ ...input, width: '100%' }} />
              </label>
              <label style={{ fontSize: 13, color: '#042746' }}>Where it came from
                <input value={draft.note} placeholder="Xero balance at 31 Oct 2026" onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} style={{ ...input, width: '100%' }} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditing(null)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #dfe5ec', background: 'white', cursor: 'pointer' }}>Cancel</button>
                <button disabled={saving || draft.hours === ''} onClick={() => saveOpening(p.email)}
                  style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: '#189a85', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {open === p.email && (
            <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {(p.ledger || []).length === 0 && (
                  <tr><td style={{ color: '#6b7a8d', padding: 6 }}>Nothing yet.</td></tr>
                )}
                {(p.ledger || []).map((line, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #eef1f5' }}>
                    <td style={{ padding: '6px 4px', color: '#6b7a8d', whiteSpace: 'nowrap' }}>{line.date || '—'}</td>
                    <td style={{ padding: '6px 4px' }}>{KIND[line.kind]} <span style={{ color: '#6b7a8d' }}>{line.note}</span></td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', color: line.hours < 0 ? '#c0392b' : '#189a85', whiteSpace: 'nowrap' }}>
                      {line.hours > 0 ? '+' : ''}{line.hours}h
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{line.balance}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}
