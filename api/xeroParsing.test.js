import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Eight call sites all did `await res.json()` on a Xero reply, and every one
// of them would have thrown the same unreadable parse error the first time
// Xero answered in XML. The timesheet one is simply the one somebody reached
// first, on a Sunday.
//
// So this is checked across the files rather than fixed eight times and hoped
// about: anything talking to Xero reads its reply through readXero.

const ROOT = join(__dirname, '..')

function filesTouchingXero(dir = 'api') {
  const found = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...filesTouchingXero(path))
    else if (entry.name.endsWith('.js') && !entry.name.includes('.test.')) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      if (/api\.xero\.com|identity\.xero\.com/.test(source)) found.push(path)
    }
  }
  return found
}

describe('everything that talks to Xero', () => {
  const files = filesTouchingXero()

  it('finds the callers, so this is testing something', () => {
    expect(files.length).toBeGreaterThan(2)
  })

  for (const path of files) {
    it(`${path} reads the reply through readXero`, () => {
      const source = readFileSync(join(ROOT, path), 'utf8')
      const raw = [...source.matchAll(/await\s+(\w*[Rr]es\w*)\.json\(\)/g)].map(m => m[0])
      expect(raw, `${path} parses a Xero reply with .json(). Xero answers errors `
        + 'in XML whatever the Accept header says, and that throws a parse error '
        + 'which replaces the real message. Use readXero from api/_xeroResponse.js.')
        .toEqual([])
    })
  }
})
