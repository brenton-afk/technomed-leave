import React, { useEffect, useRef, useState, useMemo } from 'react'
import { colour, text, space } from '../design/tokens.js'

// ─── A small line chart, drawn by hand ───────────────────────────────────────
// SVG rather than a charting library: the four Treasury charts need lines,
// reference lines, coloured points and a crosshair, and a library for that is
// a few hundred kilobytes on a phone that is often on one bar of signal.
//
// One y-axis per chart, always. Series take the fixed categorical order below
// (validated for colour-blind separation), never cycled. Text stays in ink;
// the colour belongs to the line and its swatch. Touch or hover moves a
// crosshair, and the readout above the plot lists every series at that day.

/** Categorical order. Slot 1 is always price. */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']

function useWidth(fallback = 340) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW(Math.max(240, Math.round(el.getBoundingClientRect().width) || fallback))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, w]
}

function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min]
  const step0 = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  // No 2.5: a step of 0.025 prints as "0.97" at two decimals and misleads.
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= step0) || step0
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

function logTicks(min, max) {
  const out = []
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 3]) { const v = m * 10 ** e; if (v >= min && v <= max) out.push(v) }
  }
  return out
}

const shortDate = d => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
}

/**
 * @param {object} p
 * @param {Array<{id, label, data: Array<[string, number]>, color?, points?: (v:number)=>string}>} p.series
 * @param {Array<{y:number, label:string}>} [p.refs]
 * @param {boolean} [p.log]
 * @param {(v:number)=>string} p.format
 */
export default function LineChart({ series, refs = [], log = false, format, height = 220, title }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const pad = { l: 52, r: 10, t: 8, b: 24 }
  const plotW = width - pad.l - pad.r
  const plotH = height - pad.t - pad.b

  const model = useMemo(() => {
    const days = [...new Set(series.flatMap(s => s.data.map(p => p[0])))].sort()
    if (!days.length) return null
    const values = series.flatMap(s => s.data.map(p => p[1])).concat(refs.map(r => r.y)).filter(v => Number.isFinite(v) && (!log || v > 0))
    let lo = Math.min(...values)
    let hi = Math.max(...values)
    if (lo === hi) { lo -= 1; hi += 1 }
    const span = hi - lo
    if (!log) { lo -= span * 0.05; hi += span * 0.05 }
    const t0 = Date.parse(days[0])
    const t1 = Date.parse(days[days.length - 1])
    const x = d => pad.l + (t1 === t0 ? plotW / 2 : ((Date.parse(d) - t0) / (t1 - t0)) * plotW)
    const y = log
      ? v => pad.t + plotH - ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * plotH
      : v => pad.t + plotH - ((v - lo) / (hi - lo)) * plotH
    const yTicks = log ? logTicks(lo, hi) : niceTicks(lo, hi)
    const xTicks = [0, 0.5, 1].map(f => days[Math.round(f * (days.length - 1))])
    const maps = series.map(s => new Map(s.data))
    return { days, x, y, yTicks, xTicks, maps, lo, hi }
  }, [series, refs, log, plotW, plotH, pad.l, pad.t])

  if (!model) {
    return <div ref={ref} style={{ ...text('caption'), color: colour.inkFaint, padding: space.lg, textAlign: 'center' }}>No history stored yet.</div>
  }

  const { days, x, y, yTicks, xTicks, maps } = model
  const path = data => data.filter(([, v]) => Number.isFinite(v) && (!log || v > 0))
    .map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join('')

  const onMove = e => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = (e.touches?.[0]?.clientX ?? e.clientX) - box.left
    const f = Math.min(1, Math.max(0, (px - pad.l) / plotW))
    const t = Date.parse(days[0]) + f * (Date.parse(days[days.length - 1]) - Date.parse(days[0]))
    let best = days[0]
    for (const d of days) if (Math.abs(Date.parse(d) - t) < Math.abs(Date.parse(best) - t)) best = d
    setHover(best)
  }
  const day = hover || days[days.length - 1]

  return (
    <div ref={ref}>
      {/* The readout: always the latest day, or the one under the finger. */}
      <div aria-live="polite" style={{ display: 'flex', flexWrap: 'wrap', gap: `${space.xs}px ${space.md}px`, marginBottom: space.sm, minHeight: 40 }}>
        <span style={{ ...text('caption'), color: colour.inkFaint, width: '100%' }}>{shortDate(day)}{hover ? '' : ' · latest'}</span>
        {series.map((s, i) => {
          const v = maps[i].get(day)
          return (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ width: 10, height: 3, borderRadius: 2, background: s.color || SERIES[i] }} />
              <span style={{ ...text('bodyStrong'), color: colour.ink }}>{v == null ? '—' : format(v)}</span>
              <span style={{ ...text('caption'), color: colour.inkMuted }}>{s.label}</span>
            </span>
          )
        })}
      </div>
      <svg width={width} height={height} role="img" aria-label={title}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}
        style={{ display: 'block', touchAction: 'pan-y', userSelect: 'none' }}>
        {yTicks.map(v => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke={colour.lineSoft} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fill={colour.inkFaint} style={text('caption')}>{format(v, true)}</text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text key={d + i} x={x(d)} y={height - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fill={colour.inkFaint} style={text('caption')}>{shortDate(d)}</text>
        ))}
        {refs.map(r => (
          <g key={r.label}>
            <line x1={pad.l} x2={width - pad.r} y1={y(r.y)} y2={y(r.y)} stroke={colour.inkFainter} strokeDasharray="4 4" />
            {/* Left edge, haloed: the right edge is where the latest point and
                the crosshair sit, and a label there disappears under them. */}
            <text x={pad.l + 4} y={y(r.y) - 4} textAnchor="start" fill={colour.inkMuted}
              stroke={colour.surface} strokeWidth={3} paintOrder="stroke" style={text('caption')}>{r.label}</text>
          </g>
        ))}
        {series.map((s, i) => (
          <path key={s.id} d={path(s.data)} fill="none" stroke={s.color || SERIES[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            opacity={s.points ? 0.35 : 1} />
        ))}
        {series.filter(s => s.points).map(s => s.data.map(([d, v]) => (
          <circle key={s.id + d} cx={x(d)} cy={y(v)} r={2.4} fill={s.points(v)} />
        )))}
        <line x1={x(day)} x2={x(day)} y1={pad.t} y2={pad.t + plotH} stroke={colour.inkFainter} />
        {series.map((s, i) => {
          const v = maps[i].get(day)
          return v == null ? null : <circle key={s.id} cx={x(day)} cy={y(v)} r={4.5} fill={s.points ? s.points(v) : (s.color || SERIES[i])} stroke={colour.surface} strokeWidth={2} />
        })}
      </svg>
    </div>
  )
}
