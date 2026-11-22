// Shared look for the stock-on-hand preview screens: the mock-ups' own
// colours (they are the portal's navy and teal), and a few small style helpers
// so every screen reads the same. Preview only — nothing here talks to the
// server.

export const ink = '#0f1d2b'
export const muted = '#5b6b7a'
export const line = '#e3e8ee'
export const hair = '#edf1f5'
export const ground = '#f4f6f8'
export const navy = '#042746'
export const navySoft = '#0b3a63'
export const teal = '#189a85'
export const tealInk = '#0f7a69'
export const tealSoft = '#e3f4f1'
export const rhh = '#2f6fa8'
export const restockGrey = '#9aa9b7'
export const amberSoft = '#fdf0e1'
export const amberInk = '#7c2d12'
export const redSoft = '#fdecea'
export const redInk = '#7f1d1d'
export const blueSoft = '#eef4fa'
export const blueInk = '#1e3a5f'

export const font = 'Inter, -apple-system, system-ui, sans-serif'
export const band = 'linear-gradient(120deg, #0b3a63, #042746 60%, #021a30)'

export const card = { background: '#fff', border: `1px solid ${line}`, borderRadius: 16, padding: 16 }

/** A round chip; `on` fills it navy. */
export const chip = on => ({
  font: `600 12px ${font}`, padding: '7px 11px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
  border: on ? 0 : '1px solid #d5dde5', background: on ? navy : '#fff', color: on ? '#fff' : ink
})

/** A chip on the navy band; `on` fills it teal. */
export const bandChip = on => ({
  font: `600 12px ${font}`, padding: '8px 12px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
  border: on ? 0 : '1px solid #2c5a82', background: on ? teal : navySoft, color: on ? '#fff' : '#dce8f2'
})

export const primary = { font: `600 14px ${font}`, minHeight: 44, padding: '0 14px', borderRadius: 12, border: 0, background: teal, color: '#fff', cursor: 'pointer' }
export const secondary = { font: `600 14px ${font}`, minHeight: 44, padding: '0 14px', borderRadius: 12, border: '1px solid #d5dde5', background: '#fff', color: ink, cursor: 'pointer' }

export const pill = (bg, fg) => ({ fontSize: 12, fontWeight: 600, background: bg, color: fg, borderRadius: 999, padding: '6px 10px' })

/** What a tap on something not built yet says. */
export const notBuilt = what => `${what} — not built yet. This is a preview with made-up data.`
