import { describe, it, expect } from 'vitest'
import { sniffMediaType, addressOf } from './_gmail.js'

// A booking arrives as whatever the sender's phone and mail client produced
// between them, and what the MIME header claims is not evidence. Anthropic
// checks the bytes and rejects a mismatch, which failed a whole run over one
// photo of a theatre list labelled PNG that was a JPEG.

const b64 = bytes => Buffer.from(bytes).toString('base64')

const JPEG = b64([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const PNG = b64([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0])
const PDF = b64([...Buffer.from('%PDF-1.7\n'), 0, 0, 0, 0, 0, 0, 0])
const WEBP = b64([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 '), 0, 0, 0, 0])

describe('what an attachment actually is', () => {
  it('believes the bytes over the header', () => {
    // The exact failure seen in the mailbox.
    expect(sniffMediaType(JPEG, 'image/png')).toBe('image/jpeg')
    expect(sniffMediaType(PNG, 'image/jpeg')).toBe('image/png')
  })

  it('recognises the formats a booking turns up as', () => {
    expect(sniffMediaType(PDF, 'application/octet-stream')).toBe('application/pdf')
    expect(sniffMediaType(WEBP, 'image/png')).toBe('image/webp')
    expect(sniffMediaType(JPEG, 'image/jpeg')).toBe('image/jpeg')
  })

  it('keeps the declared type when the bytes say nothing', () => {
    // A .docx or a calendar invite has no signature worth matching here, and
    // guessing would be worse than passing it through to be filtered later.
    expect(sniffMediaType(b64([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]), 'application/zip'))
      .toBe('application/zip')
    expect(sniffMediaType('', 'image/png')).toBe('image/png')
    expect(sniffMediaType(null, 'image/png')).toBe('image/png')
  })
})

describe('reading a sender', () => {
  it('takes the address out of a display name', () => {
    expect(addressOf('Tobias Long <tobias.long@ths.tas.gov.au>')).toBe('tobias.long@ths.tas.gov.au')
    expect(addressOf('bookings@cnstas.com.au')).toBe('bookings@cnstas.com.au')
    expect(addressOf('  MIXED@Case.COM  ')).toBe('mixed@case.com')
    expect(addressOf(null)).toBe('')
  })
})
