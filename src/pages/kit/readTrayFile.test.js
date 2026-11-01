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
