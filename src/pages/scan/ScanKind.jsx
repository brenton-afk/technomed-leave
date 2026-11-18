import React from 'react'
import { colour, text, radius } from '../../design/tokens.js'

// ─── What is being scanned (Brent, 6 Nov 2026) ───────────────────────────────
// One Scan tab, one camera, and a choice of what the paper is. Usage first, as
// it always was; Resupply beside it. Tray restock and stock-take join this row
// later. Not remembered (Brent, 18 Nov 2026): a phone left on Resupply had
// usage forms scanned into it, so the tab always opens on Usage. A link from
// search may ask for one kind for the next opening only (`saveScanKind`).

export const SCAN_KINDS = [
  { id: 'usage', label: 'Usage' },
  { id: 'resupply', label: 'Resupply' }
]

const KEY = 'tm_scan_kind'

/** The kind to open on: Usage, unless a link asked for another just now (read once). */
export function readScanKind() {
  try {
    const asked = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY) // what older builds remembered
    return SCAN_KINDS.some(k => k.id === asked) ? asked : 'usage'
  } catch { return 'usage' }
}

/** Open the Scan tab on this kind, once (search → a resupply). */
export function saveScanKind(kind) {
  try { sessionStorage.setItem(KEY, kind) } catch { /* private mode: opens on Usage */ }
}

/** The two-way switch, drawn on the navy header of either scan screen. */
export default function ScanKindSwitch({ kind, onChange }) {
  return (
    <div role="tablist" aria-label="What are you scanning?"
      style={{
        display: 'flex', gap: 2, padding: 3, marginTop: 12,
        background: colour.navyDeep, borderRadius: radius.pill
      }}>
      {SCAN_KINDS.map(k => {
        const on = k.id === kind
        return (
          <button key={k.id} type="button" role="tab" aria-selected={on}
            onClick={() => onChange(k.id)}
            style={{
              flex: 1, minHeight: 38, border: 'none', borderRadius: radius.pill, cursor: 'pointer',
              background: on ? 'white' : 'transparent',
              color: on ? colour.navy : 'rgba(255,255,255,0.82)',
              ...text('bodyStrong')
            }}>
            {k.label}
          </button>
        )
      })}
    </div>
  )
}
