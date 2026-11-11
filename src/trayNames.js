// ─── Every tray keeps its own name (Aimee, 11 Nov 2026) ──────────────────────
// "It overrides them if you try to upload a second pdf and saves over." Saving
// adds to a kit's list, but trays were matched by name: two documents whose
// trays read the same ("Instrument Tray", "Tray 1") kept only the last, and
// its photo was filed over the first's. Now a tray replaces another only when
// it comes from the same document — an upload of the same file again. A same
// name from a different document, or twice in one upload, gets a number.

const key = name => String(name || '').trim().toLowerCase()

/**
 * Names for incoming trays, unique among themselves and against the trays the
 * kit keeps. `existing` is the saved list's trays (only when adding), each with
 * the `file` it came from.
 */
export function uniqueTrayNames(incoming = [], existing = []) {
  const taken = new Map(existing.map(t => [key(t.name), t.file || '']))
  const used = new Set()
  return incoming.map(t => {
    const base = String(t.name || '').trim() || 'Tray'
    let name = base
    let n = 1
    const clash = nm => used.has(key(nm))
      || (taken.has(key(nm)) && taken.get(key(nm)) !== (t.file || ''))
    while (clash(name)) name = `${base} (${++n})`
    used.add(key(name))
    return { ...t, name }
  })
}
