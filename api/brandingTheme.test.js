import { describe, it, expect, beforeEach } from 'vitest'
import { pickBrandingTheme, withTheme, forgetBrandingTheme } from './_xeroAccounting.js'

// Brent, 17 Nov 2026: "I just generated a PO from the portal, but it didn't
// have the Technomed logos." Drafts now carry TechnoMed's branding theme.

const THEMES = [
  { BrandingThemeID: 'std', Name: 'Standard', SortOrder: 0 },
  { BrandingThemeID: 'tm', Name: 'TechnoMed', SortOrder: 1, LogoUrl: 'https://x/logo.png' },
  { BrandingThemeID: 'other', Name: 'Special', SortOrder: 2, LogoUrl: 'https://x/o.png' }
]

beforeEach(() => { forgetBrandingTheme(); delete process.env.XERO_BRANDING_THEME })

describe('the branding theme on a draft', () => {
  it('prefers TechnoMed with a logo over the plain default', () => {
    expect(pickBrandingTheme(THEMES)).toBe('tm')
  })
  it('takes the one named in XERO_BRANDING_THEME', () => {
    expect(pickBrandingTheme(THEMES, 'special')).toBe('other')
  })
  it('falls back to any theme with a logo, then to none', () => {
    expect(pickBrandingTheme([THEMES[0], THEMES[2]])).toBe('other')
    expect(pickBrandingTheme([THEMES[0]])).toBeNull()
  })
  it('is added to the draft, and a theme that cannot be read stops nothing', async () => {
    expect(await withTheme(async () => ({ BrandingThemes: THEMES }))).toEqual({ BrandingThemeID: 'tm' })
    forgetBrandingTheme()
    expect(await withTheme(async () => { throw new Error('403') })).toEqual({})
  })
})
