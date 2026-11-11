import { describe, it, expect, vi } from 'vitest'
import { shareFiles, shareReady, trayListText } from './share.js'

const fetchImpl = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'application/pdf' }) }))

describe('sharing a kit document', () => {
  it("shares the file itself through the phone's share sheet", async () => {
    const nav = { canShare: () => true, share: vi.fn(async () => {}) }
    expect(await shareFiles([{ url: 'u', name: 'Agreement.pdf' }], { title: 'Kit' }, { nav, fetchImpl })).toBe('shared')
    expect(nav.share.mock.calls[0][0].files[0].name).toBe('Agreement.pdf')
  })

  it('asks for one more tap when the phone refuses a share that came too late after the first', async () => {
    const refused = Object.assign(new Error('no'), { name: 'NotAllowedError' })
    const nav = { canShare: () => true, share: vi.fn().mockRejectedValueOnce(refused).mockResolvedValueOnce() }
    expect(await shareFiles([{ url: 'u', name: 'List.pdf' }], {}, { nav, fetchImpl })).toBe('needs-tap')
    expect(await shareReady({ nav })).toBe('shared')
  })

  it('writes a tray list as text when no original was kept', () => {
    expect(trayListText('Diplomat', { trays: [{ name: 'Tray 1', lines: [{ code: 'X-1', description: 'AWL', qty: 2 }] }] }))
      .toBe('Diplomat — tray list\n\nTray 1\n  2 × X-1 — AWL')
  })
})
