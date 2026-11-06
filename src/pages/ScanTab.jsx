import React, { useState } from 'react'
import UsageScan from './UsageScan.jsx'
import ResupplyScan from './ResupplyScan.jsx'
import ScanKindSwitch, { readScanKind, saveScanKind } from './scan/ScanKind.jsx'

/** The Scan tab: one camera, and a choice of what the paper is (scan/ScanKind.jsx). */
export default function ScanTab({ user }) {
  const [kind, setKind] = useState(readScanKind)
  const choose = next => { saveScanKind(next); setKind(next) }
  return kind === 'resupply'
    ? <ResupplyScan user={user} kind={kind} onKind={choose} />
    : <UsageScan user={user} switcher={<ScanKindSwitch kind={kind} onChange={choose} />} />
}
