import React, { useCallback, useEffect, useState } from 'react'
import { colour, text, space, radius, border, card } from '../../design/tokens.js'
import { formatStamp, formatClock } from '../../clinicalPlan/week.js'

// ─── Pieces every Treasury screen shares ─────────────────────────────────────

export class Locked extends Error {}

/** One call to /api/treasury. A 403 means the 15-minute unlock ran out. */
export async function treasuryCall(user, action, { method = 'GET', body, query = {} } = {}) {
  const qs = new URLSearchParams({ action, ...query }).toString()
  const res = await fetch(`/api/treasury?${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  if (res.status === 403) throw new Locked()
  if (res.status === 404) throw new Error('Not available.')
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error || 'That did not go through.')
  return data
}

/** Loads one action and offers a reload. Never shows a raw error. */
export function useTreasury(user, action, { query = {}, onLocked, page } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(true)
  const key = JSON.stringify(query)
  const load = useCallback(async (extra = {}) => {
    setBusy(true)
    try {
      setData(await treasuryCall(user, action, { query: { ...JSON.parse(key), ...(page ? { page } : {}), ...extra } }))
      setError(null)
    } catch (err) {
      if (err instanceof Locked) onLocked?.()
      else setError(err.message)
    } finally { setBusy(false) }
  }, [user, action, key, onLocked, page])
  useEffect(() => { load() }, [load])
  return { data, error, busy, reload: load, setData }
}

export function Stale({ problem }) {
  return (
    <span title={problem || 'Showing the last stored value'} style={{
      ...text('micro'), color: colour.warning, background: colour.warningSoft,
      border: `1px solid ${colour.warningLine}`, borderRadius: radius.pill, padding: '1px 6px', marginLeft: 6,
      textTransform: 'uppercase', whiteSpace: 'nowrap'
    }}>Stale</span>
  )
}

export function when(iso) {
  if (!iso) return 'never'
  try { return formatStamp(iso) } catch { return iso }
}

/** A headline number. */
export function Figure({ label, value, sub, stale, problem, tone, onClick }) {
  const fg = tone === 'danger' ? colour.danger : tone === 'warning' ? colour.warning : colour.ink
  return (
    <div onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      style={{ ...card(), padding: space.md, cursor: onClick ? 'pointer' : 'default', minWidth: 0 }}>
      <div style={{ ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {stale && <Stale problem={problem} />}
      </div>
      <div style={{ ...text('title'), color: fg, marginTop: 4, overflowWrap: 'anywhere' }}>{value}</div>
      {sub && <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function Grid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: space.sm, marginBottom: space.md }}>{children}</div>
}

/**
 * The box every field shares. Each screen spreads it with text('field') in a
 * local `inputStyle`, which is what design/noZoom.test.js can see: a field
 * under 16px zooms an iPhone on focus and never zooms back.
 */
export const fieldBox = {
  width: '100%', boxSizing: 'border-box', padding: `${space.sm + 2}px ${space.md}px`,
  border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink
}

export function Field({ label, children, hint }) {
  return (
    <label style={{ display: 'block', marginBottom: space.md }}>
      <span style={{ ...text('caption'), color: colour.inkMuted, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
      {hint && <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block', marginTop: 4 }}>{hint}</span>}
    </label>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <div role="tablist" style={{ display: 'inline-flex', border: border.hairline, borderRadius: radius.pill, padding: 2, background: colour.surface }}>
      {options.map(o => (
        <button key={o.id} role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}
          style={{
            ...text('caption'), fontWeight: 600, border: 'none', borderRadius: radius.pill, padding: '5px 12px', cursor: 'pointer',
            background: value === o.id ? colour.navy : 'transparent', color: value === o.id ? 'white' : colour.inkMuted
          }}>{o.label}</button>
      ))}
    </div>
  )
}

export function Table({ head, rows, align = [] }) {
  return (
    <div style={{ overflowX: 'auto', ...card(), marginBottom: space.md }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...text('caption') }}>
        <thead>
          <tr>{head.map((h, i) => (
            <th key={i} style={{ textAlign: align[i] || 'left', padding: `${space.sm}px ${space.md}px`, color: colour.inkFaint, fontWeight: 600, borderBottom: border.hairline, whiteSpace: 'nowrap' }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, j) => (
            <tr key={j}>{r.map((c, i) => (
              <td key={i} style={{ textAlign: align[i] || 'left', padding: `${space.sm}px ${space.md}px`, color: colour.ink, borderBottom: j === rows.length - 1 ? 'none' : border.hairlineSoft, whiteSpace: i === 0 ? 'nowrap' : 'normal' }}>{c}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Note({ children }) {
  return <div style={{ ...text('caption'), color: colour.inkFaint, margin: `${space.xs}px 0 ${space.md}px` }}>{children}</div>
}

export function Problem({ children }) {
  if (!children) return null
  return <div role="alert" style={{ ...text('caption'), color: colour.warning, background: colour.warningSoft, border: `1px solid ${colour.warningLine}`, borderRadius: radius.control, padding: space.md, marginBottom: space.md }}>{children}</div>
}

export function SmallButton({ children, onClick, disabled, tone }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...text('caption'), fontWeight: 600, padding: '6px 12px', borderRadius: radius.pill, cursor: disabled ? 'default' : 'pointer',
      border: tone === 'danger' ? `1px solid ${colour.dangerLine}` : border.hairline,
      background: colour.surface, color: tone === 'danger' ? colour.danger : colour.navy, opacity: disabled ? 0.5 : 1
    }}>{children}</button>
  )
}

const buyInputStyle = { ...fieldBox, ...text('field') }

/**
 * One buy: date, A$ spent, sats received, price, entity, note. Used to confirm
 * this week's buy before it is logged, to add a past one and to correct any
 * logged one — so a buy is only ever recorded as it actually happened.
 */
export function BuyForm({ initial, entities, title, submitLabel, onSubmit, onCancel, onDelete, note }) {
  const [b, setB] = useState(initial)
  const [busy, setBusy] = useState(false)
  const set = k => e => setB({ ...b, [k]: e.target.value })
  async function go(fn) { setBusy(true); try { await fn() } finally { setBusy(false) } }
  return (
    <div style={{ ...card(), padding: space.md + 2, marginBottom: space.sm }}>
      {title && <div style={{ ...text('heading'), color: colour.ink, marginBottom: space.sm }}>{title}</div>}
      {note && <Note>{note}</Note>}
      <Field label="Date"><input style={buyInputStyle} type="date" value={b.date || ''} onChange={set('date')} /></Field>
      <Field label="A$ spent"><input style={buyInputStyle} inputMode="decimal" value={b.aud ?? ''} onChange={set('aud')} /></Field>
      <Field label="Sats received" hint="From Amber's confirmation. Leave blank to work it out from the price.">
        <input style={buyInputStyle} inputMode="numeric" value={b.sats ?? ''} onChange={set('sats')} />
      </Field>
      <Field label="Price (A$ per BTC)" hint="Leave blank to work it out from the sats.">
        <input style={buyInputStyle} inputMode="decimal" value={b.priceAud ?? ''} onChange={set('priceAud')} />
      </Field>
      <Field label="Entity">
        <select style={buyInputStyle} value={b.entity || ''} onChange={set('entity')}>
          {entities.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </Field>
      <Field label="Note"><input style={buyInputStyle} value={b.note || ''} onChange={set('note')} /></Field>
      <div style={{ display: 'grid', gap: space.sm }}>
        <button disabled={busy} onClick={() => go(() => onSubmit(b))} style={{
          ...text('bodyStrong'), padding: `${space.md + 1}px ${space.lg}px`, borderRadius: radius.control,
          border: 'none', background: colour.accent, color: 'white', cursor: 'pointer', opacity: busy ? 0.5 : 1
        }}>{submitLabel}</button>
        {onDelete && <SmallButton tone="danger" disabled={busy} onClick={() => go(onDelete)}>Remove this buy</SmallButton>}
        <SmallButton disabled={busy} onClick={onCancel}>Cancel</SmallButton>
      </div>
    </div>
  )
}

/**
 * The live price, the same on every Bitcoin page: AUD and USD, the change over
 * 24 hours, and when it was read. From the server's 60-second Kraken cache,
 * re-asked every minute while the screen is open. If Kraken is down it shows
 * the last price it has, with the Stale badge.
 */
export function PriceBar({ user }) {
  const [p, setP] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => {
      if (document.visibilityState === 'hidden') return
      treasuryCall(user, 'price').then(r => { if (live) setP(r.price) }).catch(() => {})
    }
    load()
    const t = setInterval(load, 60 * 1000)
    document.addEventListener('visibilitychange', load)
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', load) }
  }, [user])
  if (!p) return null
  const chg = v => {
    if (v == null || !Number.isFinite(v)) return null
    const up = v >= 0
    return <span style={{ color: up ? colour.success : colour.danger, fontWeight: 600 }}>{up ? '▲' : '▼'} {Math.abs(v).toFixed(2)}%</span>
  }
  const fmt = (n, cur) => new Intl.NumberFormat(cur === 'USD' ? 'en-US' : 'en-AU', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n)
  return (
    <div role="status" aria-label="Bitcoin price" style={{
      ...card(), display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: `${space.xs}px ${space.md}px`,
      padding: `${space.sm + 2}px ${space.md}px`, marginBottom: space.md
    }}>
      <span style={{ ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase' }}>BTC</span>
      <span style={{ ...text('heading'), color: colour.ink }}>{fmt(p.aud, 'AUD')}</span>
      <span style={{ ...text('caption'), color: colour.inkMuted }}>{chg(p.change24?.aud)}</span>
      <span style={{ ...text('caption'), color: colour.inkMuted }}>US{fmt(p.usd, 'USD')} {chg(p.change24?.usd)}</span>
      <span style={{ ...text('caption'), color: colour.inkFaint, marginLeft: 'auto' }}>
        24h · updated {formatClock(p.at)}{p.stale && <Stale problem="Kraken did not answer; this is the last price stored" />}
      </span>
    </div>
  )
}
