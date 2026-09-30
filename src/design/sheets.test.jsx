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
