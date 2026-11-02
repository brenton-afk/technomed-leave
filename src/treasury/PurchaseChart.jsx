import React, { useEffect, useMemo, useRef, useState } from 'react'
import { colour, text, space } from '../design/tokens.js'
import { SERIES } from './LineChart.jsx'
import { dotRadius, PURCHASE_TYPES } from './amber.js'
import { SATS } from './logic.js'

// ─── The purchase chart ──────────────────────────────────────────────────────
// After Strategy's: the price as a line from the first purchase, and a dot on it
// for every buy, its *area* proportional to the A$ spent (radius by square
// root), so a large buy stands out and the A$150 daily buys still read as a
// steady trail — drawn smaller and fainter. Coins that came in without being
// bought (the trust's repayment) are a different mark and colour, never a dot.
//
// One y-axis. Two reference lines: what the coins cost on average, and the
// price now; the gap between them is the unrealised gain or loss.
//
// Touch or hover: the nearest dot within reach is read out above the chart;
// otherwise the price on that day.

const ORANGE = SERIES[1]
const TRANSFER = SERIES[2]
const PRICE = SERIES[0]

function useWidth(fallback = 340) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW(Math.max(260, Math.round(el.getBoundingClientRect().width) || fallback))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, w]
}

const short = d => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function ticks(lo, hi, log) {
  if (log) {
    const out = []
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo && v <= hi) out.push(v) }
    }
    // A range inside one decade (A$110k–190k) has no 1-2-5 step in it, and an
    // axis with no labels says nothing. Fall back to even steps.
    if (hi / lo >= 4 && out.length >= 2) return out
  }
  const step0 = (hi - lo) / 4
  const mag = 10 ** Math.floor(Math.log10(step0))
  // 2.5 as well: over A$108k–197k a 50k step leaves one label; 25k gives three.
  const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= step0) || step0
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v)
  return out
}

/**
 * @param {object} p
 * @param {Array<[string, number]>} p.prices   daily closes in the chosen currency
 * @param {Array} p.dots       from purchaseDots, with priceAud
 * @param {Array} p.transfers  {date, sats, priceAud}
 * @param {(aud:number, date:string)=>number} p.toCur  A$ → chosen currency on a day
 * @param {number|null} p.averageCost   in the chosen currency
 * @param {number|null} p.current       in the chosen currency
 * @param {string} p.currency  'AUD' | 'USD'
 */
