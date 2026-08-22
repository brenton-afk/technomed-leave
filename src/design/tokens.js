// ─── Design tokens ────────────────────────────────────────────────────────────
// One source for colour, type and spacing. The app had grown eleven different
// font sizes and five competing accent colours, which is most of why it read as
// unpolished — inconsistency looks like carelessness even when each screen is
// individually fine.
//
// Rules this encodes:
//   · one accent (teal). Every other colour is either neutral or semantic.
//   · a closed type scale. If a size is not here, it should not be used.
//   · hairline borders instead of drop shadows, except where something floats.

export const colour = {
  // Brand
  navy: '#042746',
  navyDeep: '#021b31',
  navySoft: '#0d3a5f',

  // The single accent
  accent: '#189a85',
  accentSoft: '#e8f4f2',
  accentDeep: '#0f7566',

  // Neutrals — a real ramp rather than ad-hoc greys
  ink: '#0f1e2b',
  inkMuted: '#4b5b68',
  inkFaint: '#6b7a88',
  inkFainter: '#93a1ad',
  line: '#e4e9ee',
  lineSoft: '#eef2f5',
  surface: '#ffffff',
  canvas: '#f6f8fa',

  // Semantic only — never decorative
  warning: '#b45309',
  warningSoft: '#fff8ed',
  warningLine: '#fcd9a4',
  danger: '#b42318',
  dangerSoft: '#fef3f2',
  dangerLine: '#fda29b',
  success: '#189a85',
  successSoft: '#e8f4f2'
}

// Closed set. `size` is px, `line` is a unitless line-height.
export const type = {
  display: { size: 25, line: 1.18, weight: 700, spacing: '-0.4px' },
  title: { size: 19, line: 1.25, weight: 700, spacing: '-0.2px' },
  heading: { size: 16, line: 1.3, weight: 650, spacing: '-0.1px' },
  body: { size: 14, line: 1.5, weight: 400, spacing: '0' },
  bodyStrong: { size: 14, line: 1.5, weight: 600, spacing: '0' },
  caption: { size: 12.5, line: 1.45, weight: 400, spacing: '0' },
  // Uppercase eyebrow labels
  micro: { size: 10.5, line: 1.4, weight: 700, spacing: '0.8px' }
}

/** Spread a type token into a style object. */
export function text(token, extra = {}) {
  const t = type[token]
  if (!t) throw new Error(`Unknown type token "${token}"`)
  return {
    fontSize: t.size,
    lineHeight: t.line,
    fontWeight: t.weight,
    letterSpacing: t.spacing,
    ...extra
  }
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 }

export const radius = { control: 10, card: 14, sheet: 20, pill: 999 }

export const border = {
  hairline: `1px solid ${colour.line}`,
  hairlineSoft: `1px solid ${colour.lineSoft}`
}

// Used only for things that genuinely float above the page.
export const elevation = {
  raised: '0 1px 2px rgba(4,39,70,0.04), 0 8px 24px rgba(4,39,70,0.06)',
  sheet: '0 -2px 24px rgba(4,39,70,0.12)'
}

export const font = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif'

/** A standard card surface. */
export function card(extra = {}) {
  return {
    background: colour.surface,
    border: border.hairline,
    borderRadius: radius.card,
    ...extra
  }
}
