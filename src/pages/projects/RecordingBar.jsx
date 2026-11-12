import React, { Suspense, lazy, useEffect, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { onRecorder, recorderState, elapsed } from '../../projects/meetingRecorder.js'
import { useIsDesktop } from '../../design/viewport.js'
import { Overlay } from '../../design/Shell.jsx'

const LiveMeeting = lazy(() => import('./LiveMeeting.jsx'))

// ─── "● Recording 12:34" across the top of the portal (Brent, 12 Nov 2026) ───
// "We need to be able to put the recorder on and still navigate the pages on
// the computer." While the meeting recorder runs (projects/meetingRecorder.js)
// this bar sits above every screen, shows how long it has been going and any
// warning, and opens the meeting panel again. It draws nothing otherwise.
export default function RecordingBar({ user }) {
  const [rec, setRec] = useState(recorderState())
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState(false)
  const desktop = useIsDesktop()
  useEffect(() => onRecorder(setRec), [])
  useEffect(() => {
    if (!rec.on) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [rec.on])
  if (!rec.on && !open) return null
  // A phone: a strip under the header, in the shell's column. A computer lays
  // the shell out as a row, so there it floats top right instead.
  const wrap = el => (desktop
    ? <Overlay><div style={{ position: 'fixed', top: 12, right: 16, zIndex: 3400, maxWidth: 420 }}>{el}</div></Overlay>
    : el)
  return (
    <>
      {rec.on && wrap(
        <div role="status" data-recording-bar style={{
          display: 'flex', alignItems: 'center', gap: space.sm, padding: `6px ${space.md}px`,
          background: rec.warning ? colour.warningSoft : colour.dangerSoft, border: `1px solid ${rec.warning ? colour.warningLine : colour.dangerLine}`,
          ...(desktop
            ? { borderRadius: radius.pill, boxShadow: '0 6px 20px rgba(4,39,70,0.18)' }
            : { flexShrink: 0, borderWidth: '0 0 1px 0' })
        }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: colour.danger, flexShrink: 0 }} />
          <span style={{ ...text('caption'), fontWeight: 700, color: rec.warning ? colour.warning : colour.danger, flex: 1, minWidth: 0 }}>
            {rec.warning || `Recording the meeting · ${elapsed(rec.startedAt, now)}`}
          </span>
          <button type="button" onClick={() => setOpen(true)}
            style={{ ...text('caption'), fontWeight: 700, minHeight: 32, padding: `0 ${space.sm}px`, borderRadius: radius.pill, border: 'none', background: colour.danger, color: colour.surface, cursor: 'pointer' }}>
            Open meeting
          </button>
        </div>
      )}
      {open && (
        <Suspense fallback={null}>
          <LiveMeeting user={user} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
