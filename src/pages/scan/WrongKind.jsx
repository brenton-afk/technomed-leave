import React from 'react'
import { Banner, Button } from '../../design/Shell.jsx'
import { space } from '../../design/tokens.js'

// ─── The wrong scanner for this paper (Brent, 18 Nov 2026) ───────────────────
// "Sometimes people are scanning their usage with the resupply scanner and
// it's causing issues." Both readers say what the paper is; when it is the
// other kind, this asks before anything is matched, filed or sent. Moving
// across carries the same pages — nobody scans twice.

const WORDS = {
  usage: {
    title: 'This looks like a usage form, not a resupply',
    detail: 'It reads as the hospital’s record of implants used in a case. A usage form goes to the distributors from the Usage scanner.',
    move: 'Read it as a usage',
    stay: 'It is a resupply — carry on'
  },
  resupply: {
    title: 'This looks like a resupply docket, not a usage form',
    detail: 'It reads as a supplier’s delivery docket or packing slip. Dockets are matched to the usage they replace in the Resupply scanner.',
    move: 'Read it as a resupply',
    stay: 'It is a usage form — carry on'
  }
}

/** `looksLike` is what the reader says the paper is: 'usage' or 'resupply'. */
export default function WrongKind({ looksLike, onMove, onStay }) {
  const w = WORDS[looksLike]
  if (!w) return null
  return (
    <div data-wrong-kind={looksLike} style={{ display: 'grid', gap: space.md }}>
      <Banner tone="warning"><strong>{w.title}.</strong> {w.detail}</Banner>
      <Button onClick={onMove}>{w.move}</Button>
      <Button variant="secondary" onClick={onStay}>{w.stay}</Button>
    </div>
  )
}
