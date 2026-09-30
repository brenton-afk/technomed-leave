import { describe, it, expect, vi } from 'vitest'
import { runningBundle, servedBundle, hasNewBuild } from './appVersion.js'

// A portal people leave open. A tab opened on Monday ran Monday's build until
// somebody happened to reload, and nothing on screen said so — the bookings kept
// updating, so it looked live. A change shipped at four o'clock was invisible at
// half past, and the only clue was a button somebody had been told about not
// being there.

const page = html => {
  const doc = document.implementation.createHTMLDocument()
  doc.body.innerHTML = html
  return doc
}

const serving = html => vi.fn(async () => ({ ok: true, text: async () => html }))

describe('which build this page is running', () => {
  it('reads it off the script that loaded the app', () => {
    expect(runningBundle(page('<script src="/assets/index-ABC123.js"></script>')))
      .toBe('index-ABC123.js')
  })

  it('ignores other scripts on the page', () => {
    expect(runningBundle(page(
      '<script src="/vendor/thing.js"></script><script src="/assets/index-ABC123.js"></script>')))
      .toBe('index-ABC123.js')
  })

  it('is nothing in dev, where there is no hashed bundle', () => {
    expect(runningBundle(page('<script src="/src/main.jsx"></script>'))).toBe(null)
  })
})

describe('which build the server is handing out', () => {
  it('reads it out of the page it serves', async () => {
    const html = '<html><body><script src="/assets/index-XYZ789.js"></script></body></html>'
    await expect(servedBundle(serving(html))).resolves.toBe('index-XYZ789.js')
  })

  it('asks for a fresh copy rather than the cached one', async () => {
    // The whole question is whether the server has something newer. Asking the
    // cache would answer with the thing we are trying to get past.
    const fetcher = serving('<script src="/assets/index-XYZ789.js"></script>')
    await servedBundle(fetcher)
    expect(fetcher).toHaveBeenCalledWith('/', { cache: 'no-store' })
  })

  it('throws rather than guessing when the page will not load', async () => {
    await expect(servedBundle(vi.fn(async () => ({ ok: false })))).rejects.toThrow()
  })
})

describe('deciding whether to offer a reload', () => {
  it('offers one when the name has changed', async () => {
    document.head.innerHTML = '<script src="/assets/index-OLD.js"></script>'
    await expect(hasNewBuild(serving('<script src="/assets/index-NEW.js"></script>')))
      .resolves.toBe(true)
  })

  it('stays quiet when it is the same build', async () => {
    document.head.innerHTML = '<script src="/assets/index-SAME.js"></script>'
    await expect(hasNewBuild(serving('<script src="/assets/index-SAME.js"></script>')))
      .resolves.toBe(false)
  })

  it('stays quiet in dev, where there is nothing to compare', async () => {
    document.head.innerHTML = '<script src="/src/main.jsx"></script>'
    await expect(hasNewBuild(serving('<script src="/assets/index-NEW.js"></script>')))
      .resolves.toBe(false)
  })

  it('stays quiet when the served page cannot be read', async () => {
    // A prompt nobody can satisfy is worse than none: it would sit there through
    // every offline moment in a hospital basement.
    document.head.innerHTML = '<script src="/assets/index-OLD.js"></script>'
    await expect(hasNewBuild(serving('<html><body>nothing</body></html>')))
      .resolves.toBe(false)
  })
})
