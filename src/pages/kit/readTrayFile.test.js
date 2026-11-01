import { describe, it, expect, vi } from 'vitest'

// "Still uploading….." — the phone unpacks a tray list and sends only what
// needs reading. Made-up contents only.

vi.mock('mammoth/mammoth.browser.js', () => ({
  default: { extractRawText: vi.fn(async () => ({ value: 'TRAY 1\nX-1 AWL 1' })) }
}))

describe('what the phone sends', () => {
  it('sends a Word document as its text, not the file', async () => {
    const { trayFilePayload } = await import('./readTrayFile.js')
    const file = new File([new Uint8Array(5_000_000)], 'Shoreline Master.docx')
    file.arrayBuffer = async () => new ArrayBuffer(8)
    const payload = await trayFilePayload(file)
    expect(payload).toEqual({ text: 'TRAY 1\nX-1 AWL 1' })
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
