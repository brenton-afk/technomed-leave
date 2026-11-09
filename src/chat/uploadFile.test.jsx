import { describe, it, expect, vi } from 'vitest'
import { uploadFile, directTimeout } from '../pages/Chat.jsx'

const file = (size = 1000) => ({ name: 'Screenshot.jpg', type: 'image/jpeg', size, blob: new Blob(['x'.repeat(10)], { type: 'image/jpeg' }) })
const OURS = '/api/chat?action=file&f=2026-11%2Fabc-Screenshot.jpg'

// Toni, 8–9 Nov 2026: "not uploading attachments", then "still stalling", then
// a test picture that failed both ways on a good desktop connection.
describe('uploading an attachment', () => {
  it('sends a file up to 3 MB through the portal first, and does not touch Blob', async () => {
    const direct = vi.fn()
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ url: OURS }) }))
    expect(await uploadFile(file(), 't', { direct, fetcher })).toBe(OURS)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/chat?action=upload')
    expect(init.headers.Authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Screenshot.jpg', type: 'image/jpeg' })
    expect(direct).not.toHaveBeenCalled()
  })

  it('tries Blob storage when the portal route fails', async () => {
    const direct = vi.fn(async () => ({ url: 'https://a.public.blob.vercel-storage.com/chat/x.jpg' }))
    const fetcher = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'the portal could not store it' }) }))
    expect(await uploadFile(file(), 't', { direct, fetcher })).toMatch(/blob\.vercel-storage/)
  })

  it('sends a big file straight to Blob storage', async () => {
    const direct = vi.fn(async () => ({ url: 'https://a.public.blob.vercel-storage.com/chat/big.pdf' }))
    const fetcher = vi.fn()
    expect(await uploadFile(file(10 * 1024 * 1024), 't', { direct, fetcher })).toMatch(/big\.pdf/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('names both reasons when both routes fail', async () => {
    const direct = vi.fn(async () => { throw new Error('Content type not allowed') })
    const fetcher = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Not signed in, or your session has expired' }) }))
    await expect(uploadFile(file(), 't', { direct, fetcher })).rejects.toThrow(/session has expired; then Content type not allowed/)
    await expect(uploadFile(file(10 * 1024 * 1024), 't', { direct, fetcher })).rejects.toThrow(/Content type not allowed/)
  })

  it('a portal reply with no reason still says what came back', async () => {
    const direct = vi.fn(async () => { throw new Error('it took too long') })
    const fetcher = vi.fn(async () => ({ ok: false, status: 504, json: async () => { throw new Error('not json') } }))
    await expect(uploadFile(file(), 't', { direct, fetcher })).rejects.toThrow(/answered 504; then it took too long/)
  })
})

describe('nothing waits for ever', () => {
  it('gives up on a hanging Blob upload and aborts it', async () => {
    const direct = vi.fn(() => new Promise(() => {}))
    const fetcher = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'no' }) }))
    await expect(uploadFile(file(), 't', { direct, fetcher, timeoutMs: 20 })).rejects.toThrow(/no; then it took too long/)
    expect(direct.mock.calls[0][2].abortSignal?.aborted).toBe(true)
  })

  it('gives up on a hanging portal route and moves on', async () => {
    vi.useFakeTimers()
    const direct = vi.fn(async () => ({ url: 'https://a.public.blob.vercel-storage.com/chat/x.jpg' }))
    const fetcher = vi.fn(() => new Promise(() => {}))
    const p = uploadFile(file(), 't', { direct, fetcher })
    await vi.advanceTimersByTimeAsync(46000)
    expect(await p).toMatch(/x\.jpg/)
    vi.useRealTimers()
  })

  it('allows more time for a bigger file', () => {
    expect(directTimeout(500 * 1024)).toBe(40000)
    expect(directTimeout(50 * 1024 * 1024)).toBe(180000)
  })
})
