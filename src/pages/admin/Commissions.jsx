import React, { useState, useEffect, useMemo } from 'react'

// ─── Commissions (Brent only, 15 Nov 2026) ────────────────────────────────────
// Worked out from Xero three business days before each payment day; checked
// and approved here; the figures go into the monthly unscheduled pay run.
// Rates are edited here (seeded from the Dropbox workbooks).

const NAVY = '#042746'
const TEAL = '#189a85'
const MUTED = '#6b7a8d'
const BORDER = 'rgba(26,43,74,0.12)'
const AMBER = '#8a5a00'
const money = n => `$${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = n => `${Math.round(Number(n) * 10000) / 100}%`
const monthLabel = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayLabel = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const card = { background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }
const btn = (on = true) => ({ padding: '9px 14px', borderRadius: 9, border: 'none', background: on ? TEAL : '#c8d2dc', color: 'white', fontSize: 13, fontWeight: 700, cursor: on ? 'pointer' : 'default' })

export default function Commissions({ user }) {
  const auth = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])
  const [runs, setRuns] = useState([])
  const [next, setNext] = useState(null)
  const [month, setMonth] = useState('')
  const [run, setRun] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [showRates, setShowRates] = useState(false)

  const call = async (action, { method = 'GET', body, query = '' } = {}) => {
    const res = await fetch(`/api/xero/info?action=${action}${query}`, {
      method, headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error || 'That did not work')
    return out
  }

  async function load() {
    try {
      const data = await call('commission-runs')
      setRuns(data.runs || []); setNext(data.next)
      const pick = month || data.runs?.[0]?.salesMonth || data.next?.salesMonth
      setMonth(pick)
      if (pick) setRun((await call('commission-run', { query: `&month=${pick}` })).run)
    } catch (err) { setError(err.message) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  async function open(m) {
    setMonth(m); setError('')
    try { setRun((await call('commission-run', { query: `&month=${m}` })).run) } catch (err) { setError(err.message) }
  }
  async function work() {
    setBusy('work'); setError('')
    try { setRun((await call('commission-run', { method: 'POST', body: { month } })).run); await load() } catch (err) { setError(err.message) }
    setBusy('')
  }
  async function approve() {
    if (!window.confirm(`Approve ${monthLabel(month)} commissions and file the workbooks in Dropbox?`)) return
    setBusy('approve'); setError('')
    try { setRun((await call('commission-approve', { method: 'POST', body: { month } })).run); await load() } catch (err) { setError(err.message) }
    setBusy('')
  }

  const months = [...new Set([next?.salesMonth, ...runs.map(r => r.salesMonth)].filter(Boolean))]

  return (
    <div data-commissions>
      {error && <div role="alert" style={{ background: '#fdecea', color: '#c0392b', padding: 12, borderRadius: 10, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {next && (
        <div style={{ ...card, background: '#e6f4f2', borderColor: 'rgba(24,154,133,0.3)' }}>
          <div style={{ fontSize: 13, color: NAVY }}>
            Next: <strong>{monthLabel(next.salesMonth)} sales</strong>, paid <strong>{dayLabel(next.paymentDate)}</strong>.
            The portal works it out by itself on {dayLabel(next.calcDate)}.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {months.map(m => (
          <button key={m} onClick={() => open(m)}
            style={{ padding: '7px 12px', borderRadius: 18, border: `1px solid ${m === month ? TEAL : BORDER}`, background: m === month ? TEAL : 'white', color: m === month ? 'white' : NAVY, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            {monthLabel(m)}{runs.find(r => r.salesMonth === m)?.status === 'approved' ? ' ✓' : ''}
          </button>
        ))}
      </div>

      {month && !run && (
        <div style={card}>
          <div style={{ fontSize: 13, color: NAVY, marginBottom: 8 }}>{monthLabel(month)} has not been worked out yet.</div>
          <button data-commission-work onClick={work} disabled={busy === 'work'} style={btn(busy !== 'work')}>{busy === 'work' ? 'Reading Xero…' : 'Work it out now'}</button>
        </div>
      )}

      {run && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, color: NAVY }}>
                <strong>{monthLabel(run.salesMonth)} sales</strong> · paid {dayLabel(run.paymentDate)} ·{' '}
                <span style={{ color: run.status === 'approved' ? TEAL : AMBER, fontWeight: 700 }}>{run.status === 'approved' ? `Approved ${run.approvedAt?.slice(0, 10)}` : 'Draft — check and approve'}</span>
              </div>
              {run.status !== 'approved' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={work} disabled={!!busy} style={{ ...btn(!busy), background: 'white', color: NAVY, border: `1px solid ${BORDER}` }}>{busy === 'work' ? 'Reading Xero…' : 'Read Xero again'}</button>
                  <button data-commission-approve onClick={approve} disabled={!!busy} style={btn(!busy)}>{busy === 'approve' ? 'Filing…' : 'Approve'}</button>
                </div>
              )}
            </div>
            {run.missing?.length > 0 && (
              <div data-commission-missing style={{ fontSize: 12.5, color: AMBER, marginTop: 8, lineHeight: 1.45 }}>
                No invoice in Xero yet for: {run.missing.join(', ')}. If one is still to be raised, raise it and tap Read Xero again.
              </div>
            )}
            {run.filed?.length > 0 && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>Filed in Dropbox: {run.filed.join(' · ')}</div>}
          </div>

          {run.people.map(p => (
            <div key={p.email} data-commission-person={p.email} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{p.name}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: TEAL }}>{money(p.total)}</div>
              </div>
              <div style={{ margin: '8px 0', background: '#f6f8fb', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: MUTED, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Pay run — enter these in Xero</div>
                {Object.entries(p.byPayItem).filter(([, v]) => v).map(([item, amount]) => (
                  <div key={item} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: NAVY, padding: '2px 0' }}><span>{item}</span><strong>{money(amount)}</strong></div>
                ))}
                {!Object.values(p.byPayItem).some(Boolean) && <div style={{ fontSize: 12.5, color: MUTED }}>Nothing this month.</div>}
              </div>
              {p.lines.filter(l => l.tm || l.sales || l.amount).map(l => (
                <div key={l.row} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, fontSize: 12.5, color: NAVY, padding: '5px 0', borderTop: `1px solid ${BORDER}` }}>
                  <div>
                    {l.label}
                    <div style={{ color: MUTED }}>
                      Sales {money(l.sales)} · TechnoMed {money(l.tm)} · {pct(l.rate)} of {l.base === 'sales' ? 'sales' : 'TechnoMed commission'} · {l.invoices.join(', ')}
                      {l.adjustments.length ? ` · includes late correction ${l.adjustments.join(', ')}` : ''}
                      {l.unknownSales ? ' · a line did not state its sales figure — check' : ''}
                    </div>
                  </div>
                  <strong>{money(l.amount)}</strong>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      <button onClick={() => setShowRates(v => !v)} style={{ background: 'none', border: 'none', color: TEAL, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
        {showRates ? '▾' : '▸'} Commission rates
      </button>
      {showRates && <Rates call={call} />}
    </div>
  )
}

function Rates({ call }) {
  const [rules, setRules] = useState(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => { call('commission-rules').then(d => setRules(d.rules)).catch(err => setNote(err.message)) }, [])
  if (!rules) return <div style={{ fontSize: 13, color: MUTED }}>{note || 'Loading…'}</div>
  const label = id => rules.rows.find(r => r.id === id)?.label || id
  const set = (pi, ri, patch) => setRules(r => ({ ...r, people: r.people.map((p, i) => i !== pi ? p : { ...p, rates: p.rates.map((x, j) => j !== ri ? x : { ...x, ...patch }) }) }))
  async function save() {
    setSaving(true); setNote('')
    try { const d = await call('commission-rules', { method: 'PUT', body: { rules } }); setRules(d.rules); setNote('Saved. The next month worked out uses these rates.') } catch (err) { setNote(err.message) }
    setSaving(false)
  }
  return (
    <div data-commission-rates style={card}>
      {rules.people.map((p, pi) => (
        <div key={p.email} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{p.name}</div>
          {p.rates.map((x, ri) => (
            <div key={`${x.row}-${ri}`} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 130px', gap: 6, alignItems: 'center', fontSize: 12.5, color: NAVY, padding: '3px 0' }}>
              <span>{label(x.row)} <span style={{ color: MUTED }}>→ {x.payItem}</span></span>
              <input aria-label={`${p.name} ${label(x.row)} rate`} type="number" step="0.01" value={Math.round(x.rate * 10000) / 100}
                onChange={e => set(pi, ri, { rate: Number(e.target.value) / 100 })}
                style={{ padding: '5px 6px', border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 16 }} />
              <select value={x.base} onChange={e => set(pi, ri, { base: e.target.value })} style={{ fontSize: 16, padding: '5px 6px' }}>
                <option value="tm">% of TM commission</option>
                <option value="sales">% of sales</option>
              </select>
            </div>
          ))}
        </div>
      ))}
      <button onClick={save} disabled={saving} style={btn(!saving)}>{saving ? 'Saving…' : 'Save rates'}</button>
      {note && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>{note}</div>}
    </div>
  )
}
