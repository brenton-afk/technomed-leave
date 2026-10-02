import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// ─── Every field is at least 16px, or the phone zooms ────────────────────────
// Safari on iOS zooms the page in when a form control with a font smaller than
// 16px is focused, and it does not zoom back out when the field is left. In an
// installed web app that zoom is then remembered between launches — so the app
// is still zoomed in the next morning, and the only way out is to pinch.
//
// Reported as: "occasionally when I open the app, the view is still zoomed in
// and I need to adjust the aspect by zooming out with two fingers."
//
// It is not a layout bug and no amount of viewport tuning fixes it. The one
// cure is the font size, and it has to hold for every field in the app
// forever: one 14px box on one screen is enough to leave somebody zoomed in
// for a week. CSS cannot enforce it either, because every field here is styled
// inline and an inline style beats a stylesheet.
//
// So it is enforced here, on the source.

const ROOT = join(__dirname, '..', '..')
const MINIMUM = 16

function jsx(dir = 'src') {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...jsx(path))
    else if (entry.name.endsWith('.jsx') && !entry.name.includes('.test.')) out.push(path)
  }
  return out
}

/**
 * The source with its comments taken out.
 *
 * Several comments in this app discuss `<select>` and `<input capture>` while
 * explaining a decision about them. Scanning those is how a test ends up
 * reporting a prose paragraph as an unstyled form control.
 */
function code(source) {
  return source
    // Only where a comment can actually begin: the start of a line, after
    // whitespace, or inside a JSX brace. Stripping every `/*` ate the `/*` in
    // accept="image/*" and swallowed the attributes after it, which is how two
    // perfectly good file pickers were reported as having no font size.
    .replace(/(^|[\s{])\/\*[\s\S]*?\*\//gm, '$1')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

/** The opening tag starting at `i`, brace-aware so nested objects do not end it. */
function openingTag(source, i) {
  let depth = 0
  for (let j = i; j < source.length; j++) {
    const ch = source[j]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return source.slice(i, j + 1)
  }
  return source.slice(i)
}

/** The font size a tag ends up with, following one level of shared style object. */
function fontSizeOf(tag, source) {
  const direct = /fontSize:\s*'?([0-9.]+)(px)?'?/.exec(tag)
  if (direct) return Number(direct[1])
  // The shared token, which is 16 for exactly this reason — see tokens.js.
  if (tag.includes("text('field')")) return MINIMUM

  const ref = /style=\{\.{0,3}([A-Za-z_][A-Za-z0-9_]*)\}/.exec(tag)
    || /style=\{\{\s*\.\.\.([A-Za-z_][A-Za-z0-9_]*)/.exec(tag)
  if (!ref) return null
  const defined = new RegExp(`(?:const|let)\\s+${ref[1]}\\s*=\\s*\\{`).exec(source)
  if (!defined) return null
  const body = openingTag(source, defined.index + defined[0].length - 1)
  const inherited = /fontSize:\s*'?([0-9.]+)(px)?'?/.exec(body)
  if (inherited) return Number(inherited[1])
  if (body.includes("text('field')")) return MINIMUM
  return null
}

describe('no field is small enough to zoom an iPhone', () => {
  const files = jsx()

  it('finds the screens, so this test is testing something', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  const offenders = []
  for (const path of files) {
    const source = code(readFileSync(join(ROOT, path), 'utf8'))
    for (const match of source.matchAll(/<(input|textarea|select)\b/g)) {
      const tag = openingTag(source, match.index)
      const line = source.slice(0, match.index).split('\n').length
      const size = fontSizeOf(tag, source)
      if (size === null || size < MINIMUM) {
        offenders.push(`${path}:${line} <${match[1]}> ${size === null ? 'no font size' : `${size}px`}`)
      }
    }
  }

  it('every input, textarea and select is 16px or more', () => {
    expect(offenders, 'These fields will zoom an iPhone in on focus and it will '
      + 'not zoom back. Give each one fontSize: 16 (or the `field` token).\n'
      + offenders.join('\n')).toEqual([])
  })
})

describe('the viewport the app asks for', () => {
  // The tag itself, not the file. The comment above it explains why
  // maximum-scale and user-scalable are absent, and matching that comment is
  // how a test reports the explanation as the problem.
  const html = (/<meta name="viewport"[^>]*>/.exec(
    readFileSync(join(ROOT, 'index.html'), 'utf8')) || [''])[0]

  it('matches the device and allows the safe-area insets to be real', () => {
    expect(html).toMatch(/width=device-width/)
    expect(html).toMatch(/initial-scale=1/)
    expect(html).toMatch(/viewport-fit=cover/)
  })

  it('does not forbid pinch-zoom', () => {
    // Blocking it would hide the symptom and take the magnifying glass away:
    // people zoom into a photo of a booking form on purpose. The font sizes
    // above are what stop the *unasked-for* zoom.
    expect(html).not.toMatch(/user-scalable\s*=\s*no/)
    expect(html).not.toMatch(/maximum-scale/)
  })
})

describe('the token every field should be using', () => {
  const tokens = readFileSync(join(ROOT, 'src/design/tokens.js'), 'utf8')

  it('keeps `field` at 16 or more', () => {
    // Dropping this to 14 for looks would re-break every screen at once,
    // silently, and the symptom would turn up days later as "the app is
    // zoomed in again".
    const field = /field:\s*\{\s*size:\s*([0-9.]+)/.exec(tokens)
    expect(field, 'the `field` token has moved or been renamed').toBeTruthy()
    expect(Number(field[1])).toBeGreaterThanOrEqual(MINIMUM)
  })
})
