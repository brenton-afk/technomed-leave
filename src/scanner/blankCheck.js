// ─── A page that came out black is never filed (Toni, 20 Nov 2026) ──────────
// "The signus delivery note has come through as all black." Two resupplies
// were filed with their second page a 2400-pixel sheet of pure black (every
// pixel 0): the sharper filing copy of a page whose reading copy was fine.
// An iPhone that has run out of canvas memory hands back an empty canvas
// without saying so, and an empty canvas encodes as black. So every copy is
// looked at before it is used, and each canvas is let go once encoded so the
// next page has the memory.

/** True when a canvas holds nothing: transparent, or uniformly black. */
export function looksBlank(canvas) {
  try {
    if (!canvas || !canvas.width || !canvas.height) return true
    const probe = document.createElement('canvas')
    probe.width = 24
    probe.height = 24
    const ctx = probe.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false // nowhere to look (tests): assume it is fine
    ctx.drawImage(canvas, 0, 0, 24, 24)
    const d = ctx.getImageData(0, 0, 24, 24).data
    let brightest = 0
    let opaque = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 10) opaque++
      brightest = Math.max(brightest, d[i], d[i + 1], d[i + 2])
    }
    return opaque === 0 || brightest < 16
  } catch {
    return false
  }
}

/** Give a canvas's memory back (iOS keeps it until the canvas is emptied). */
export function release(canvas) {
  try { if (canvas) { canvas.width = 0; canvas.height = 0 } } catch { /* nothing to free */ }
}
