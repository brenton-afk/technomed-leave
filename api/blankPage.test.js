import { describe, it, expect } from 'vitest'
import { looksLikeBlankJpeg, jpegSize } from './_blankPage.js'

// A minimal JPEG header: SOI, an APP0 segment, then SOF0 with the size.
function fakeJpeg(width, height, totalBytes) {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255]
  const out = Buffer.alloc(Math.max(totalBytes, head.length + 2), 0x55)
  Buffer.from(head).copy(out)
  return out.toString('base64')
}

describe('a black page is refused (Toni, 20 Nov 2026)', () => {
  it('reads the size from the frame header', () => {
    expect(jpegSize(Buffer.from(fakeJpeg(2400, 1800, 100), 'base64'))).toEqual({ width: 2400, height: 1800 })
  })
  it('flags a big page that compressed to almost nothing (the black ones were 0.016 B/px)', () => {
    expect(looksLikeBlankJpeg(fakeJpeg(1800, 2400, 69466))).toBe(true)
  })
  it('passes a real page (0.5 B/px) and a sparse one', () => {
    expect(looksLikeBlankJpeg(fakeJpeg(1176, 1568, 981758))).toBe(false)
    expect(looksLikeBlankJpeg(fakeJpeg(1800, 2400, 500000))).toBe(false)
  })
  it('does not judge a thumbnail, or something that is not a JPEG', () => {
    expect(looksLikeBlankJpeg(fakeJpeg(300, 400, 500))).toBe(false)
    expect(looksLikeBlankJpeg(Buffer.from('%PDF-1.4').toString('base64'))).toBe(false)
  })
})
