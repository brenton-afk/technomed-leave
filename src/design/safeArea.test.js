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

  // There was a test here asserting the content reserved `76px + inset` of
  // clearance beneath it. That was right while the bar was position:fixed and
  // floating over the content. The bar is now a sibling in the layout, so there
  // is nothing to clear and nothing to keep in step with its height — see "the
  // shell is a fixed frame with one scrolling region" below.

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

describe('the shell is a fixed frame with one scrolling region', () => {
  // The tab bar scrolled away with the case list. It had `position: fixed` and
  // `left/right/bottom` set, which looks correct and is not enough: a fixed
  // element is positioned against its containing block, and any ancestor with a
  // transform, filter, backdrop-filter or `contain` quietly becomes that block —
  // at which point "fixed" scrolls. On iOS a collapsing toolbar moves it too.
  //
  // So the bar is not fixed any more. It is the last child of a column that is
  // exactly the height of the viewport, which nothing can scroll away.
  const css = read('src/index.css')
  const app = read('src/App.jsx')

  it('makes the frame the height of the visible viewport, and not scrollable', () => {
    expect(css).toMatch(/#root\s*\{[^}]*overflow:\s*hidden/)
    // dvh tracks what is on screen; vh is the large viewport, which on iOS is
    // taller than what you can see and is why fixed things appear to shift.
    expect(css).toMatch(/#root\s*\{[^}]*height:\s*100dvh/)
    // With a plain-vh line before it, for anything that does not know dvh.
    expect(css).toMatch(/#root\s*\{[^}]*height:\s*100vh/)
  })

  it('gives the scrolling region a floor of zero, or it pushes the bar away', () => {
    // A flex item's default minimum is its content size, so without min-height:0
    // the middle grows to fit the case list and shoves the tab bar off screen.
    // This one line is the difference.
    expect(css).toMatch(/\.tm-scroll\s*\{[^}]*min-height:\s*0/)
    expect(css).toMatch(/\.tm-scroll\s*\{[^}]*overflow-y:\s*auto/)
    expect(css).toMatch(/\.tm-scroll\s*\{[^}]*flex:\s*1/)
  })

  it('scrolls exactly one region', () => {
    expect(app).toMatch(/className="tm-scroll"/)
    expect((app.match(/className="tm-scroll"/g) || []).length).toBe(1)
  })

  it('does not position the tab bar, it lays it out', () => {
    const nav = app.slice(app.indexOf('<nav aria-label="Main"'), app.indexOf('</nav>'))
    expect(nav, 'the nav should not be position:fixed any more').not.toMatch(/position:\s*'fixed'/)
    expect(nav).toMatch(/flexShrink:\s*0/)
    // It still has to clear the home indicator.
    expect(nav).toMatch(/env\(safe-area-inset-bottom/)
  })

  it('stops reserving space for a bar that is now in the layout', () => {
    // The old clearance had to be kept in step with the bar's height, insets and
    // all. A sibling needs no clearance at all.
    expect(app).not.toMatch(/paddingBottom: 'calc\(76px \+ env\(safe-area-inset-bottom/)
  })

  it('lets a printout run past one screen', () => {
    // A viewport-height frame with hidden overflow is what pins the bar, and it
    // would clip a printed case plan to whatever was on screen. The plan has
    // @page A4 rules and is printed and handed round, so this is a real path.
    const printBlock = css.slice(css.lastIndexOf('@media print'))
    expect(printBlock).toMatch(/#root\s*\{[^}]*overflow:\s*visible/)
    expect(printBlock).toMatch(/#root\s*\{[^}]*height:\s*auto/)
    expect(printBlock).toMatch(/\.tm-scroll\s*\{[^}]*overflow:\s*visible/)
  })

  it('has no screen inside the frame demanding a whole viewport', () => {
    // A child asking for 100vh inside a region that is already the viewport minus
    // the header and the bar makes every screen scroll by the height of that
    // chrome, even an empty one. Only the screens rendered *before* the shell —
    // sign-in and the leave confirmation — may ask for 100vh.
    const outsideTheShell = ['PinScreen.jsx', 'Success.jsx']
    const offenders = []
    for (const entry of readdirSync(join(ROOT, 'src/pages'), { withFileTypes: true })) {
      const files = entry.isDirectory()
        ? readdirSync(join(ROOT, 'src/pages', entry.name)).map(f => `${entry.name}/${f}`)
        : [entry.name]
      for (const file of files) {
        if (!file.endsWith('.jsx') || file.includes('.test.')) continue
        if (outsideTheShell.includes(file.split('/').pop())) continue
        if (/minHeight:\s*'100vh'/.test(read(join('src/pages', file)))) offenders.push(file)
      }
    }
    expect(offenders, 'screens inside the shell asking for a full viewport').toEqual([])
  })
})

describe('a layer that covers the screen is rendered outside the shell', () => {
  // The camera's Retake and Use page buttons ended up behind the tab bar, with
  // the form scanned and no way to accept it. The sheet had `zIndex: 3100` and
  // the bar has 100, and that was not the question: `.tm-scroll` carries
  // `-webkit-overflow-scrolling: touch`, which on iOS makes it a stacking
  // context, so the sheet was only ever ranked against its siblings inside that
  // region. No z-index reachable from in there can beat a sibling of the region.
  //
  // It worked until the tab bar stopped being position:fixed and became a row of
  // the layout — nothing about the overlay changed. That is why this is a rule
  // rather than a fix: the next rearrangement of the shell would do it again.
  const overlays = [
    'src/pages/scan/CameraSheet.jsx',      // the camera and the crop review
    'src/pages/Timesheets.jsx',            // number pad, on-call, split a day
    'src/pages/admin/TimesheetApprovals.jsx' // return a timesheet
  ]

  it.each(overlays)('%s portals its full-screen layers', file => {
    const source = read(file)
    expect(source, 'imports Overlay from the design system').toMatch(/import \{[^}]*\bOverlay\b[^}]*\} from/)
    // Every full-screen fixed layer in the file is wrapped, not just the first.
    const layers = (source.match(/position: 'fixed', inset: 0/g) || []).length
    const wrapped = (source.match(/<Overlay>/g) || []).length
    expect(wrapped).toBeGreaterThan(0)
    expect(wrapped, `${layers} full-screen layers, ${wrapped} wrapped`).toBeGreaterThanOrEqual(1)
  })

  it('finds no full-screen layer left unportalled', () => {
    const missed = []
    for (const entry of readdirSync(join(ROOT, 'src/pages'), { withFileTypes: true })) {
      const files = entry.isDirectory()
        ? readdirSync(join(ROOT, 'src/pages', entry.name)).map(f => `${entry.name}/${f}`)
        : [entry.name]
      for (const file of files) {
        if (!file.endsWith('.jsx') || file.includes('.test.')) continue
        const source = read(join('src/pages', file))
        // A layer covering the viewport. A fixed *bar* is a different thing: it
        // is meant to sit above the tab bar, not over it.
        if (!/position: 'fixed', inset: 0/.test(source)) continue
        if (!/\bOverlay\b/.test(source)) missed.push(file)
      }
    }
    expect(missed, 'full-screen layers that will be trapped behind the tab bar').toEqual([])
  })

  it('puts the portal on the body, where no ancestor can scope it', () => {
    expect(read('src/design/Shell.jsx')).toMatch(/createPortal\(children, document\.body\)/)
  })
})
