import { describe, it, expect, vi, beforeEach } from 'vitest'

// The portal's own upload route (9 Nov 2026): Dropbox first, Blob second, and
// neither may hang the function.
const dropbox = { configured: true, upload: vi.fn() }
vi.mock('./_dropbox.js', () => ({
  dropboxConfigured: () => dropbox.configured,
  uploadFile: (...a) => dropbox.upload(...a),
  temporaryLink: vi.fn(async () => ({ url: 'https://dl.dropboxusercontent.com/x' }))
}))
const put = vi.fn()
vi.mock('@vercel/blob', () => ({ put: (...a) => put(...a) }))
vi.mock('./_auth.js', () => ({
  requireSession: vi.fn(async () => ({ email: 'toni@technomed.com.au', name: 'Toni' })),
  getSession: vi.fn(async () => ({ email: 'toni@technomed.com.au' }))
}))

const { default: handler } = await import('./chat.js')

function call(query, body) {
  return new Promise(resolve => {
    const res = {
      headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v },
      status(c) { this.statusCode = c; return this },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }) },
      end() { resolve({ status: this.statusCode, headers: this.headers }) }
    }
    handler({ method: body ? 'POST' : 'GET', query, body, headers: {} }, res)
  })
}
const picture = { name: 'WhatsApp Image 2025-05-10 at 21.42.42.jpg', type: 'image/jpeg', data: Buffer.from('jpegbytes').toString('base64') }

beforeEach(() => { dropbox.configured = true; dropbox.upload.mockReset(); put.mockReset() })

describe('the portal upload route', () => {
  it('keeps the file in Dropbox and answers with the portal address', async () => {
    dropbox.upload.mockResolvedValue({})
    const r = await call({ action: 'upload' }, picture)
    expect(r.status).toBe(200)
    expect(r.body.url).toMatch(/^\/api\/chat\?action=file&f=2026-|^\/api\/chat\?action=file&f=\d{4}-/)
    expect(dropbox.upload.mock.calls[0][0]).toMatch(/^\/Admin\/Chat Files\/\d{4}-\d{2}\//)
    expect(put).not.toHaveBeenCalled()
  })
  it('falls to Blob when Dropbox fails, and says why when Blob hangs', async () => {
    dropbox.upload.mockRejectedValue(new Error('Dropbox is not connected'))
    put.mockResolvedValue({ url: 'https://a.public.blob.vercel-storage.com/chat/x.jpg' })
    expect((await call({ action: 'upload' }, picture)).body.url).toMatch(/blob/)
    vi.useFakeTimers()
    put.mockReturnValue(new Promise(() => {}))
    const pending = call({ action: 'upload' }, picture)
    await vi.advanceTimersByTimeAsync(9000)
    const r = await pending
    vi.useRealTimers()
    expect(r.status).toBe(502)
    expect(r.body.error).toMatch(/did not answer/)
  })
  it('opens a kept file by redirecting to Dropbox, and nothing else', async () => {
    const ok = await call({ action: 'file', f: '2026-11/12345678-1234-1234-1234-123456789abc-a.jpg' })
    expect(ok.status).toBe(302)
    expect(ok.headers.Location).toMatch(/dropboxusercontent/)
    expect((await call({ action: 'file', f: '../secret' })).status).toBe(404)
  })
})
