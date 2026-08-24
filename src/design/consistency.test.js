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
  'TodayView.jsx', 'KitRoom.jsx', 'Projects.jsx', 'Timesheets.jsx',
  'LeaveForm.jsx', 'PromptBanner.jsx', 'Hubs.jsx', 'FileBrowser.jsx',
  'Cases.jsx'
]

// The clinical plan components deliberately replicate the emailed Word
// document, down to its own palette and sizes, and snapshot tests lock that.
// Pulling them onto the app scale would break the thing they exist to copy.
const EXEMPT = [
  'clinical/PlanBlocks.jsx', 'ClinicalPlan.jsx', 'UsageScan.jsx', 'PinScreen.jsx',
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
