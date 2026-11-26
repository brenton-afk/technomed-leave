import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildMime, copyOwner, copyToSent, GMAIL_INSERT } from './_sentCopy.js'

afterEach(() => { delete process.env.SENT_COPY })

const message = {
  messageId: '<tm-1@technomed.com.au>', date: new Date('2026-11-26T01:00:00Z'),
  from: 'Rep Example <rep@technomed.com.au>', to: ['a@example.test'], cc: ['b@example.test'], replyTo: 'rep@technomed.com.au',
  subject: 'Usage – Testcase', html: '<p>Hi</p>', text: 'Hi',
  attachments: [{ filename: 'sheet.xlsx', content: Buffer.from('xlsx').toString('base64') }, { filename: 'logo.png', content: 'iVBO', content_id: 'technomed-logo', content_type: 'image/png' }]
}

describe('the copy in the sender\'s Sent folder', () => {
  it('is only for an email sent From the staff member', () => {
    expect(copyOwner('Rep Example <rep@technomed.com.au>', { email: 'rep@technomed.com.au' })).toBe('rep@technomed.com.au')
    expect(copyOwner('TechnoMed Portal <portal@technomed.com.au>', { email: 'rep@technomed.com.au' })).toBe('')
    expect(copyOwner('x@gmail.com', { email: 'x@gmail.com' })).toBe('')
    expect(copyOwner('anything', null)).toBe('')
  })

  it('is the same message: headers, both bodies, attachments and the inline logo', () => {
    const mime = buildMime(message)
    expect(mime).toContain('From: Rep Example <rep@technomed.com.au>')
    expect(mime).toContain('To: a@example.test')
    expect(mime).toContain('Cc: b@example.test')
    expect(mime).toContain('Message-ID: <tm-1@technomed.com.au>')
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('Usage – Testcase').toString('base64')}?=`)
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8')
    expect(mime).toContain('Content-Disposition: attachment; filename="sheet.xlsx"')
    expect(mime).toContain('Content-ID: <technomed-logo>')
    expect(mime).toMatch(/Content-Type: application\/vnd\.openxmlformats/)
  })

  it('is filed with the SENT label as the sender, never sent', async () => {
    process.env.SENT_COPY = 'on'
    const getToken = vi.fn(async () => 'tok')
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }))
    expect(await copyToSent(message, 'rep@technomed.com.au', { getToken, fetchImpl })).toBe('filed')
    expect(getToken).toHaveBeenCalledWith(GMAIL_INSERT, { impersonate: 'rep@technomed.com.au' })
    const [url, opts] = fetchImpl.mock.calls[0]
    expect(url).toMatch(/\/users\/me\/messages\?/)
    expect(url).not.toMatch(/send/)
    expect(JSON.parse(opts.body).labelIds).toEqual(['SENT'])
  })

  it('says so, and never throws, when the permission is not there yet', async () => {
    process.env.SENT_COPY = 'on'
    const getToken = vi.fn(async () => { throw new Error('unauthorized_client: Client is unauthorized') })
    expect(await copyToSent(message, 'rep@technomed.com.au', { getToken })).toBe('not allowed yet')
    const forbidden = vi.fn(async () => ({ ok: false, status: 403 }))
    expect(await copyToSent(message, 'rep@technomed.com.au', { getToken: async () => 't', fetchImpl: forbidden })).toBe('not allowed yet')
  })

  it('can be switched off', async () => {
    process.env.SENT_COPY = 'off'
    expect(await copyToSent(message, 'rep@technomed.com.au', { getToken: vi.fn() })).toBe('off')
  })
})
