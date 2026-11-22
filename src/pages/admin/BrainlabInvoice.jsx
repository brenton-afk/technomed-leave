import React, { useEffect, useState, useCallback } from 'react'
import { todayStr } from '../../clinicalPlan/week.js'

// ─── Admin → Brainlab invoice (Brent, 22 Nov 2026) ───────────────────────────
// "When the bookings are entered into the portal with the relevant
// navigation, the portal can auto generate the Brainlab invoice from this
// information and it is 100% accurate." A month of bookings, every one with a
// Brainlab service in exactly one list: To bill · To answer · No F2F (tracked)
// · Not billed. Each line can be changed (AIRO / Navigation / Not billed,
// attended or not); the invoice can be drafted only once nothing is left to
// answer, and Xero refuses a second one for the same month. Rules and
// formats: src/clinicalPlan/brainlabBilling.js. Server: api/_brainlabMonth.js.

const money = n => `$${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const lastMonth = () => {
  const [y, m] = todayStr().split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const dayLabel = d => {
  const [y, m, dd] = String(d).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}
const KIND = { airo: 'AIRO $300', nav: 'Nav $250' }
const S = {
  card: { background: 'white', borderRadius: 12, border: '1px solid #e3e8ee', padding: 14, marginBottom: 12 },
  h: { fontSize: 13, fontWeight: 700, color: '#042746', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '.04em' },
  row: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid #eef1f5', flexWrap: 'wrap' },
  chip: on => ({ padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? '#189a85' : '#d5dde5'}`, background: on ? '#189a85' : 'white', color: on ? 'white' : '#0f1d2b' }),
  btn: { padding: '11px 16px', borderRadius: 10, border: 0, background: '#189a85', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  muted: { fontSize: 12, color: '#5b6b7a' }
}

