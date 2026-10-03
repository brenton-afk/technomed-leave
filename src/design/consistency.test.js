import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { type, colour } from './tokens.js'

// ─── Consistency guard ────────────────────────────────────────────────────────
// The app had drifted to eleven font sizes and five competing accents before the
// design system existed. That kind of drift is invisible in review — each screen
// looks fine on its own — so it is asserted instead of trusted.

const PAGES_DIR = 'src/pages'

// Screens migrated onto the design system. New screens should be added here.
const MIGRATED = [
  'KitRoom.jsx', 'Projects.jsx', 'Timesheets.jsx',
  'LeaveForm.jsx', 'PromptBanner.jsx', 'Hubs.jsx', 'FileBrowser.jsx',
  'Cases.jsx', 'TeamLeader.jsx', 'CaseWeek.jsx', 'cases/EditBooking.jsx', 'cases/NewBooking.jsx',
  'cases/BookingQueue.jsx', 'cases/DictateBooking.jsx', 'cases/ListPlace.jsx',
  'leave/DateRange.jsx',
  'TheatreGuides.jsx',
  'Chat.jsx'
]

// The clinical plan components deliberately replicate the emailed Word
// document, down to its own palette and sizes, and snapshot tests lock that.
// Pulling them onto the app scale would break the thing they exist to copy.
const EXEMPT = [
  'UsageScan.jsx', 'PinScreen.jsx',
  // A full-screen camera view over a live video feed. It has no page ground to
  // sit on and no surface to be legible against, so the app's palette does not
  // apply: everything is white or teal on whatever the camera happens to see.
  'scan/CameraSheet.jsx'
]

const SCALE = new Set(Object.values(type).map(t => t.size))
// Anything this large is an emoji or a glyph badge, not text on the scale.
const GLYPH_THRESHOLD = 22

function read(file) {
  return readFileSync(join(PAGES_DIR, file), 'utf8')
}

/**
 * Every page source, including the ones exempt from the palette rules.
 *
 * The viewport and field-size rules are not style preferences — a 14px input
 * makes the whole app zoom on an iPhone whatever palette the screen uses — so
 * they apply to UsageScan and PinScreen too.
 */
/**
 * The object literals following each match of `pattern`, brace-balanced.
 *
 * A declaration written on one line has no `\n}` to match against, and a lazy
 * match to the next one swallows the rest of the file. That produced a
 * confident, wrong report about the login screen's PIN field.
 */
function styleObjects(source, pattern) {
  const blocks = []
  for (const match of source.matchAll(pattern)) {
    let i = source.indexOf('{', match.index + match[0].length - 1)
    if (i < 0) continue
    let depth = 0
    const from = i
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}' && --depth === 0) break
    }
    blocks.push(source.slice(from, i + 1))
  }
  return blocks
}

function readAllSources() {
  const files = []
  for (const entry of readdirSync(PAGES_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const nested of readdirSync(join(PAGES_DIR, entry.name))) {
        if (nested.endsWith('.jsx')) files.push(`${entry.name}/${nested}`)
      }
    } else if (entry.name.endsWith('.jsx')) {
      files.push(entry.name)
    }
  }
  return files.filter(f => !f.includes('.test.'))
}

