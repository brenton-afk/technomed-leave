import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mayPreviewStock } from '../../../../api/_stockPreview.js'
import { SCREENS } from './StockPreview.jsx'

const dir = join(__dirname, 'screens')

describe('stock on hand preview (Brent only, 22 Nov 2026)', () => {
  it('is Brent alone unless STOCK_PREVIEW_USERS says otherwise', () => {
    expect(mayPreviewStock('brenton@technomed.com.au', {})).toBe(true)
    expect(mayPreviewStock('Brenton@TechnoMed.com.au', {})).toBe(true)
    expect(mayPreviewStock('erin@technomed.com.au', {})).toBe(false)
    expect(mayPreviewStock('', {})).toBe(false)
    expect(mayPreviewStock('erin@technomed.com.au', { STOCK_PREVIEW_USERS: 'brenton@technomed.com.au, erin@technomed.com.au' })).toBe(true)
  })

  it('the server answers 404 to anyone else', () => {
    const src = readFileSync(join(__dirname, '../../../../api/xero/info.js'), 'utf8')
    expect(src).toMatch(/stock-preview-access[\s\S]{0,300}mayPreviewStock\(session\.email\)\) return res\.status\(404\)/)
  })

  it('Admin shows the card only after the server says yes', () => {
    const src = readFileSync(join(__dirname, '../AdminPortal.jsx'), 'utf8')
    expect(src).toMatch(/stock-preview-access/)
    expect(src).toMatch(/\{canStock && \(/)
    expect(src).toMatch(/domain === 'stock' && canStock/)
  })

  it('every screen has its file, and none reaches the server or saves anything', () => {
    const files = readdirSync(dir).filter(f => f.endsWith('.jsx'))
    for (const s of Object.values(SCREENS)) {
      const name = String(s.load).match(/screens\/(\w+)\.jsx/)[1]
      expect(files).toContain(`${name}.jsx`)
    }
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src, f).not.toMatch(/fetch\(|\/api\/|localStorage|sessionStorage|position:\s*'fixed'/)
    }
  })
})
