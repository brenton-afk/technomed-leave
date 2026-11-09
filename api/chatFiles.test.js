import { describe, it, expect } from 'vitest'
import { newChatFile, chatFileKey, chatFilePath, CHAT_FILES_ROOT } from './_chatFiles.js'
import { readFiles } from './chat.js'

describe('chat files kept in Dropbox (9 Nov 2026)', () => {
  it('get a random address under one folder, and read back to the same file', () => {
    const f = newChatFile('WhatsApp Image 2025-05-10 at 21.42.42.jpg', new Date('2026-11-09T00:00:00Z'))
    expect(f.path.startsWith(`${CHAT_FILES_ROOT}/2026-11/`)).toBe(true)
    expect(f.url.startsWith('/api/chat?action=file&f=')).toBe(true)
    expect(chatFilePath(chatFileKey(f.url))).toBe(f.path)
  })
  it('never opens anything but that shape of path', () => {
    expect(chatFilePath('../ALL SURGEON USAGE/x.pdf')).toBeNull()
    expect(chatFilePath('2026-11/not-a-uuid-x.jpg')).toBeNull()
    expect(chatFileKey('/api/chat?action=file&f=..%2F..%2Fsecret')).toBeNull()
  })
  it('are accepted on a message, alongside Blob links; nothing else is', () => {
    const f = newChatFile('a.jpg')
    const kept = readFiles([
      { url: f.url, type: 'image/jpeg', name: 'a.jpg' },
      { url: 'https://x.public.blob.vercel-storage.com/chat/b.jpg', type: 'image/jpeg', name: 'b.jpg' },
      { url: 'https://evil.example/c.jpg', type: 'image/jpeg', name: 'c.jpg' }
    ])
    expect(kept.map(k => k.name)).toEqual(['a.jpg', 'b.jpg'])
  })
})
