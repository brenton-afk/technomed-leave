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

// Where a kit lives, told apart at a glance in the kit room (Brent, 2 Nov
// 2026): Calvary pale blue to go with its logo, RHH pale red, the TechnoMed
// office the brand's own teal. Kept apart from `colour` on purpose — these
// name places, they are not warnings, and RHH's red must never be read as an
// error, nor danger's red reused for a hospital.
export const site = {
  CLV: { soft: '#edf4fc', line: '#bcd4ee', ink: '#1d5a9e', name: 'Calvary' },
  RHH: { soft: '#fcf0ef', line: '#efc3be', ink: '#a3271d', name: 'RHH' },
  office: { soft: '#e8f4f2', line: '#b5ddd5', ink: '#0f7566', name: 'TM office / Warehouse' }
}

// Closed set. `size` is px, `line` is a unitless line-height.
export const type = {
  display: { size: 25, line: 1.18, weight: 700, spacing: '-0.4px' },
  title: { size: 19, line: 1.25, weight: 700, spacing: '-0.2px' },
  heading: { size: 16, line: 1.3, weight: 650, spacing: '-0.1px' },
  body: { size: 14, line: 1.5, weight: 400, spacing: '0' },
  // Anything you can type into. 16px is not a design choice — below it, iOS
  // Safari zooms the page on focus and never zooms back, leaving the app wider
  // than the screen with the buttons off the edge.
  //
  // There is a matching `input, select, textarea { font-size: 16px }` rule in
  // index.css, and it was useless: every field here is styled inline, and an
  // inline style beats a stylesheet rule. The rule stays as a backstop for any
  // control nobody styled, but this token is what actually does the work.
  //
  // Do not reduce this to match the body scale. It will look tidier and the
  // screen will start jumping again.
  field: { size: 16, line: 1.4, weight: 400, spacing: '0' },
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

// ─── Button faces, direction A (Brent, 12 Nov 2026: "Go with A") ────────────
// The one look for a button across the portal: primary a teal with a soft
// light on top and a shadow under it; secondary white, raised a hair; navy
// for a chosen chip or the main action on a dark-on-light control. Spread
// into a button's style after its size and type.
export const face = {
  primary: {
    background: `linear-gradient(180deg, #1fae97 0%, ${colour.accent} 55%, ${colour.accentDeep} 100%)`,
    color: '#ffffff', border: '1px solid transparent',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 2px 8px rgba(15,117,102,0.28)'
  },
  secondary: {
    background: colour.surface, color: colour.navy, border: `1px solid ${colour.line}`,
    boxShadow: '0 1px 2px rgba(4,39,70,0.06)'
  },
  navy: {
    background: `linear-gradient(180deg, ${colour.navySoft} 0%, ${colour.navy} 100%)`,
    color: '#ffffff', border: '1px solid transparent',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 2px 6px rgba(4,39,70,0.22)'
  }
}
