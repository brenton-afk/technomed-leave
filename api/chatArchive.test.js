import { describe, it, expect, vi } from 'vitest'

// The nightly chat archive to Dropbox. Invented content only.

const uploads = []
vi.mock('./_redis.js', () => ({
  knownChannels: vi.fn(async () => ['general']),
  channelIds: vi.fn(async () => ['a', 'b', 'c']),
  getMessages: vi.fn(async () => [
    { id: 'a', at: '2026-11-05T22:00:00Z', authorName: 'Mat', text: 'Diplomat to RHH', files: [{ name: 'tray.pdf', url: 'https://x.public.blob.vercel-storage.com/t.pdf' }], reactions: { '👍': ['Toni'] } },
    { id: 'b', at: '2026-11-06T01:00:00Z', authorName: 'Toni', text: 'Done', replyTo: { authorName: 'Mat', text: 'Diplomat to RHH' } },
    { id: 'c', at: '2026-11-07T01:00:00Z', authorName: 'Ben', text: 'Next day' }
  ])
}))
vi.mock('./_dropbox.js', () => ({
  dropboxConfigured: () => true,
  ensureFolder: vi.fn(async () => {}),
  uploadFile: vi.fn(async (path, buf) => { uploads.push({ path, text: buf.toString('utf8') }) })
}))

const { archiveChat } = await import('./_chatArchive.js')

describe('the nightly archive', () => {
  it('files one Hobart day of each channel, with its attachments', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('pdf').buffer }))
    const out = await archiveChat('2026-11-06', { fetcher })
    expect(out.channels).toEqual([{ channel: 'general', messages: 2, files: 1 }])
    const t = uploads.find(u => u.path.endsWith('/general.txt'))
    expect(t.path).toBe('/Admin/Chat Archive/2026/11/2026-11-06/general.txt')
    expect(t.text).toMatch(/Mat: Diplomat to RHH/)
    expect(t.text).toMatch(/replying to Mat/)
    expect(t.text).toMatch(/reactions: 👍 Toni/)
    expect(t.text).not.toMatch(/Next day/)
    expect(uploads.some(u => u.path.includes('/files/') && u.path.endsWith('tray.pdf'))).toBe(true)
  })
})
