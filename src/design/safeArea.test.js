import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The Cases header sat under the iPhone's clock, and the reason was not the Cases
// screen: `index.html` had no `viewport-fit=cover`, so every
// `env(safe-area-inset-*)` in the app resolved to zero. All the handling that
// looked correct — the header padding, the tab bar, the floating back button —
// silently did nothing, on every screen at once.
//
// That is a bug nothing else here can see: it is one attribute in an HTML file,
// it breaks CSS in another file, and the symptom only appears on hardware with a
// notch. Hence this file.

const ROOT = process.cwd()
const read = path => readFileSync(join(ROOT, path), 'utf8')

describe('the viewport', () => {
  const html = read('index.html')
  const viewport = /<meta\s+name="viewport"[^>]*content="([^"]+)"/.exec(html)?.[1]

  it('opts into the safe area, or nothing else here works', () => {
    expect(viewport).toBeTruthy()
    expect(viewport).toContain('viewport-fit=cover')
  })

  it('does not block pinch-zoom', () => {
    // This app is used to read case detail and handwritten forms. `maximum-scale`
    // and `user-scalable=no` were removed with the viewport fix rather than
    // carried along by habit.
    expect(viewport).not.toMatch(/maximum-scale/)
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/)
  })
})

describe('the shared header', () => {
  const shell = read('src/design/Shell.jsx')

  it('pads by the top inset, so the title clears the clock', () => {
    expect(shell).toMatch(/env\(safe-area-inset-top/)
  })

  it('adds normal spacing on top of the inset rather than only the inset', () => {
    // Padding of exactly the inset puts the eyebrow flush against the status bar.
    expect(shell).toMatch(/calc\(env\(safe-area-inset-top[^)]*\)\s*\+\s*\$\{space\.xl\}px\)/)
  })

  it('falls back to nothing, not to a guess at a notch', () => {
    // Where env() is unsupported there is no notch to avoid, and a guessed
    // fallback puts a band of empty navy across every desktop browser. The
    // previous fallback here was 34px.
    const fallbacks = [...shell.matchAll(/env\(safe-area-inset-\w+,\s*([^)]+)\)/g)]
      .map(match => match[1].trim())
    expect(fallbacks.length).toBeGreaterThan(0)
    expect([...new Set(fallbacks)]).toEqual(['0px'])
  })
})

describe('the app shell', () => {
  const app = read('src/App.jsx')

  it('keeps the tab bar above the home indicator', () => {
    expect(app).toMatch(/paddingBottom: 'env\(safe-area-inset-bottom/)
  })

  it('clears a tab bar that the inset has made taller', () => {
    // The knock-on effect of the fix, and the one that would have been missed:
    // real insets make the bar taller, so the last row of any list hides behind
    // it unless what clears it grows too.
    expect(app).toMatch(/paddingBottom: 'calc\(76px \+ env\(safe-area-inset-bottom/)
  })

  it('positions the floating back button below the inset', () => {
    expect(app).toMatch(/top: 'calc\(14px \+ env\(safe-area-inset-top/)
  })
})

describe('every screen with its own navy header', () => {
  // Two screens predate the design system and draw their own. Both hardcoded a
  // 56px top padding, which is one particular iPhone's status bar: too much on a
  // desktop, too little on the newest phones.
  const bespoke = ['src/pages/UsageScan.jsx', 'src/pages/admin/AdminPortal.jsx']

  it.each(bespoke)('%s uses the inset rather than a fixed guess', file => {
    const source = read(file)
    expect(source).toMatch(/env\(safe-area-inset-top/)
    expect(source, 'a hardcoded status-bar height').not.toMatch(/paddingTop\s*:\s*56\b/)
  })
})

describe('full-screen overlays', () => {
  // These sit outside the app shell, so they inherit none of its handling and
  // have to carry their own. The camera's controls are the ones that matter: they
  // sit exactly where the home indicator is.
  it('the camera keeps its controls off the home indicator', () => {
    const camera = read('src/pages/scan/CameraSheet.jsx')
    expect(camera).toMatch(/env\(safe-area-inset-bottom/)
    expect(camera).toMatch(/env\(safe-area-inset-top/)
  })

  it('the timesheet bar sits above a tab bar that has grown', () => {
    const timesheets = read('src/pages/Timesheets.jsx')
    expect(timesheets).toMatch(/bottom: 'calc\(70px \+ env\(safe-area-inset-bottom/)
  })
})

describe('no screen is left out', () => {
  // A list rather than a rule, because "has a dark header at the top of the
  // screen" is not something a test can infer. Anything added to src/pages that
  // draws its own has to be accounted for here deliberately.
  const HANDLED = new Set([
    'UsageScan.jsx', 'PinScreen.jsx', 'admin/AdminPortal.jsx', 'scan/CameraSheet.jsx'
  ])
  // Drawn inside another screen's frame, so the frame's insets already apply.
  const INSIDE_ANOTHER = new Set([
    'PromptBanner.jsx', 'Success.jsx', 'FaceIdSetup.jsx', 'clinical/PlanBlocks.jsx',
    'admin/StaffPins.jsx', 'admin/SystemStatus.jsx', 'admin/TimesheetApprovals.jsx'
  ])

  it('accounts for every screen that does not use the shared header', () => {
    const pages = []
    for (const entry of readdirSync(join(ROOT, 'src/pages'), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const inner of readdirSync(join(ROOT, 'src/pages', entry.name))) {
          if (inner.endsWith('.jsx') && !inner.includes('.test.')) pages.push(`${entry.name}/${inner}`)
        }
      } else if (entry.name.endsWith('.jsx') && !entry.name.includes('.test.')) {
        pages.push(entry.name)
      }
    }

    const unaccounted = pages.filter(page => {
      const source = read(join('src/pages', page))
      const usesShared = /design\/Shell\.js/.test(source)
      return !usesShared && !HANDLED.has(page) && !INSIDE_ANOTHER.has(page)
    })
    expect(unaccounted, 'screens drawing their own chrome with no safe-area decision').toEqual([])
  })
})
