// ─── The covering for one scan, held by the scan screen (Brent, 26 Nov 2026) ─
// The usage and resupply screens both use this: when a reading comes back it
// paints the patient label out of every page, keeps the photographs as taken
// only here in memory (so a covering can be moved and painted again), and
// forgets them when the scan is finished or abandoned (`clear`).

import { useCallback, useEffect, useRef, useState } from 'react'
import { coverPages } from './redact.js'
import { pagesToCheck, REDACTION_VERSION } from './redactRules.js'

export function useRedaction() {
  const originals = useRef(null)
  const [redaction, setRedaction] = useState(null)
  const [label, setLabel] = useState({})
  const [checked, setChecked] = useState(false)

  const clear = useCallback(() => {
    originals.current = null
    setRedaction(null); setLabel({}); setChecked(false)
  }, [])
  // Wiped with the screen, too.
  useEffect(() => () => { originals.current = null }, [])

  /** A reading's covering, painted into the pages. Throws if it cannot be. */
  const begin = useCallback(async (pages, given, surgeon) => {
    if (!given?.pages) return pages
    const kept = pages.map(p => ({ ...p }))
    const covered = await coverPages(kept, given, given.label || {}, surgeon)
    originals.current = kept
    setRedaction({ pages: given.pages })
    setLabel(given.label || {})
    setChecked(false)
    return covered
  }, [])

  /** Painted again from the photographs, with the latest boxes and details. */
  const repaint = useCallback(async (pages, surgeon, { boxesFor, nextLabel } = {}) => {
    if (!originals.current || !redaction) return pages
    const next = boxesFor
      ? { pages: redaction.pages.map((p, i) => (i === boxesFor.index ? { ...p, boxes: boxesFor.boxes } : p)) }
      : redaction
    const lbl = nextLabel || label
    const covered = await coverPages(originals.current, next, lbl, surgeon)
    if (boxesFor) setRedaction(next)
    return covered
  }, [redaction, label])

  const unsure = redaction ? pagesToCheck(redaction) : []
  return {
    redaction,
    label,
    setLabel,
    checked,
    setChecked,
    originals: originals.current,
    begin,
    repaint,
    clear,
    /** Filing waits for a person to look at a page nothing was found on. */
    blocked: unsure.length > 0 && !checked,
    /** What the server needs to see before it files or sends any page. */
    flagFor: pages => (pages.length && pages.every(p => p.redacted) ? { redaction: REDACTION_VERSION } : {}),
    /** The photographs as taken, for reading again as another kind of paper. */
    unredacted: pages => (originals.current && originals.current.length === pages.length ? originals.current : pages)
  }
}
