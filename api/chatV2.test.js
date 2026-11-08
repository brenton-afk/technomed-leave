import { describe, it, expect } from 'vitest'
import { readFiles, mentionsIn, CHANNELS, REACTIONS, lastLine } from './chat.js'
import { messageMatches } from './_chatSearch.js'

// Chat, WhatsApp and Slack style (Brent, 6 Nov 2026). Invented content only.

describe('files on a message', () => {
  it('keeps only files from this app’s own store, and says what they are', () => {
    const files = readFiles([
      { url: 'https://abc.public.blob.vercel-storage.com/chat/x.pdf', type: 'application/pdf', name: 'Tray list.pdf', size: 1000 },
      { url: 'https://evil.example.com/x.png', type: 'image/png', name: 'x.png' },
      { url: 'https://abc.public.blob.vercel-storage.com/chat/y.gif', type: 'image/gif', name: 'y.gif' },
      { url: 'https://abc.public.blob.vercel-storage.com/chat/z.exe', type: 'application/x-msdownload', name: 'z.exe' }
    ])
    expect(files.map(f => f.name)).toEqual(['Tray list.pdf', 'y.gif', 'z.exe'])
    expect(files[2].type).toBe('application/octet-stream')
  })
})

describe('@mentions', () => {
  it('finds the people named, and everyone for @all', () => {
    expect(mentionsIn('@Mat can you grab the Diplomat')).toEqual(['mat@technomed.com.au'])
    expect(mentionsIn('@all list is moving').length).toBeGreaterThan(5)
    expect(mentionsIn('email mat@technomed')).toEqual([])
  })
})

describe('the channels', () => {
  it('include Portal feedback, read by the improvement agent', () => {
    expect(CHANNELS.map(c => c.id)).toContain('portal-feedback')
    expect(REACTIONS).toContain('👍')
  })
})

describe('searching messages', () => {
  const m = { text: 'Diplomat back from RHH', authorName: 'Mat', files: [{ name: 'Tray list.pdf' }] }
  it('needs every word, across text, who and file names', () => {
    expect(messageMatches(m, ['mat', 'diplomat'])).toBe(true)
    expect(messageMatches(m, ['tray', 'list'])).toBe(true)
    expect(messageMatches(m, ['toni', 'diplomat'])).toBe(false)
    expect(messageMatches({ ...m, deleted: true }, ['diplomat'])).toBe(false)
  })
})

describe('looking like WhatsApp (7 Nov 2026)', () => {
  it('every standing chat has an icon', () => {
    expect(CHANNELS.every(c => c.icon?.emoji)).toBe(true)
  })

  it('the list preview says who said what, or what kind of file it was', () => {
    expect(lastLine({ authorName: 'Mat', author: 'mat@x', text: 'Set is   back\nfrom CSSD', at: 't' }))
      .toEqual({ authorName: 'Mat', author: 'mat@x', text: 'Set is back from CSSD', at: 't' })
    expect(lastLine({ authorName: 'Toni', files: [{ type: 'image/jpeg' }] }).text).toBe('📷 Photo')
    expect(lastLine({ authorName: 'Toni', files: [{ type: 'application/pdf', name: 'Tray list.pdf' }] }).text).toBe('📎 Tray list.pdf')
    expect(lastLine({ authorName: 'Toni', text: 'secret', deleted: true }).text).toBe('This message was deleted')
    expect(lastLine(null)).toBeNull()
  })
})

describe('attachments always get through (8 Nov 2026)', () => {
  it('a file name is made safe for storage', async () => {
    const { directUploadName } = await import('./chat.js')
    expect(directUploadName('Toni\'s screen/shot (1).png')).toBe('Toni_s screen_shot _1_.png')
    expect(directUploadName('')).toBe('file')
  })
})