export default function PurchaseChart({ prices, dots, transfers = [], toCur, averageCost, current, currency, log = false, height = 280 }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const pad = { l: 54, r: 10, t: 10, b: 24 }
  const plotW = width - pad.l - pad.r
  const plotH = height - pad.t - pad.b
  const money = (v, axis) => {
    if (v == null || !Number.isFinite(v)) return '—'
    if (axis) return `$${v >= 1000 ? `${Math.round(v / 1000).toLocaleString('en-AU')}k` : Math.round(v)}`
    return (currency === 'USD' ? 'US' : 'A') + new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v)
  }

  const model = useMemo(() => {
    if (!prices.length) return null
    const from = prices[0][0]
    const to = prices[prices.length - 1][0]
    const pts = dots.map(d => ({ ...d, y: toCur(d.priceAud, d.date) })).filter(d => d.date >= from && d.y > 0)
    const trs = transfers.map(t => ({ ...t, y: t.priceAud ? toCur(t.priceAud, t.date) : null })).filter(t => t.date >= from && t.y > 0)
    const vals = [...prices.map(p => p[1]), ...pts.map(p => p.y), ...trs.map(t => t.y), averageCost, current].filter(v => v > 0)
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    if (!log) { const span = hi - lo || hi * 0.1; lo = Math.max(0, lo - span * 0.08); hi += span * 0.08 } else { lo *= 0.92; hi *= 1.08 }
    const t0 = Date.parse(from)
    const t1 = Date.parse(to)
    const x = d => pad.l + (t1 === t0 ? plotW / 2 : ((Date.parse(d) - t0) / (t1 - t0)) * plotW)
    const y = log
      ? v => pad.t + plotH - ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * plotH
      : v => pad.t + plotH - ((v - lo) / (hi - lo)) * plotH
    const maxAud = Math.max(...pts.map(p => p.aud), 1)
    const path = prices.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join('')
    const priceMap = new Map(prices)
    return { from, to, pts, trs, x, y, maxAud, path, priceMap, yTicks: ticks(lo, hi, log), xTicks: [from, prices[Math.floor(prices.length / 2)][0], to] }
  }, [prices, dots, transfers, toCur, averageCost, current, log, plotW, plotH, pad.l, pad.t])

  if (!model) return <div ref={ref} style={{ ...text('caption'), color: colour.inkFaint, padding: space.lg, textAlign: 'center' }}>No price history stored yet.</div>
  const { pts, trs, x, y, maxAud, path, priceMap, yTicks, xTicks } = model

  function onMove(e) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = (e.touches?.[0]?.clientX ?? e.clientX) - box.left
    const py = (e.touches?.[0]?.clientY ?? e.clientY) - box.top
    let best = null
    for (const p of [...pts.map(d => ({ kind: 'buy', d })), ...trs.map(d => ({ kind: 'transfer', d }))]) {
      const dist = Math.hypot(x(p.d.date) - px, y(p.d.y) - py)
      if (dist < 26 && (!best || dist < best.dist)) best = { ...p, dist }
    }
    if (best) { setHover(best); return }
    const f = Math.min(1, Math.max(0, (px - pad.l) / plotW))
    const target = Date.parse(model.from) + f * (Date.parse(model.to) - Date.parse(model.from))
    const day = new Date(target).toISOString().slice(0, 10)
    const near = prices.reduce((b, p) => (Math.abs(Date.parse(p[0]) - target) < Math.abs(Date.parse(b[0]) - target) ? p : b), prices[0])
    setHover({ kind: 'price', d: { date: near[0] || day, y: near[1] } })
  }

  const readout = () => {
    if (!hover) return <span style={{ ...text('caption'), color: colour.inkFaint }}>Tap a dot for the purchase. Orange: buys, sized by A$. Faint: daily auto-buys.</span>
    const d = hover.d
    if (hover.kind === 'buy') {
      const kind = PURCHASE_TYPES[d.type] || (d.type === 'week' ? `${d.count} buys that week` : d.type === 'month' ? `${d.count} buys that month` : d.type)
      return (
        <span style={{ ...text('caption'), color: colour.inkMuted }}>
          <b style={{ color: colour.ink }}>{short(d.date)}</b> · {kind} · <b style={{ color: colour.ink }}>A${Math.round(d.aud).toLocaleString('en-AU')}</b> for ₿{(d.sats / SATS).toFixed(8)} at {money(d.y)}
        </span>
      )
    }
    if (hover.kind === 'transfer') {
      return (
        <span style={{ ...text('caption'), color: colour.inkMuted }}>
          <b style={{ color: colour.ink }}>{short(d.date)}</b> · Transfer in{d.from ? ` from ${d.from}` : ''} · ₿{(d.sats / SATS).toFixed(8)}{d.y ? ` at ${money(d.y)}` : ''} — not a purchase
        </span>
      )
    }
    return <span style={{ ...text('caption'), color: colour.inkMuted }}><b style={{ color: colour.ink }}>{short(d.date)}</b> · close {money(d.y)}</span>
  }

  // Average cost labelled at the left, the price now at the right: the two are
  // often close, and labels at the same end would print over each other.
  const label = (v, txt, colourOf, dash, end) => v > 0 && (
    <g>
      <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke={colourOf} strokeDasharray={dash} strokeWidth={1.5} />
      <text x={end ? width - pad.r - 4 : pad.l + 4} y={y(v) + (end && current >= averageCost ? -5 : end ? 14 : averageCost > current ? -5 : 14)}
        textAnchor={end ? 'end' : 'start'} fill={colour.inkMuted} stroke={colour.surface} strokeWidth={3} paintOrder="stroke" style={text('caption')}>{txt}</text>
    </g>
  )

  return (
    <div ref={ref}>
      <div aria-live="polite" style={{ minHeight: 38, marginBottom: space.sm }}>{readout()}</div>
      <svg width={width} height={height} role="img" aria-label={`Bitcoin price in ${currency} with each purchase marked`}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}
        style={{ display: 'block', touchAction: 'pan-y', userSelect: 'none' }}>
        {yTicks.map(v => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke={colour.lineSoft} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fill={colour.inkFaint} style={text('caption')}>{money(v, true)}</text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text key={i} x={x(d)} y={height - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fill={colour.inkFaint} style={text('caption')}>{short(d)}</text>
        ))}
        <path d={path} fill="none" stroke={PRICE} strokeWidth={2} strokeLinejoin="round" />
        {label(averageCost, `Average cost ${money(averageCost)}`, ORANGE, '5 4', false)}
        {label(current, `Now ${money(current)}`, PRICE, '2 3', true)}
        {/* Smallest first, so a large buy is never hidden under the trail. */}
        {[...pts].sort((a, b) => a.aud - b.aud).map((d, i) => (
          <circle key={i} cx={x(d.date)} cy={y(d.y)} r={dotRadius(d.aud, maxAud)} fill={ORANGE}
            fillOpacity={d.auto ? 0.4 : 0.85} stroke={colour.surface} strokeWidth={d.auto ? 0.5 : 1.5} />
        ))}
        {trs.map((t, i) => {
          const cx = x(t.date)
          const cy = y(t.y)
          const s = 9
          return <path key={i} d={`M${cx},${cy - s}L${cx + s},${cy}L${cx},${cy + s}L${cx - s},${cy}Z`} fill={TRANSFER} stroke={colour.surface} strokeWidth={2} />
        })}
        {hover && hover.kind !== 'price' && (
          <circle cx={x(hover.d.date)} cy={y(hover.d.y)} r={(hover.kind === 'buy' ? dotRadius(hover.d.aud, maxAud) : 9) + 3} fill="none" stroke={colour.ink} strokeWidth={1.5} />
        )}
        {hover?.kind === 'price' && priceMap.has(hover.d.date) && (
          <line x1={x(hover.d.date)} x2={x(hover.d.date)} y1={pad.t} y2={pad.t + plotH} stroke={colour.inkFainter} />
        )}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${space.xs}px ${space.md}px`, marginTop: space.sm, ...text('caption'), color: colour.inkMuted }}>
        <span><span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 3, background: PRICE, verticalAlign: 'middle', marginRight: 6 }} />Price</span>
        <span><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: ORANGE, verticalAlign: 'middle', marginRight: 6 }} />Purchase</span>
        <span><span aria-hidden="true" style={{ display: 'inline-block', width: 9, height: 9, background: TRANSFER, transform: 'rotate(45deg)', verticalAlign: 'middle', marginRight: 6 }} />Transfer in</span>
        <span><span aria-hidden="true" style={{ display: 'inline-block', width: 14, borderTop: `2px dashed ${ORANGE}`, verticalAlign: 'middle', marginRight: 6 }} />Average cost</span>
      </div>
    </div>
  )
}
