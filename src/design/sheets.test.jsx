import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// ─── Sheets have to be positioned by whoever opens them ──────────────────────
// Overlay is a portal and nothing else: createPortal(children, document.body).
// It appends its children to the end of the body and positions nothing.
//
// #root is exactly the height of the viewport and owns the only scrolling
// region, so anything appended after it with no positioning of its own lands
// below the fold with no way to scroll to it. The sheet opens; nobody sees it.
//
// That is what happened to the list-order sheet, and it presented as a dead
// button: the tap worked, the state changed, the component rendered, and it
// rendered off-screen. No behavioural test could catch it — jsdom has no layout
// at all, so getByText found the sheet happily and every assertion passed.
//
// So the rule is checked in the source: if a file renders <Overlay>, it has to
// put a fixed-position element inside it.

const ROOT = join(__dirname, '..', '..')

function jsxFiles(dir) {
  const found = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...jsxFiles(join(dir, entry.name)))
    else if (entry.name.endsWith('.jsx') && !entry.name.includes('.test.')) {
      found.push(join(dir, entry.name))
    }
  }
  return found
}

describe('anything that opens in an Overlay', () => {
  const users = jsxFiles('src')
    .map(path => ({ path, source: readFileSync(join(ROOT, path), 'utf8') }))
    .filter(f => /<Overlay[\s>]/.test(f.source))

  it('finds the sheets, so this test is testing something', () => {
    expect(users.length).toBeGreaterThan(1)
  })

  for (const { path, source } of users) {
    it(`${path} positions itself`, () => {
      // Between the Overlay opening and its close, something has to be fixed.
      const inside = source.slice(source.indexOf('<Overlay'), source.lastIndexOf('</Overlay>'))
      expect(inside, `${path} renders inside <Overlay> without a fixed-position element. `
        + 'Overlay only portals to document.body — it will land below #root and off-screen.')
        .toMatch(/position:\s*'fixed'/)
    })
  }
})

describe('nothing in the app pans sideways', () => {
  // "The edit booking window, when you open it and scroll up, it can move side
  // to side. We need to lock it so it only moves vertically." — "not
  // horizontally at all".
  //
  // The cause is a piece of CSS that reads as redundant and is not: an axis
  // set to `visible` computes to `auto` when the other axis is scrollable. So
  // `overflowY: auto` on its own turns on sideways scrolling as well, and a
  // thumb travelling up a sheet drags it off the screen.
  //
  // It was true of every scroll region in the app, not only the one reported.
  // jsdom resolves no layout and would never notice, so this reads the source.
  const files = jsxFiles('src')
    .map(path => ({ path, source: readFileSync(join(ROOT, path), 'utf8') }))

  it('finds the scroll regions, so this is testing something', () => {
    const total = files.reduce(
      (n, f) => n + (f.source.match(/overflowY: 'auto'/g) || []).length, 0)
    expect(total).toBeGreaterThan(8)
  })

  it('pairs every vertical scroller with a horizontal lock', () => {
    const loose = []
    for (const { path, source } of files) {
      for (const match of source.matchAll(/overflowY: 'auto'/g)) {
        // The declaration it sits in — braces are balanced by the style object.
        const around = source.slice(match.index, match.index + 120)
        if (!/overflowX:\s*'hidden'/.test(around)) {
          loose.push(`${path}:${source.slice(0, match.index).split('\n').length}`)
        }
      }
    }
    expect(loose, 'these scroll sideways as well as up').toEqual([])
  })
})
