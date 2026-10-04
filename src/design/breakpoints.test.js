import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Breakpoints have to be written in ascending order ───────────────────────
// Both of these match on a desktop. Their selectors have equal specificity, so
// whichever is written last wins — which means a min-width block placed below
// a wider one silently overrules it at every width the wider one covers.
//
// That is not a style preference. While the 640 block sat below the 1024 one,
// `.tm-fixed` on a desktop was a 460px strip centred on the window instead of
// a bar over the content area, and the leave form's Continue button sat alone
// in the middle of an empty page a long way from the calendar it applied to.
//
// jsdom resolves no cascade, so nothing behavioural can catch this. Reading
// the file in order is the only check available.

const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8')

describe('the stylesheet is written mobile-first', () => {
  const widths = [...css.matchAll(/@media \(min-width: (\d+)px\)/g)]
    .map(m => ({ at: m.index, px: Number(m[1]) }))

  it('has the breakpoints it is supposed to have', () => {
    expect(widths.map(w => w.px)).toEqual([640, 1024])
  })

  it('writes each min-width block after every narrower one', () => {
    const order = widths.map(w => w.px)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('lets the desktop block have the last word on .tm-fixed', () => {
    // The specific regression: a bar pinned to the viewport belongs over the
    // content, not over the sidebar and not down the middle of the window.
    const desktop = css.indexOf('@media (min-width: 1024px)')
    const phone = css.indexOf('@media (min-width: 640px)')
    expect(phone).toBeGreaterThan(-1)
    expect(desktop).toBeGreaterThan(phone)
    expect(css.slice(desktop)).toMatch(/\.tm-fixed\s*\{[^}]*left:\s*232px/)
  })
})
