import React, { useState } from 'react'
import UsageScan from './UsageScan.jsx'
import ResupplyScan from './ResupplyScan.jsx'
import ScanKindSwitch, { readScanKind } from './scan/ScanKind.jsx'

/**
 * The Scan tab: one camera, and a choice of what the paper is (scan/ScanKind.jsx).
 *
 * Always opens on Usage (Brent, 18 Nov 2026: usage forms were being scanned
 * with the resupply scanner, which the phone had remembered from last time).
 * Resupply is chosen each time. And whichever is chosen, the reader says what
 * the paper actually is: the wrong one asks, and "Read it as …" carries the
 * same pages across (`carry`) and reads them there — no second scan.
 */
export default function ScanTab({ user }) {
  const [kind, setKind] = useState(readScanKind)
  const [carry, setCarry] = useState(null)   // { pages, n } — handed to the other scanner
  const choose = next => { setCarry(null); setKind(next) }
  const moveTo = next => pages => { setCarry({ pages, n: Date.now() }); setKind(next) }
  return kind === 'resupply'
    ? <ResupplyScan key={`r${carry?.n || ''}`} user={user} kind={kind} onKind={choose}
        initialPages={carry?.pages} onReadAsUsage={moveTo('usage')} />
    : <UsageScan key={`u${carry?.n || ''}`} user={user} switcher={<ScanKindSwitch kind={kind} onChange={choose} />}
        initialPages={carry?.pages} onReadAsResupply={moveTo('resupply')} />
}
