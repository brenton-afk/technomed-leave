import { describe, it, expect, vi } from 'vitest'
import { uploadFile } from '../pages/Chat.jsx'

const file = (size = 1000) => ({ name: 'Screenshot.jpg', type: 'image/jpeg', size, blob: new Blob(['x'.repeat(10)], { type: 'image/jpeg' }) })

describe('uploading an attachment (Toni, 8 Nov 2026: "not uploading attachments")', () => {
  it('goes straight to storage when it can', async () => {
    const direct = vi.fn(async () => ({ url: 'https://a.public.blob.vercel-storage.com/chat/x.jpg' }))
    const fetcher = vi.fn()
    expect(await uploadFile(file(), 't', { direct, fetcher })).toMatch(/blob\.vercel-storage/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('falls back through the portal when the direct upload is stopped', async () => {
    const direct = vi.fn(async () => { throw new Error('Failed to retrieve the client token') })
    const fetcher = vi.fn(async (url, init) => ({ ok: true, json: async () => ({ url: 'https://a.public.blob.vercel-storage.com/chat/y.jpg' }) }))
    expect(await uploadFile(file(), 't', { direct, fetcher })).toMatch(/y\.jpg/)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/chat?action=upload')
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Screenshot.jpg', type: 'image/jpeg' })
  })

  it('says why when both ways fail, instead of blaming the signal', async () => {
    const direct = vi.fn(async () => { throw new Error('Content type not allowed') })
    const fetcher = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Not signed in, or your session has expired' }) }))
    await expect(uploadFile(file(), 't', { direct, fetcher })).rejects.toThrow(/session has expired/)
    await expect(uploadFile(file(10 * 1024 * 1024), 't', { direct, fetcher })).rejects.toThrow(/Content type not allowed/)
  })
})

describe('an upload that hangs (Toni, 9 Nov 2026: "still stalling")', () => {
  it('gives up on the direct route after its time and sends through the portal', async () => {
    const direct = vi.fn(() => new Promise(() => {}))   // never answers
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://x.public.blob.vercel-storage.com/chat/y.jpg' }) }))
    const steps = []
    const url = await uploadFile(file(), 't', { direct, fetcher, timeoutMs: 20, onProgress: p => steps.push(p) })
    expect(url).toMatch(/y\.jpg/)
    expect(direct.mock.calls[0][2].abortSignal?.aborted).toBe(true)
    expect(steps).toContain(null)
  })
  it('says why when both routes fail, rather than spinning', async () => {
    const direct = vi.fn(() => new Promise(() => {}))
    const fetcher = vi.fn(() => new Promise(() => {}))
    vi.useFakeTimers()
    const p = uploadFile(file(), 't', { direct, fetcher, timeoutMs: 10 })
    const done = expect(p).rejects.toThrow(/took too long.*too slow/)
    await vi.advanceTimersByTimeAsync(60000)
    await done
    vi.useRealTimers()
  })
  it('allows more time for a bigger file', async () => {
    const { directTimeout } = await import('../pages/Chat.jsx')
    expect(directTimeout(500 * 1024)).toBe(40000)
    expect(directTimeout(50 * 1024 * 1024)).toBe(180000)
  })
})
