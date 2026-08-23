// ─── Clinical Plan palette ────────────────────────────────────────────────────
// Sampled from the team's reference document. These are the RENDER colours and
// take priority over the Google Calendar colour guide's own swatches — the
// guide is for picking colours in Calendar by name (see colours.js), this is
// for drawing. Defined once; components must not hard-code hexes.

export const SURGEON_ACCENTS = {
  Ibbett: '#FBBC04',
  Thani: '#0D9488',
  Atallah: '#FF6D00',
  Gupta: '#16A34A',
  Garg: '#2563EB',
  JPW: '#F06292',
  // Provisional: absent from the reference legend, chosen to match the "Grape"
  // family. Revisit if a real Fowler-coded booking shows a different shade.
  Fowler: '#9333EA'
  // Hannan and Dubey have no confirmed hex — deliberately absent so
  // accentFor() falls back to neutral and logs, rather than inventing one.
}

export const TOKENS = {
  ink: '#111827',
  inkMuted: '#4B5563',
  inkFaint: '#6B7280',
  notesBg: '#F9FAFB',
  notesBorder: '#E5E7EB',
  flagBg: '#EFF6FF',
  flagBorder: '#93C5FD',
  flagText: '#1E40AF',
  alert: '#DC2626',
  neutralBar: '#9CA3AF'
}

// Dark variant: structural tokens are re-derived, surgeon accents are only
// lightened, never reassigned, so a surgeon stays recognisable by colour.
export const TOKENS_DARK = {
  ink: '#F3F4F6',
  inkMuted: '#C7CDD6',
  inkFaint: '#9AA3AF',
  notesBg: '#0F1A26',
  notesBorder: '#24313F',
  flagBg: '#0E1E33',
  flagBorder: '#2B4A7A',
  flagText: '#A9C7FF',
  alert: '#FF8A8A',
  neutralBar: '#6B7683'
}

export const FONT_STACK = 'Arial, Helvetica, "Helvetica Neue", sans-serif'
export const DOCX_FONT = 'Arial'

const NEUTRAL = TOKENS.neutralBar
const loggedMissing = new Set()

// The accent for a surgeon, or neutral grey when no hex is confirmed. Logs each
// unknown surgeon once so a missing colour is visible without spamming.
export function accentFor(surgeon, dark = false) {
  const hex = SURGEON_ACCENTS[surgeon]
  if (hex) return dark ? lighten(hex, 0.25) : hex
  if (surgeon && !loggedMissing.has(surgeon)) {
    loggedMissing.add(surgeon)
    console.warn(`[clinical-plan] no confirmed accent colour for surgeon "${surgeon}" — using neutral grey`)
  }
  return dark ? TOKENS_DARK.neutralBar : NEUTRAL
}

export function hasConfirmedAccent(surgeon) {
  return Boolean(SURGEON_ACCENTS[surgeon])
}

// Minimum contrast for normal-weight body text under WCAG AA. The surgeon name
// renders at 14px bold, which is below the "large text" threshold, so 4.5 is
// the bar it has to clear rather than 3.
const AA_TEXT_CONTRAST = 4.5

// Some of the document's sampled accents are decorative-bright: Ibbett's
// #FBBC04 scores only 1.71:1 on white, well under AA, so as *text* it would be
// close to unreadable. The bar keeps the document's exact colour; text uses the
// same hue darkened just far enough to be legible. Accessibility (§10) and
// visual fidelity (§5.3) both hold, and the surgeon is still identifiable by
// colour as well as by name.
const textAccentCache = new Map()

export function accentTextFor(surgeon, dark = false) {
  const base = SURGEON_ACCENTS[surgeon]
  if (!base) return accentFor(surgeon, dark)
  // On a dark ground the bright accent is already high-contrast.
  if (dark) return accentFor(surgeon, true)

  if (textAccentCache.has(surgeon)) return textAccentCache.get(surgeon)
  let candidate = base
  for (let step = 0; step < 20; step++) {
    if (contrastRatio(candidate, '#FFFFFF') >= AA_TEXT_CONTRAST) break
    candidate = darken(candidate, 0.1)
  }
  textAccentCache.set(surgeon, candidate)
  return candidate
}

function darken(hex, amount) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const mix = c => Math.round(c * (1 - amount))
  return '#' + [mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('')
}

export function tokens(dark = false) {
  return dark ? TOKENS_DARK : TOKENS
}

// Mixes toward white by `amount`, so a dark-mode accent stays the same hue.
function lighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const mix = c => Math.round(c + (255 - c) * amount)
  return '#' + [mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('')
}

// Relative luminance / contrast, used by the accessibility test to prove every
// accent is legible as text on white.
export function relativeLuminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b)
  const light = Math.max(la, lb), dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

// The blueberry used for navigation cases. Note this sits close to Fowler's
// Grape accent (#9333EA), so on a screen where the bar also carries the surgeon
// it is a Fowler case and a navigation case that look most alike — raised, and
// chosen anyway.
export const NAVIGATION_ACCENT = '#4a1c96'

/**
 * The bar colour for a case: its surgeon's, unless the case uses image guidance.
 *
 * Navigation is the one thing allowed to outrank the surgeon here. A Varioguide,
 * Brainlab or AIRO case needs the platform booked and calibrated, which changes
 * what the day requires of whoever is covering it, so it has to be visible
 * without reading the case.
 */
export function accentForCase(surgicalCase, dark = false) {
  if (surgicalCase?.navigation) return NAVIGATION_ACCENT
  return accentFor(surgicalCase?.surgeon, dark)
}

/**
 * The surgeon's name, always in the surgeon's own colour.
 *
 * Deliberately not overridden for navigation. The override belongs on the bar,
 * where it reads as a property of the case; on the name it would read as a claim
 * about who is operating.
 */
export function accentTextForCase(surgicalCase, dark = false) {
  return accentTextFor(surgicalCase?.surgeon, dark)
}
