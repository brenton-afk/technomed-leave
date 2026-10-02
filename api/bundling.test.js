import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// ─── A dependency a function uses has to be bundled with it ──────────────────
// @vercel/blob is not traced into a function automatically — its entry points
// are resolved at runtime, so the bundler does not see them and the files are
// left out. Each function that uses it needs an includeFiles rule in
// vercel.json naming the package.
//
// api/meetings/agent.js had one. api/chat.js grew a photo upload, imported the
// same package, and did not — so the whole Messages function died on every
// request with "Cannot find module @vercel/blob/dist/client.cjs". Not the
// upload: the whole function, including reading a channel.
//
// Nothing local catches this. It builds, it lints, 1202 tests pass, and the
// import resolves perfectly on a laptop where node_modules is simply there.
// It only fails once deployed, which is the worst place to find out.

const ROOT = join(__dirname, '..')
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))

/** Packages that have to be named in includeFiles to survive bundling. */
const NEEDS_INCLUDING = ['@vercel/blob']

function functions(dir = 'api') {
  const found = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...functions(path))
    else if (entry.name.endsWith('.js') && !entry.name.startsWith('_')
      && !entry.name.includes('.test.')) found.push(path)
  }
  return found
}

describe('functions that use a package the bundler cannot trace', () => {
  const offenders = []
  for (const path of functions()) {
    const source = readFileSync(join(ROOT, path), 'utf8')
    for (const pkg of NEEDS_INCLUDING) {
      if (!source.includes(`from '${pkg}`)) continue
      const rule = CONFIG.functions?.[path]?.includeFiles || ''
      if (!rule.includes(pkg)) offenders.push(`${path} imports ${pkg}`)
    }
  }

  it('name it in vercel.json, or the whole function dies on deploy', () => {
    expect(offenders, 'These functions import a package that is not traced into '
      + 'the bundle. Add an includeFiles rule for each in vercel.json:\n'
      + offenders.join('\n')).toEqual([])
  })

  it('is watching something, rather than passing vacuously', () => {
    const users = functions().filter(path =>
      NEEDS_INCLUDING.some(pkg => readFileSync(join(ROOT, path), 'utf8').includes(`from '${pkg}`)))
    expect(users.length).toBeGreaterThan(1)
  })
})
