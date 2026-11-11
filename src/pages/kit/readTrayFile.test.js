import { describe, it, expect, vi } from 'vitest'

// "Still uploading….." — the phone unpacks a tray list and sends only what
// needs reading. Made-up contents only.

vi.mock('mammoth/mammoth.browser.js', () => ({
  default: {
    images: { imgElement: fn => fn },
    convertToHtml: vi.fn(async () => ({
      value: '<h1>TRAY 1</h1><table><tr><td>X-1</td><td>AWL</td><td>1</td></tr></table>'
    }))
  }
}))

describe('what the phone sends', () => {
  it('sends a Word document as its text, not the file', async () => {
    const { trayFilePayload } = await import('./readTrayFile.js')
    const file = new File([new Uint8Array(5_000_000)], 'Shoreline Master.docx')
    file.arrayBuffer = async () => new ArrayBuffer(8)
    const payload = await trayFilePayload(file)
    // The table keeps its shape: one row per line, cells split.
    expect(payload.text).toContain('TRAY 1')
    expect(payload.text).toContain('X-1 | AWL | 1 |')
    expect(payload.photos).toEqual([])
  })

  it('sends a small spreadsheet as it is', async () => {
    const { trayFilePayload } = await import('./readTrayFile.js')
    const file = new File([new Uint8Array([1, 2, 3])], 'Screws.xlsx')
    file.arrayBuffer = async () => new Uint8Array([1, 2, 3]).buffer
    const payload = await trayFilePayload(file)
    expect(payload.data).toBe('AQID')
  })

  it('says plainly when it cannot read a file', async () => {
    const { trayFilePayload } = await import('./readTrayFile.js')
    await expect(trayFilePayload(new File(['x'], 'notes.pages'))).rejects.toThrow(/PDF, Word document/)
  })

  it('only sends an original whole when it fits in one request', async () => {
    const { originalIfSmall } = await import('./readTrayFile.js')
    const big = new File([new Uint8Array(5_000_000)], 'big.pdf')
    expect(await originalIfSmall(big)).toBeNull()
  })
})

describe('which pictures count as a tray photo', () => {
  it('takes a photograph and leaves out letterheads and tick-boxes', async () => {
    const { looksLikePhoto } = await import('./readTrayFile.js')
    expect(looksLikePhoto(470, 352)).toBe(true)   // the CYLOX tray on Calvary's check sheet
    expect(looksLikePhoto(595, 149)).toBe(false)  // Calvary's letterhead banner
    expect(looksLikePhoto(100, 100)).toBe(false)  // the tick-box icon
  })
})

describe('item pictures beside their rows', () => {
  // Heights as a real check sheet prints them: a row's words at the top of
  // its row, the picture beside and below (Brent, 11 Nov 2026).
  it('puts each picture straight after its own row', async () => {
    const { interleaveByHeight, photoMarker } = await import('./readTrayFile.js')
    const lines = [
      { y: 705.8, text: 'PREVIEW' },
      { y: 688.8, text: '22 INSERTER DEPTH STOP 1' },
      { y: 607.7, text: '23 INSERTER CAGE 2' },
      { y: 526.7, text: 'INSTRUMENTS 33' },
      { y: 513.0, text: '24 DRILL GUIDE 5 1' },
      { y: 431.9, text: '25 DRILL GUIDE 6 1' },
      { y: 384.7, text: '28 DRILL GUIDE 2 HOLE 1' }
    ]
    const photos = [
      { top: 696.3, text: photoMarker(1, 76) },
      { top: 615.3, text: photoMarker(2, 76) },
      { top: 520.5, text: photoMarker(3, 76) },
      { top: 392.2, text: photoMarker(4, 76) }
    ]
    expect(interleaveByHeight(lines, photos)).toEqual([
      'PREVIEW', '22 INSERTER DEPTH STOP 1', '[PHOTO 1]', '23 INSERTER CAGE 2', '[PHOTO 2]', 'INSTRUMENTS 33',
      '24 DRILL GUIDE 5 1', '[PHOTO 3]', '25 DRILL GUIDE 6 1', '28 DRILL GUIDE 2 HOLE 1', '[PHOTO 4]'
    ])
  })

  it('marks a picture drawn large as the tray, and keeps a stray one at the end', async () => {
    const { interleaveByHeight, photoMarker } = await import('./readTrayFile.js')
    expect(photoMarker(1, 182)).toBe('[PHOTO 1 — large]')
    expect(interleaveByHeight([{ y: 500, text: 'A' }], [{ top: 100, text: '[PHOTO 1]' }])).toEqual(['A', '[PHOTO 1]'])
  })
})

