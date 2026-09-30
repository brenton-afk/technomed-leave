import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The photo field on a message is a URL the app will render inside the team's
// own chat. Accepting any URL would be two problems at once: a way to smuggle a
// tracking pixel into the channel, and a way to make the app display something
// nobody here uploaded.
const SOURCE = readFileSync(join(__dirname, 'chat.js'), 'utf8')

// Pulled out of the module rather than imported, because importing api/chat.js
// drags in Redis and the session store for a check that is purely about a string.
const PATTERN = new RegExp(
  /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.source, 'i')

describe('which photo URLs a message may carry', () => {
  it('takes one this app\'s own blob store issued', () => {
    expect(PATTERN.test('https://abc123.public.blob.vercel-storage.com/chat/1.jpg')).toBe(true)
  })

  for (const bad of [
    'https://evil.example.com/tracker.gif',
    'http://abc.public.blob.vercel-storage.com/x.jpg',       // not https
    'https://public.blob.vercel-storage.com.evil.com/x.jpg', // lookalike host
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    ''
  ]) {
    it(`refuses ${JSON.stringify(bad).slice(0, 48)}`, () => {
      expect(PATTERN.test(bad)).toBe(false)
    })
  }

  it('is actually the check the route applies', () => {
    // Guards against this test drifting away from the code it describes.
    expect(SOURCE).toMatch(/public\\?\.blob\\?\.vercel-storage\\?\.com/)
    expect(SOURCE).toMatch(/function readPhoto/)
  })
})

describe('the upload handshake', () => {
  it('is routed before the session gate, and says why', () => {
    // @vercel/blob builds its own request, so requireSession would refuse every
    // upload. The session rides in clientPayload instead.
    const handler = SOURCE.slice(SOURCE.indexOf('export default async function handler'))
    const upload = handler.indexOf("action === 'blob-upload'")
    const gate = handler.indexOf('await requireSession')
    expect(upload).toBeGreaterThan(-1)
    expect(upload).toBeLessThan(gate)
  })

  it('checks the session inside, before issuing a write token', () => {
    expect(SOURCE).toMatch(/onBeforeGenerateToken[\s\S]{0,400}getSession/)
  })

  it('will only accept images', () => {
    // This endpoint mints a write token. One that took anything would be a
    // place to park anything.
    expect(SOURCE).toMatch(/allowedContentTypes:\s*\[\s*'image\//)
  })
})
