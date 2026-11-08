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
