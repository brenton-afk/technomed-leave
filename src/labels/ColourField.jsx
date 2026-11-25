// A colour control for label artwork: the colours already used across the
// labels as swatches, the browser's picker, and CMYK numbers for print —
// converted to the same RGB the screen and the printer driver are given.

import React, { useState } from 'react'
import { colour, text, space, radius, border } from '../design/tokens.js'
import { toHex, cmykToRgb } from './model.js'

const small = { ...text('field'), width: 46, padding: '4px 4px', border: border.hairline, borderRadius: 6, textAlign: 'center', boxSizing: 'border-box' }

/** Rough CMYK of an RGB colour, to start the boxes from. */
function rgbToCmyk(hex) {
  const h = toHex(hex) || '#000000'
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return [0, 0, 0, 100]
  return [r, g, b].map(v => Math.round(((1 - v - k) / (1 - k)) * 100)).concat(Math.round(k * 100))
}

export default function ColourField({ label, value, swatches = [], onChange, allowNone = false }) {
  const hex = toHex(value)
  const [cmyk, setCmyk] = useState(null)
  const shown = cmyk || rgbToCmyk(hex || '#000000')
  const useCmyk = () => {
    const { r, g, b } = cmykToRgb(...shown)
    onChange(toHex(`rgb(${r}, ${g}, ${b})`))
    setCmyk(null)
  }
  return (
    <div data-colour-field={label} style={{ marginBottom: space.md }}>
      <div style={{ ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        {allowNone && (
          <button type="button" title="None" aria-label="No colour" onClick={() => onChange(null)}
            style={{ width: 24, height: 24, borderRadius: 6, border: !hex ? `2px solid ${colour.accent}` : border.hairline, background: `linear-gradient(135deg, #fff 45%, ${colour.danger} 47%, ${colour.danger} 53%, #fff 55%)`, cursor: 'pointer' }} />
        )}
        {swatches.map(s => (
          <button type="button" key={s} title={s} aria-label={`Colour ${s}`} onClick={() => onChange(s)} data-swatch={s}
            style={{ width: 24, height: 24, borderRadius: 6, background: s, cursor: 'pointer', border: hex === s ? `2px solid ${colour.accent}` : border.hairline, boxSizing: 'border-box' }} />
        ))}
        <label title="Any colour" style={{ position: 'relative', width: 24, height: 24, borderRadius: 6, border: border.hairline, overflow: 'hidden', cursor: 'pointer', background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
          <input type="color" aria-label={`${label}: pick any colour`} value={hex || '#000000'} onChange={e => onChange(e.target.value)}
            style={{ fontSize: 16, opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
        </label>
        <span style={{ ...text('caption'), color: colour.inkMuted, marginLeft: 4 }}>{hex || 'none'}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ ...text('caption'), color: colour.inkFaint, marginRight: 2 }}>CMYK</span>
        {['C', 'M', 'Y', 'K'].map((c, i) => (
          <input key={c} aria-label={`${label} ${c}`} inputMode="numeric" value={shown[i]} style={small}
            onChange={e => { const next = [...shown]; next[i] = Math.max(0, Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0)); setCmyk(next) }}
            onKeyDown={e => { if (e.key === 'Enter') useCmyk() }} />
        ))}
        {cmyk && <button type="button" onClick={useCmyk} style={{ ...text('caption'), padding: '4px 10px', borderRadius: radius.control, border: border.hairline, background: colour.accentSoft, color: colour.accentDeep, cursor: 'pointer' }}>Use</button>}
      </div>
    </div>
  )
}