export default function BrainlabInvoice({ user }) {
  const [month, setMonth] = useState(lastMonth())
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState(null)
  const auth = { Authorization: `Bearer ${user?.token || ''}` }

  const load = useCallback(async () => {
    setError(''); setData(null); setMade(null)
    try {
      const r = await fetch(`/api/xero/info?action=brainlab-month&month=${month}`, { headers: auth })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not read the month')
      setData(j)
    } catch (e) { setError(e.message) }
  }, [month, user?.token])
  useEffect(() => { load() }, [load])

  async function post(action, body) {
    setBusy(true); setError('')
    try {
      const r = await fetch(`/api/xero/info?action=${action}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ month, ...body }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'That did not work')
      return j
    } catch (e) { setError(e.message); return null } finally { setBusy(false) }
  }
  const decide = async (id, change) => { const j = await post('brainlab-decide', { id, ...change }); if (j) setData(j) }
  const draft = async () => { const j = await post('brainlab-invoice', {}); if (j) { setMade(j); load() } }

  const invoiced = Array.isArray(data?.invoiced) ? data.invoiced : []

  return (
    <div data-brainlab-invoice>
      <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 14, fontWeight: 600 }}>Month{' '}
          <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)}
            style={{ fontSize: 16, padding: '6px 8px', borderRadius: 8, border: '1px solid #d5dde5', marginLeft: 6 }} />
        </label>
        {data && <span style={S.muted}>{data.reference}</span>}
      </div>

      {error && <div style={{ ...S.card, background: '#fdecea', color: '#7f1d1d' }}>{error}</div>}
      {!data && !error && <div style={{ ...S.card, textAlign: 'center', color: '#5b6b7a' }}>Reading the bookings…</div>}

      {data && <>
        <div style={S.card} data-brainlab-summary>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{money(data.net)} <span style={{ fontSize: 13, fontWeight: 500, color: '#5b6b7a' }}>ex GST · {money(data.total)} inc GST</span></div>
              <div style={S.muted}>{data.bill.length} case{data.bill.length === 1 ? '' : 's'} to bill · {data.bill.filter(r => r.kind === 'airo').length} AIRO · {data.bill.filter(r => r.kind === 'nav').length} navigation</div>
            </div>
            {invoiced.length ? (
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0b4f45' }} data-brainlab-done>
                Already in Xero: {invoiced.map(i => `${i.number || 'draft'} (${i.status})`).join(', ')}
              </div>
            ) : (
              <button type="button" style={{ ...S.btn, opacity: data.ask.length || !data.bill.length || busy ? 0.5 : 1 }}
                disabled={Boolean(data.ask.length) || !data.bill.length || busy} onClick={draft} data-brainlab-draft>
                {data.ask.length ? `Answer ${data.ask.length} first` : 'Draft the invoice in Xero'}
              </button>
            )}
          </div>
          {made && <div style={{ marginTop: 8, fontSize: 13, color: '#0b4f45' }}>✓ Draft {made.invoice?.number || ''} made in Xero — {made.lines} lines, {money(made.net)} ex GST. Check it and approve it in Xero.</div>}
        </div>

        {data.ask.length > 0 && (
          <Section title={`To answer · ${data.ask.length}`} tint="#fdf0e1">
            {data.ask.map(r => <Row key={r.id} r={r} decide={decide} busy={busy} ask />)}
          </Section>
        )}
        <Section title={`To bill · ${data.bill.length}`}>
          {data.bill.length ? data.bill.map(r => <Row key={r.id} r={r} decide={decide} busy={busy} />) : <div style={S.muted}>Nothing yet this month.</div>}
        </Section>
        {data.noF2F.length > 0 && (
          <Section title={`No F2F — tracked, not billed · ${data.noF2F.length}`}>
            {data.noF2F.map(r => <Row key={r.id} r={r} decide={decide} busy={busy} />)}
          </Section>
        )}
        {data.notBilled.length > 0 && (
          <Section title={`Not billed · ${data.notBilled.length}`} folded>
            {data.notBilled.map(r => <Row key={r.id} r={r} decide={decide} busy={busy} />)}
          </Section>
        )}
      </>}
    </div>
  )
}

function Section({ title, children, tint, folded }) {
  const [open, setOpen] = useState(!folded)
  return (
    <div style={{ ...S.card, background: tint || 'white' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{ ...S.h, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>{open ? '▾' : '▸'} {title}</button>
      {open && children}
    </div>
  )
}

function Row({ r, decide, busy, ask }) {
  return (
    <div style={S.row} data-brainlab-row={r.id}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{dayLabel(r.date)} · {r.surgeon} · {r.patient}</div>
        <div style={{ fontSize: 13, color: '#0f1d2b' }}>{r.procedure || '—'} · {/CLV|CALVARY/i.test(r.hospital) ? 'Calvary' : r.hospital}</div>
        <div style={S.muted}>
          {r.reason || r.why}{r.reps?.length ? ` · attended: ${r.reps.join(' / ')}` : ''}
          {ask && r.question === 'attended' ? ' · nobody is marked as attended on the booking' : ''}
          {ask && r.question === 'kind' ? ' · VP shunts have been billed both ways — which was it?' : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {r.amount ? <strong style={{ fontSize: 14, marginRight: 4 }}>${r.amount}</strong> : null}
        {['airo', 'nav', 'none'].map(k => (
          <button key={k} type="button" disabled={busy} style={S.chip((r.kind || 'none') === k)}
            onClick={() => decide(r.id, { kind: k })}>{KIND[k] || 'Not billed'}</button>
        ))}
        {((ask && r.question === 'attended') || r.reason === 'Not attended') && <>
          <button type="button" disabled={busy} style={{ ...S.chip(false), borderColor: '#189a85', color: '#0b4f45' }} onClick={() => decide(r.id, { attended: true })}>We attended</button>
          <button type="button" disabled={busy} style={S.chip(false)} onClick={() => decide(r.id, { attended: false })}>Not attended</button>
        </>}
      </div>
    </div>
  )
}
