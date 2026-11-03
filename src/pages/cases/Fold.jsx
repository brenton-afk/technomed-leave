import React, { useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'

// ─── A section that folds to one line ─────────────────────────────────────────
// "The add booking page is getting a bit busy. Is there a way to simplify it?"
// — Brent, 3 Nov 2026, who chose folding the busy parts over a read-only
// summary. Each fold shows its label and its current value on one line — so
// the booking can still be read at a glance — and opens on a tap to change it.
// Used by Edit booking and Add a booking alike, so the two behave the same.

export default function Fold({ label, summary, defaultOpen = false, mustOpen = false, children, empty = 'None' }) {
  const [chosen, setOpen] = useState(defaultOpen)
  // Held open while it still needs an answer (a Brainlab case with no
  // attendance chosen): a required question cannot be folded out of sight.
  const open = chosen || mustOpen
  return (
    <div style={{
      marginBottom: space.sm, borderRadius: radius.control,
      background: colour.surface, border: `1px solid ${colour.line}`
    }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        aria-label={`${label}: ${summary || empty}. ${open ? 'Close' : 'Change'}`}
        style={{
          display: 'flex', alignItems: 'center', gap: space.sm, width: '100%', minHeight: 48,
          padding: `${space.sm}px ${space.md}px`, background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left'
        }}>
        <span style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, flexShrink: 0, minWidth: 74 }}>
          {label}
        </span>
        <span style={{
          ...text('bodyStrong'), color: summary ? colour.ink : colour.inkFainter, flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>{summary || empty}</span>
        <span aria-hidden="true" style={{ ...text('caption'), fontWeight: 600, color: colour.accentDeep, flexShrink: 0 }}>
          {open ? 'Done' : 'Change'}
        </span>
      </button>
      {open && (
        <div style={{ padding: `0 ${space.md}px ${space.sm}px` }}>
          {children}
        </div>
      )}
    </div>
  )
}
