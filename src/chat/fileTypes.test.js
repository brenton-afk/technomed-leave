import { describe, it, expect, vi } from 'vitest'
import { fileTypeOf, FILE_TYPES } from './fileTypes.js'

// Brent, 8 Nov 2026: "The portal MUST be able to accept attachments."
describe('what a file is sent as', () => {
  it('keeps a known type, guesses from the name when the phone or PC gives none, and never refuses', () => {
    expect(fileTypeOf({ type: 'image/png', name: 'Screenshot.png' })).toBe('image/png')
    expect(fileTypeOf({ type: '', name: 'IMG_0042.HEIC' })).toBe('image/heic')
    expect(fileTypeOf({ type: '', name: 'Booking.msg' })).toBe('application/vnd.ms-outlook')
    expect(fileTypeOf({ type: 'application/x-weird', name: 'thing.xyz' })).toBe('application/octet-stream')
    expect(FILE_TYPES).toContain('application/octet-stream')
  })
})
