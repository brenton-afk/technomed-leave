import React from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'

// ─── The pages of a scan (Brent, 6 Nov 2026) ─────────────────────────────────
// "Make sure the scanning button is the same in the resupply tab as the usage
// tab … mimic the scan pages of Google Drive and play with the design so it
// looks sleek and consistent across the tabs."
//
// One component for every kind of scan, so Usage and Resupply (and the tray
// restock and stock-take to come) cannot drift apart. Drive's shape: a calm
// card with one big round shutter before the first page; afterwards the pages
// themselves as a strip of thumbnails ending in a "+" tile, and one wide pill
// to carry on. Brand colours and the app's type scale throughout.

const SHADOW = '0 1px 2px rgba(4,39,70,0.06), 0 10px 30px rgba(4,39,70,0.10)'

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const CameraGlyph = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="13" r="3.4" />
  </svg>
)

const UploadGlyph = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
  </svg>
)

const PlusGlyph = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/** A page with its corners found — the picture of what the scanner does. */
function PageArt() {
  const c = colour.accent
  return (
    <svg width="112" height="132" viewBox="0 0 112 132" aria-hidden="true">
      <rect x="20" y="14" width="72" height="96" rx="6" fill={colour.surface} stroke={colour.line} strokeWidth="1.5" />
      {[30, 40, 50, 60, 70, 80].map((y, i) => (
        <rect key={y} x="30" y={y} width={i % 3 === 2 ? 34 : 52} height="4" rx="2" fill={colour.lineSoft} />
      ))}
      <rect x="20" y="58" width="72" height="2" fill={c} opacity="0.55" />
      {/* the corners the scanner finds */}
      <path d="M12 26V8h18M100 26V8H82M12 98v18h18M100 98v18H82" fill="none" stroke={c} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Drive's shutter: a white ring around a solid teal button. */
function Shutter({ onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      style={{
        width: 84, height: 84, borderRadius: '50%', padding: 0, cursor: 'pointer',
        border: `4px solid ${colour.accentSoft}`, background: colour.surface,
        boxShadow: '0 8px 22px rgba(24,154,133,0.30)',
        display: 'grid', placeItems: 'center'
      }}>
      <span style={{
        width: 64, height: 64, borderRadius: '50%', background: colour.accent,
        color: colour.surface, display: 'grid', placeItems: 'center'
      }}>
        <CameraGlyph size={28} />
      </span>
    </button>
  )
}

const pill = primary => ({
  width: '100%', minHeight: 52, borderRadius: radius.pill, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  ...text('bodyStrong'),
  background: primary ? colour.accent : colour.surface,
  color: primary ? colour.surface : colour.navy,
  border: primary ? 'none' : `1px solid ${colour.line}`,
  boxShadow: primary ? '0 6px 18px rgba(24,154,133,0.28)' : 'none'
})

/**
 * @param pages      [{ id, preview, name }]
 * @param scanLabel  what is being scanned: "Scan the usage form"
 * @param hint       one line under it
 */
export default function ScanPages({
  pages, busy, scanLabel, hint = 'Hold the phone over the page — the edges are found and it captures by itself.',
  onScan, onUpload, onRemove, onMove, onRead
}) {
  if (!pages.length) {
    return (
      <div data-scan-start style={{
        background: colour.surface, borderRadius: 24, boxShadow: SHADOW,
        padding: `${space.xl}px ${space.lg}px ${space.lg}px`, marginBottom: space.md,
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
      }}>
        <PageArt />
        <div style={{ ...text('title'), color: colour.ink, marginTop: space.sm }}>{scanLabel}</div>
        <div style={{ ...text('caption'), color: colour.inkFaint, margin: `${space.xs}px 0 ${space.lg}px`, maxWidth: 280 }}>{hint}</div>
        <Shutter onClick={onScan} label={scanLabel} />
        <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.accentDeep, marginTop: space.sm }}>Scan</div>
        <button type="button" onClick={onUpload}
          style={{ ...pill(false), minHeight: 46, marginTop: space.lg, color: colour.inkMuted }}>
          <UploadGlyph />Upload a photo or PDF
        </button>
      </div>
    )
  }

  return (
    <div data-scan-pages style={{ marginBottom: space.md }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, marginBottom: space.sm }}>
        <span style={{ ...text('heading'), color: colour.ink }}>
          {pages.length} page{pages.length === 1 ? '' : 's'}
        </span>
        <span style={{ ...text('caption'), color: colour.inkFaint }}>ready to read</span>
      </div>

      {/* The pages, Drive-style: a strip of thumbnails ending in "+". */}
      <div style={{
        display: 'flex', gap: space.sm, overflowX: 'auto', padding: `${space.xs}px 2px ${space.md}px`,
        WebkitOverflowScrolling: 'touch'
      }}>
        {pages.map((p, i) => (
          <div key={p.id} style={{
            flex: '0 0 auto', width: 112, aspectRatio: '3/4', borderRadius: 14, overflow: 'hidden',
            background: colour.surface, boxShadow: SHADOW, display: 'flex', flexDirection: 'column'
          }}>
            <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', background: colour.lineSoft }}>
              {p.preview
                ? <img src={p.preview} alt={`Page ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ ...text('micro'), color: colour.inkFaint }}>PDF</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', height: 34, borderTop: `1px solid ${colour.lineSoft}` }}>
              {pages.length > 1 ? (
                <button type="button" onClick={() => onMove(p.id, -1)} disabled={i === 0}
                  aria-label={`Move page ${i + 1} earlier`}
                  style={{ width: 30, height: '100%', border: 'none', background: 'none', ...text('heading'),
                    color: i === 0 ? colour.inkFainter : colour.navy, cursor: i === 0 ? 'default' : 'pointer' }}>‹</button>
              ) : <span style={{ width: 30 }} />}
              <span style={{ flex: 1, textAlign: 'center', ...text('caption'), fontWeight: 700, color: colour.ink }}>{i + 1}</span>
              <button type="button" onClick={() => onRemove(p.id)} aria-label={`Remove page ${i + 1}`}
                style={{ width: 30, height: '100%', border: 'none', background: 'none', ...text('heading'), color: colour.danger, cursor: 'pointer' }}>×</button>
              {pages.length > 1 && (
                <button type="button" onClick={() => onMove(p.id, 1)} disabled={i === pages.length - 1}
                  aria-label={`Move page ${i + 1} later`}
                  style={{ width: 30, height: '100%', border: 'none', background: 'none', ...text('heading'),
                    color: i === pages.length - 1 ? colour.inkFainter : colour.navy, cursor: i === pages.length - 1 ? 'default' : 'pointer' }}>›</button>
              )}
            </div>
          </div>
        ))}
        <button type="button" onClick={onScan} aria-label="Add a page"
          style={{
            flex: '0 0 auto', width: 112, aspectRatio: '3/4', borderRadius: 14, cursor: 'pointer',
            border: `2px dashed ${colour.accent}`, background: colour.accentSoft, color: colour.accentDeep,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: space.xs,
            ...text('caption'), fontWeight: 700
          }}>
          <PlusGlyph />Add page
        </button>
      </div>

      <button type="button" onClick={onRead} disabled={busy}
        style={{ ...pill(true), opacity: busy ? 0.65 : 1, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Reading…' : `Read ${pages.length} page${pages.length === 1 ? '' : 's'}`}
      </button>
      <button type="button" onClick={onUpload}
        style={{ ...pill(false), minHeight: 44, marginTop: space.sm, border: 'none', background: 'transparent', color: colour.inkMuted }}>
        <UploadGlyph />Upload a photo or PDF
      </button>
    </div>
  )
}

/** The button that starts a new scan — the same pill on every scan screen. */
export function NewScanButton({ label, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ ...pill(true), minHeight: 56, marginBottom: space.md }}>
      <CameraGlyph size={22} />{label}
    </button>
  )
}
