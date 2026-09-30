import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shrink, PHOTO_WARNING, MAX_SIDE } from './photo.js'

// Most of what the WhatsApp group carries is a picture — the scanned form, a
// tray with a part number on it, tomorrow's running order on a whiteboard. A
// channel that cannot take one is not a replacement for it.

const drawn = []

beforeEach(() => {
  drawn.length = 0
  global.createImageBitmap = vi.fn(async () => ({ width: 4032, height: 3024, close: vi.fn() }))
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: (_img, _x, _y, w, h) => drawn.push([w, h])
  }))
  HTMLCanvasElement.prototype.toBlob = function (cb, type, quality) {
    cb(new Blob(['x'.repeat(1000)], { type }))
    this._quality = quality
  }
})

describe('getting a photo small enough to send', () => {
  it('brings a phone camera photo down to the long edge', async () => {
    // Straight off a camera this is 4032 across. On a hospital connection that
    // is slow, and a booking form is perfectly legible at a fraction of it.
    const { width, height } = await shrink(new File([''], 'p.jpg', { type: 'image/jpeg' }))
    expect(Math.max(width, height)).toBe(MAX_SIDE)
  })

  it('keeps the shape it was', async () => {
    const { width, height } = await shrink(new File([''], 'p.jpg', { type: 'image/jpeg' }))
    expect(width / height).toBeCloseTo(4032 / 3024, 2)
  })

  it('does not blow up a photo that is already small', async () => {
    global.createImageBitmap = vi.fn(async () => ({ width: 600, height: 400, close: vi.fn() }))
    const { width, height } = await shrink(new File([''], 'p.jpg', { type: 'image/jpeg' }))
    expect([width, height]).toEqual([600, 400])
  })

  it('re-encodes as JPEG, whatever came in', async () => {
    const { blob } = await shrink(new File([''], 'p.png', { type: 'image/png' }))
    expect(blob.type).toBe('image/jpeg')
  })

  it('reports the size it drew, so the channel can hold the space', async () => {
    // Without this the messages jump about as pictures load and somebody loses
    // their place halfway through reading a running order.
    const { width, height } = await shrink(new File([''], 'p.jpg', { type: 'image/jpeg' }))
    expect(drawn[0]).toEqual([width, height])
  })

  it('reads the orientation tag rather than tipping a portrait photo over', async () => {
    await shrink(new File([''], 'p.jpg', { type: 'image/jpeg' }))
    expect(global.createImageBitmap).toHaveBeenCalledWith(
      expect.anything(), { imageOrientation: 'from-image' })
  })

  it('says so when the file is not a photo at all', async () => {
    global.createImageBitmap = vi.fn(async () => { throw new Error('nope') })
    global.Image = class { set src(_) { setTimeout(() => this.onerror?.(), 0) } }
    global.URL.createObjectURL = vi.fn(() => 'blob:x')
    global.URL.revokeObjectURL = vi.fn()
    await expect(shrink(new File([''], 'p.txt', { type: 'text/plain' })))
      .rejects.toThrow(/could not be read/)
  })
})

describe('what is said before a photo goes', () => {
  it('names what to do, rather than only disapproving', () => {
    // The text of a message goes through identifiers.js, which reads it. A
    // photograph walks past all of that, and a picture of a booking form
    // carries a full name, usually a DOB and often a UR number.
    expect(PHOTO_WARNING).toMatch(/crop/i)
    expect(PHOTO_WARNING).toMatch(/name/i)
  })
})