function fontSizes(source) {
  return [...source.matchAll(/fontSize: ?'?([0-9.]+)/g)].map(m => Number(m[1]))
}

describe('type scale', () => {
  it.each(MIGRATED)('%s uses only scale sizes for text', file => {
    const offenders = [...new Set(fontSizes(read(file)))]
      .filter(size => size < GLYPH_THRESHOLD && !SCALE.has(size))
    expect(offenders, `off-scale sizes in ${file}`).toEqual([])
  })

  it('the scale itself stays small — seven steps, not eleven', () => {
    expect(SCALE.size).toBeLessThanOrEqual(7)
  })
})

describe('colour tokens', () => {
  // The brand values, which must come from tokens rather than be retyped.
  const BRAND_HEXES = [/#042746/i, /#2ab5a0/i, /#189a85/i, /#f0f3f7/i, /#6b7a8d/i]

  it.each(MIGRATED)('%s references brand colour through tokens', file => {
    const source = read(file)
    const found = BRAND_HEXES.filter(re => re.test(source)).map(re => re.source)
    expect(found, `hardcoded brand colour in ${file}`).toEqual([])
  })

  it('every migrated page imports the tokens it uses', () => {
    for (const file of MIGRATED) {
      const source = read(file)
      // Timesheets imports the tokens under an alias to avoid a local clash.
      if (!/\bcolour\.|\btokenColour\./.test(source)) continue
      expect(source, file).toMatch(/from '\.\.\/design\/tokens\.js'|from '\.\.\/\.\.\/design\/tokens\.js'/)
    }
  })
})

describe('every page is accounted for', () => {
  it('is either migrated or explicitly exempt', () => {
    const files = []
    for (const entry of readdirSync(PAGES_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const inner of readdirSync(join(PAGES_DIR, entry.name))) {
          if (inner.endsWith('.jsx') && !inner.includes('.test.')) files.push(`${entry.name}/${inner}`)
        }
      } else if (entry.name.endsWith('.jsx') && !entry.name.includes('.test.')) {
        files.push(entry.name)
      }
    }
    // admin/* still carries its own styling; listed so this test names the debt
    // rather than quietly ignoring it.
    const knownUnmigrated = files.filter(f => f.startsWith('admin/'))
    const unaccounted = files.filter(f =>
      !MIGRATED.includes(f) && !EXEMPT.includes(f) && !knownUnmigrated.includes(f)
      && !['Success.jsx', 'FaceIdSetup.jsx'].includes(f))

    expect(unaccounted, 'pages neither migrated nor exempt').toEqual([])
    // Documents the remaining work instead of pretending it is done.
    expect(knownUnmigrated.length).toBeGreaterThan(0)
  })
})

// ─── Nothing may make the phone zoom, and nothing may outgrow the screen ─────
// Two faults with one symptom, both reported as "the window is too big and I
// have to zoom out and drag it around to tap things".

describe('the app fits the phone', () => {
  it('never styles a field below 16px', () => {
    // Below 16px iOS Safari zooms the page when the field is focused and does
    // not zoom back. The page is then wider than the screen and the only way
    // back is to pinch.
    //
    // index.css has an `input, select, textarea { font-size: 16px }` rule and
    // it was doing nothing: every field is styled inline, and an inline style
    // wins. So the check has to be on the inline styles.
    expect(type.field.size).toBeGreaterThanOrEqual(16)

    const offenders = []
    for (const file of readAllSources()) {
      const source = read(file)
      // The style object each file applies to its inputs. Braces are balanced
      // rather than matched to the next `\n}` — these declarations are often a
      // single line, so a newline-terminated match runs on into unrelated code
      // and reports whatever font size it finds there.
      for (const block of styleObjects(source, /(?:input|field)Style\s*=\s*/gi)) {
        const literal = /fontSize:\s*(\d+(?:\.\d+)?)/.exec(block)
        if (literal && Number(literal[1]) < 16) {
          offenders.push(`${file}: fontSize ${literal[1]}`)
        }
        // A spread type token has to be one that is big enough.
        for (const token of block.matchAll(/\.\.\.text\('(\w+)'\)/g)) {
          const size = type[token[1]]?.size
          if (size !== undefined && size < 16) {
            offenders.push(`${file}: text('${token[1]}') is ${size}px`)
          }
        }
      }
    }
    expect(offenders, 'field styles that will make iOS zoom').toEqual([])
  })

  it('sizes sheets and pages against the visible viewport, not vh', () => {
    // On iOS `100vh` is the *large* viewport — the one with the toolbar
    // collapsed — so a `90vh` sheet is taller than what is on screen and its
    // footer buttons sit below the fold. `dvh` tracks what is visible now.
    //
    // The sheets carry `.tm-sheet` and screens carry `.tm-page`, both defined
    // in index.css where the `vh` fallback can be declared alongside `dvh`.
    const offenders = []
    for (const file of readAllSources()) {
      for (const match of read(file).matchAll(/(maxHeight|minHeight):\s*'(\d+)vh'/g)) {
        offenders.push(`${file}: ${match[1]} ${match[2]}vh`)
      }
    }
    expect(offenders, 'viewport heights that overshoot on iOS').toEqual([])
  })
})
