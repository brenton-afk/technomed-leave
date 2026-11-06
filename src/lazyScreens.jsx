import React, { lazy, Suspense } from 'react'
import { colour, text, space, radius } from './design/tokens.js'

// ─── Screens loaded when they are opened, not before ─────────────────────────
// "The portal not loading in the Calvary corridor and theatre 6." The app was
// one 720KB file (216KB gzipped) and nothing drew until all of it had arrived,
// so on one bar of signal the first thing anybody saw was a navy screen for
// most of a minute. The Cases tab is what people open the app for; the scanner,
// the admin portal, timesheets and the rest are now separate files fetched the
// first time they are opened.
//
// And then fetched anyway, quietly, once the app is up — see prefetchScreens.
// The service worker keeps whatever has been fetched, so a screen opened for
// the first time in a dead spot still opens, as long as the app had a moment
// online before. Splitting without the prefetch would have traded a slow start
// for screens that cannot open offline, which is the wrong way round.

const loaders = {
  LeaveForm: () => import('./pages/LeaveForm.jsx'),
  KitRoom: () => import('./pages/KitRoom.jsx'),
  Projects: () => import('./pages/Projects.jsx'),
  TeamLeader: () => import('./pages/TeamLeader.jsx'),
  UsageScan: () => import('./pages/UsageScan.jsx'),
  ScanTab: () => import('./pages/ScanTab.jsx'),
  TheatreGuides: () => import('./pages/TheatreGuides.jsx'),
  Chat: () => import('./pages/Chat.jsx'),
  Timesheets: () => import('./pages/Timesheets.jsx'),
  AdminPortal: () => import('./pages/admin/AdminPortal.jsx'),
  FileBrowser: () => import('./pages/FileBrowser.jsx'),
  PatientHistory: () => import('./pages/PatientHistory.jsx'),
  Notifications: () => import('./pages/Notifications.jsx')
}

export const Screens = Object.fromEntries(
  Object.entries(loaders).map(([name, load]) => [name, lazy(load)]))

/** Fetches every screen in the background, once, when the browser is idle. */
export function prefetchScreens() {
  const run = () => Object.values(loaders).forEach(load => load().catch(() => {}))
  if (typeof window === 'undefined') return
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 8000 })
  else setTimeout(run, 3000)
}

/**
 * A screen that could not be fetched says so, with a way to try again.
 *
 * Without this a failed chunk is an exception in render, and React's answer to
 * an exception in render is a white screen — the exact symptom being fixed.
 */
export class ScreenBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidUpdate(prev) {
    // A different screen gets a fresh chance.
    if (this.state.failed && prev.screenKey !== this.props.screenKey) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" style={{ padding: space.lg, textAlign: 'center' }}>
        <div style={{ ...text('bodyStrong'), color: colour.ink }}>
          This screen needs a connection to open the first time.
        </div>
        <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: space.xs }}>
          The signal here may be weak. The Cases tab still works.
        </div>
        <button onClick={() => window.location.reload()} style={{
          marginTop: space.md, padding: `${space.sm}px ${space.lg}px`, cursor: 'pointer',
          ...text('bodyStrong'), color: 'white', background: colour.accent,
          border: 'none', borderRadius: radius.control
        }}>Try again</button>
      </div>
    )
  }
}

export function ScreenLoading() {
  return (
    <div role="status" style={{ ...text('caption'), color: colour.inkFaint, textAlign: 'center', padding: space.lg }}>
      Opening…
    </div>
  )
}

export function LazyScreen({ screenKey, children }) {
  return (
    <ScreenBoundary screenKey={screenKey}>
      <Suspense fallback={<ScreenLoading />}>{children}</Suspense>
    </ScreenBoundary>
  )
}
