import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Whether Android offers "Install app" at all ────────────────────────────
// "I want people to be able to have the app as a genuine app that behaves
// like an app."
//
// On Android that is a property of the manifest, not of the code. Chrome only
// offers "Install app" when the manifest qualifies; fall short and the menu
// offers "Add to Home screen" instead, which makes a shortcut that opens in a
// browser tab. The two look identical on a home screen and only one of them
// is the app.

const manifest = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'manifest.json'), 'utf8'))

describe('the manifest', () => {
  it('meets the conditions for an install prompt', () => {
    expect(manifest.name || manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBeTruthy()
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display)
  })

  it('has both icon sizes Android asks for', () => {
    const sizes = manifest.icons.map(i => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  it('marks the icons maskable', () => {
    // Android masks an icon to the launcher's shape. Without this it
    // letterboxes the square inside a white circle, which is exactly the look
    // that says "bookmark" rather than "app".
    for (const icon of manifest.icons) {
      expect(icon.purpose, icon.src).toMatch(/maskable/)
    }
  })

  it('claims a scope, so the installed window keeps the app in it', () => {
    // Without a scope, a link out can quietly leave the installed window and
    // land in a browser tab — where, on iOS, there is no push at all.
    expect(manifest.scope).toBe('/')
  })

  it('has a stable id', () => {
    // So a reinstall, or a later change of start_url, is recognised as the
    // same app rather than installed a second time alongside itself.
    expect(manifest.id).toBeTruthy()
  })

  it('is linked from the page', () => {
    const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8')
    expect(html).toMatch(/rel="manifest"/)
  })

  it('names a theme colour, so the installed app is not a white browser', () => {
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
