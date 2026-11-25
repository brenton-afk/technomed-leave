// A label drawn as SVG, viewBox in millimetres — the library's thumbnails and
// the print sheet's previews. It reads the same layout as Fabric draws in the
// editor and the print (model.layoutText), so what is shown is what prints.
// The artwork's own sizes and colours are the label's, not the app's scale.

import React from 'react'
import { layoutText, fontStack, rotation, cropBox, paint, MM_PER_PT, letterSpacing, trimOffset, TRIM_W, TRIM_H, SAFE_MARGIN } from './model.js'

function TextItem({ item }) {
  const ls = letterSpacing(item)
  return (
    <g transform={rotation(item) || undefined}>
      {layoutText(item).map((line, i) => line.segments.length ? (
        <text key={i} x={line.anchorX} y={line.baseline} textAnchor={line.anchor} xmlSpace="preserve" style={{ whiteSpace: 'pre' }}>
          {line.segments.map((s, j) => (
            <tspan key={j} fontFamily={fontStack(s.font)} fontSize={(Number(s.size) || 8) * MM_PER_PT}
              fill={paint(s.color)} fontWeight={s.bold ? 700 : 400} fontStyle={s.italic ? 'italic' : 'normal'}
              textDecoration={s.underline ? 'underline' : undefined}
              letterSpacing={ls ? (ls / 1000) * (Number(s.size) || 8) * MM_PER_PT : undefined}>{s.text}</tspan>
          ))}
        </text>
      ) : null)}
    </g>
  )
}

function ImageItem({ item, logo }) {
  if (!logo?.url) {
    return <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="none" stroke="#c9d2da" strokeWidth={0.15} strokeDasharray="0.6 0.4" transform={rotation(item) || undefined} />
  }
  const c = cropBox(item, logo)
  return (
    <g transform={rotation(item) || undefined}>
      <svg x={item.x} y={item.y} width={item.w} height={item.h} viewBox={`${c.sx} ${c.sy} ${c.sw} ${c.sh}`} preserveAspectRatio="none" overflow="hidden">
        <image href={logo.url} x={0} y={0} width={c.iw} height={c.ih} preserveAspectRatio="none" />
      </svg>
    </g>
  )
}

function ShapeItem({ item }) {
  const fill = paint(item.fill)
  const stroke = item.stroke ? { stroke: paint(item.stroke.color), strokeWidth: item.stroke.width } : {}
  const t = rotation(item) || undefined
  if (item.t === 'ellipse') return <ellipse cx={item.x + item.w / 2} cy={item.y + item.h / 2} rx={item.w / 2} ry={item.h / 2} fill={fill} {...stroke} transform={t} />
  return <rect x={item.x} y={item.y} width={item.w} height={item.h} fill={fill} {...(item.t === 'line' ? {} : stroke)} transform={t} />
}

/**
 * @param trimmed  true: only the 68 × 21 mm that prints (thumbnails); false:
 *                 the whole canvas with bleed, trim and safe-area lines.
 */
export default function LabelSvg({ label, logos = {}, trimmed = true, style, title }) {
  if (!label) return null
  const off = trimOffset(label)
  const viewBox = trimmed ? `${off.x} ${off.y} ${TRIM_W} ${TRIM_H}` : `0 0 ${label.w} ${label.h}`
  const clipId = `trim-${String(label.id || 'new').replace(/[^\w-]/g, '')}`
  return (
    <svg viewBox={viewBox} role="img" aria-label={title || label.name} data-label-svg={label.id || ''}
      style={{ display: 'block', width: '100%', height: 'auto', background: '#ffffff', ...style }}>
      <defs>
        <clipPath id={clipId}><rect x={trimmed ? off.x : 0} y={trimmed ? off.y : 0} width={trimmed ? TRIM_W : label.w} height={trimmed ? TRIM_H : label.h} /></clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect x={0} y={0} width={label.w} height={label.h} fill="#ffffff" />
        {(label.items || []).map(item => (
          item.t === 'txt' ? <TextItem key={item.id} item={item} />
            : item.t === 'img' ? <ImageItem key={item.id} item={item} logo={logos[item.k]} />
              : <ShapeItem key={item.id} item={item} />
        ))}
      </g>
      {!trimmed && (
        <g fill="none" pointerEvents="none">
          <path d={`M0 0H${label.w}V${label.h}H0Z M${off.x} ${off.y}V${off.y + TRIM_H}H${off.x + TRIM_W}V${off.y}Z`} fill="rgba(15,30,43,0.08)" fillRule="evenodd" />
          <rect x={off.x} y={off.y} width={TRIM_W} height={TRIM_H} stroke="#b42318" strokeWidth={0.12} />
          <rect x={off.x + SAFE_MARGIN} y={off.y + SAFE_MARGIN} width={TRIM_W - 2 * SAFE_MARGIN} height={TRIM_H - 2 * SAFE_MARGIN} stroke="#189a85" strokeWidth={0.1} strokeDasharray="0.6 0.4" />
        </g>
      )}
    </svg>
  )
}
