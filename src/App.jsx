import React, { useState, useEffect, useCallback } from 'react'
import PinScreen from './pages/PinScreen.jsx'
import LockScreen from './pages/LockScreen.jsx'
import { browserSupportsWebAuthn } from '@simplewebauthn/browser'
import LeaveForm from './pages/LeaveForm.jsx'
import Success from './pages/Success.jsx'
import KitRoom from './pages/KitRoom.jsx'
import Projects from './pages/Projects.jsx'
import UsageScan from './pages/UsageScan.jsx'
import Cases from './pages/Cases.jsx'
import TheatreGuides from './pages/TheatreGuides.jsx'
import Chat from './pages/Chat.jsx'
import Timesheets from './pages/Timesheets.jsx'
import AdminPortal from './pages/admin/AdminPortal.jsx'
import FaceIdSetup from './pages/FaceIdSetup.jsx'
import { rememberUser } from './lastUser.js'
import FileBrowser from './pages/FileBrowser.jsx'
import PatientHistory from './pages/PatientHistory.jsx'
import { KitHub, MeHub, ComingSoonSection } from './pages/Hubs.jsx'
import PromptBanner from './pages/PromptBanner.jsx'
import { colour, text, font, radius } from './design/tokens.js'
import { useIsDesktop } from './design/viewport.js'
import {
  IconScan, IconCases, IconKit, IconMe, IconChat,
  IconStock, IconPayslip, IconLock, IconBack
} from './design/icons.jsx'
import { useNewBuild } from './appVersion.js'
import { isFrozenCopy, canonicalUrl } from './canonicalHost.js'
import { useUnread } from './chat/unread.js'

// ─── Navigation ───────────────────────────────────────────────────────────────
// Five destinations, because a bottom bar stops being scannable past about five.
// The previous eight were each one tap away but none of them stood out, which is
// the failure mode this replaces.
//
// Depth is {tab, sub}: a tab shows its hub, a sub shows one screen with a back
// arrow. Still state rather than routes — the app has never had a router, and
// adding one for two levels would not earn its keep.

const TABS = [
  { id: 'cases', label: 'Cases', Icon: IconCases },
  // Named for what it does on the device you are on. A laptop cannot scan a
  // usage form and never will — it gets the filed ones instead, which is the
  // half somebody at a desk wants.
  { id: 'scan', label: 'Scan', desktopLabel: 'Usage', Icon: IconScan },
  // Messages earns a tab now that it can reach a phone. It spent its first
  // weeks three taps deep inside Kit, next to stock and resources, which is
  // nowhere to put the thing meant to replace the WhatsApp group — nobody goes
  // looking in a kit menu for a conversation.
  { id: 'messages', label: 'Messages', Icon: IconChat },
  { id: 'kit', label: 'Kit', Icon: IconKit },
  { id: 'me', label: 'Me', Icon: IconMe }
  // Admin is deliberately not here any more. Five is the limit a bottom bar
  // stays scannable at, an admin is one of two people, and Admin has a card at
  // the top of Me — whereas Messages is for all nine, several times a day.
]

// Matches the server-side session TTL in api/_auth.js.
// Screens built on the new Header draw their own back arrow. Everything else
// predates it and gets a floating control instead, which avoids rewriting six
// working pages just to add one button.
const SELF_BACK = new Set([
  'resources', 'guides', 'messages', 'stock', 'usagefiles', 'patient', 'security', 'payslips',
  // Migrated to design/Shell.jsx's Header, so they draw their own.
  'kitroom', 'projects', 'timesheets', 'leave'
])

// Matches the server-side session TTL in api/_auth.js.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// How long the admin portal stays open once unlocked. Long enough to do a
// round of approvals without being asked again, short enough that a laptop
// left on a bench is not an open payroll screen an hour later.
const ADMIN_UNLOCK_MS = 15 * 60 * 1000

// ─── The step-up into the admin portal ───────────────────────────────────────
// Off, asked for on 5 October 2026: "get rid of the log in for the admin
// portal for now, it's really annoying."
//
// Worth being exact about what this does and does not change, because the
// name makes it sound larger than it is.
//
// It does NOT open the admin portal to the team. Who may read or change
// anything in there is decided by requireAdmin() in api/_auth.js, which
// re-reads isAdmin from the roster on every request and does not care what
// the browser believes. Somebody who is not an admin gets a 403 whether this
// is on or off, and the data never reaches their device.
//
// What it removes is the *second* prompt for the two people who already are
// admins. The remaining control for them is the device lock — the phone's
// passcode or Face ID, the laptop's password — which is the same control
// standing in front of the rest of the app since the sign-in on open was
// dropped. The exposure it leaves is an unlocked, signed-in device belonging
// to Brent or Erin, in somebody else's hands.
//
// One flag, and everything behind it — the LockScreen, the 15-minute window,
// the unlock state — is left in place, so turning it back on is this line.
const ADMIN_STEP_UP = false

// localStorage, not sessionStorage. sessionStorage is emptied when the app is
// closed, and iOS closes an installed web app whenever it wants the memory —
// so the one-hour expiry was never what people were hitting. Every open was a
// fresh sign-in, which is why the app felt like it demanded a password to look
// at a case list and people went back to the Google calendar instead.
const STORE = 'tm_user'
const STAMP = 'tm_login_time'

function loadStoredSession() {
  const saved = localStorage.getItem(STORE)
  const loginTime = parseInt(localStorage.getItem(STAMP) || '0', 10)
  if (!saved || !loginTime) return null
  if (Date.now() - loginTime > SESSION_MAX_AGE_MS) return null
  try { return JSON.parse(saved) } catch { return null }
}

export default function App() {
  // Called here, above the early returns for the login and the success screens,
  // because a hook that runs on some renders and not others is not a hook.
  const desktop = useIsDesktop()
  // Whether a newer build has shipped since this tab was opened. Same reason for
  // being up here: the login screen is exactly where a stale tab tends to sit.
  const newBuild = useNewBuild()
  const [user, setUser] = useState(null)
  // A session read back from the device, not yet unlocked on this launch.
  // When the admin portal was last unlocked on this device. Everything else
  // opens straight away; this is the one place worth a check, because it holds
  // everybody's pay, everybody's PINs and the system settings.
  const [adminUnlockedAt, setAdminUnlockedAt] = useState(0)
  const [unlockingAdmin, setUnlockingAdmin] = useState(false)
  // The number on the Messages tab. Below the state it reads and above every
  // early return, which is the only place both rules are satisfied.
  const unread = useUnread(user?.token)
  const [nav, setNav] = useState({ tab: 'cases', sub: null })
  const [submitted, setSubmitted] = useState(null)

  useEffect(() => {
    const restored = loadStoredSession()
    if (!restored) { clearSession(); return }
    setUser(restored)
    // Straight in. No prompt.
    //
    // This used to ask for Face ID on every cold open, which is the thing
    // Brent kept reporting as "it makes me log in every time" — and he was
    // right that it buys nothing. The phone or laptop is already locked by
    // the operating system; a second check to look at a case list is a tax on
    // the ninety-nine opens where nothing is wrong.
    //
    // The session is still a session. Every endpoint still requires it, it
    // still expires, and it can still be revoked. What has gone is the local
    // prompt in front of it, which was never the thing protecting anything.
    //
    // The admin portal is different and still asks — see below. Step up where
    // the stakes are, rather than taxing every screen equally.
  }, [])

  // The stored login time is checked, not just written, so a session really does
  // expire after its hour.
  useEffect(() => {
    if (!user) return
    const timer = setInterval(() => { if (!loadStoredSession()) handleLogout() }, 60 * 1000)
    return () => clearInterval(timer)
  }, [user])

  function clearSession() {
    localStorage.removeItem(STORE)
    localStorage.removeItem(STAMP)
  }

  function handleLogin(userData) {
    setUser(userData)
    // Every route in — PIN, first-time setup, passkey — arrives here, so this is
    // the one place the device's person is recorded.
    rememberUser(userData.email)
    localStorage.setItem(STORE, JSON.stringify(userData))
    localStorage.setItem(STAMP, Date.now().toString())
    setNav({ tab: 'cases', sub: null })
  }

  function handleLogout() {
    const token = user?.token
    setUser(null)
    setNav({ tab: 'cases', sub: null })
    clearSession()
    if (token) {
      fetch('/api/auth/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout', token })
      }).catch(() => {})
    }
  }

  /** Opening the admin portal asks for Face ID, unless it did so recently. */
  const openAdmin = useCallback(() => {
    // Turned off for now — see ADMIN_STEP_UP. The server still refuses a
    // non-admin; this was the second ask for the two people who are.
    if (!ADMIN_STEP_UP) return true
    if (Date.now() - adminUnlockedAt < ADMIN_UNLOCK_MS) return true
    setUnlockingAdmin(true)
    return false
  }, [adminUnlockedAt])

  const navigate = useCallback(target => {
    // Going anywhere clears the leave confirmation. Without this it shows in
    // place of whatever tab you tapped, which is the trapped screen again
    // wearing a different hat.
    setSubmitted(null)
    const next = typeof target === 'string' ? { tab: target, sub: null } : { sub: null, ...target }
    // Asked for on the way in rather than inside, so the portal never renders
    // behind the prompt.
    if (next.tab === 'admin' && !openAdmin()) return
    setNav(next)
    window.scrollTo?.(0, 0)
  }, [openAdmin])

  const back = useCallback(() => setNav(n => ({ tab: n.tab, sub: null })), [])

  if (!user) return <PinScreen onLogin={handleLogin} />

  // The administration side, and only it. Face ID or the PIN, once, and then
  // it stays open for a while — a check on every tap inside the portal would
  // be the same mistake one level down.
  if (unlockingAdmin) {
    return (
      <LockScreen
        user={user}
        reason="The admin portal holds everybody's pay and PINs."
        onUnlock={() => { setAdminUnlockedAt(Date.now()); setUnlockingAdmin(false) }}
        // Dismiss, not sign out.
        //
        // This used to call handleLogout(), and that is the whole reason the
        // admin prompt was reported as "really annoying" and as "it's still
        // asking for a passcode" after the prompt itself was turned off. The
        // button offering an alternative to Face ID destroyed the session
        // instead: tap it, and the thirty-day sign-in was gone, the app
        // dropped to the PIN screen, and the PIN screen auto-fires the passkey
        // — which is the iOS passcode sheet. Every reach for the gentler
        // option cost a full sign-in.
        //
        // Unreachable today with ADMIN_STEP_UP off, and fixed anyway: a trap
        // left behind a flag is a trap waiting for whoever flips it back.
        onUsePin={() => setUnlockingAdmin(false)}
        onCancel={() => { setUnlockingAdmin(false); navigate({ tab: 'cases' }) }} />
    )
  }

  const tabs = TABS.filter(t => !t.adminOnly || user.isAdmin)

  function renderContent() {
    // Shown in place of whatever tab you were on, rather than above the whole
    // shell. It used to be an early return, which took the bottom navigation
    // off the screen with it — so after filing a week's leave the only way
    // out was one button, and that button was mislabelled. The tabs are the
    // way out of everything else in the app; there is no reason for this to
    // be the exception.
    if (submitted) {
      return (
        <Success
          form={submitted}
          onDone={() => { setSubmitted(null); navigate({ tab: 'me' }) }}
          onAnother={() => { setSubmitted(null); navigate({ tab: 'me', sub: 'leave' }) }} />
      )
    }

    const { tab, sub } = renderTarget(nav, user)

    if (tab === 'cases') {
      // Both readings of the bookings calendar, and the switch between them.
      // The calendar view used to sit in the Kit tab, which is neither where
      // anyone looked for it nor anything to do with kit.
      return (
        <>
          <FaceIdSetup user={user} />
          <Cases user={user} promptBanner={<PromptBanner user={user} onNavigate={navigate} />} />
        </>
      )
    }

    if (tab === 'scan') return <UsageScan user={user} />

    if (tab === 'messages') return <Chat user={user} onRead={unread.refresh} />

    if (tab === 'kit') {
      switch (sub) {
        case 'kitroom': return <KitRoom user={user} onBack={back} />
        case 'projects': return <Projects user={user} onBack={back} />
        case 'resources':
          return <FileBrowser user={user} root="resources" eyebrow="Kit and reference" title="Resources" onBack={back} />
        case 'guides':
          return <TheatreGuides user={user} onBack={back} />
        case 'stock':
          return <ComingSoonSection eyebrow="Kit and stock" title="Stock take" icon={IconStock} onBack={back}
            detail="Counting and reconciling consignment stock will live here. The section exists so the structure is right — tell me how you count today and I'll build it." />
        default: return <KitHub user={user} onNavigate={navigate} />
      }
    }

    if (tab === 'me') {
      switch (sub) {
        case 'timesheets': return <Timesheets user={user} onBack={back} />
        case 'leave': return <LeaveForm user={user} onSuccess={setSubmitted} onBack={back} />
        case 'usagefiles':
          return <FileBrowser user={user} root="usage" eyebrow="Your files" title="Filed usage" onBack={back} />
        case 'patient':
          return <PatientHistory user={user} onBack={back} />
        case 'security':
          return <ComingSoonSection eyebrow="Account" title="Sign-in & Face ID" icon={IconLock} onBack={back}
            detail="Face ID is offered on the case plan the first time you sign in on a device. Managing enrolled devices from here is next." />
        case 'payslips':
          return <ComingSoonSection eyebrow="Pay" title="Payslips" icon={IconPayslip} onBack={back}
            detail="Pay run history appears here once Xero payslip access is enabled." />
        default: return <MeHub user={user} onNavigate={navigate} onLogout={handleLogout} />
      }
    }

    if (tab === 'admin') return <AdminPortal user={user} />

    return null
  }

  return (
    <div className="tm-shell" style={{ background: colour.canvas, fontFamily: font }}>
      {nav.sub && !SELF_BACK.has(nav.sub) && (
        <button onClick={back} aria-label="Back"
          style={{
            position: 'fixed', top: 'calc(14px + env(safe-area-inset-top, 0px))', left: 14, zIndex: 120,
            width: 36, height: 36, borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.14)',
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', backdropFilter: 'blur(6px)'
          }}>
          <IconBack size={19} />
        </button>
      )}

      {/* A build shipped while this tab was open. It never reloads on its own —
          somebody halfway through a booking should not have the page taken out
          from under them — so it offers and they choose. See appVersion.js. */}
      {/* A deployment URL keeps working and never updates. It is
          indistinguishable from the real app until somebody notices a feature
          is missing, which is how one person could see a rep's name on a case
          and another could not. Said once, plainly, with the way out. */}
      {isFrozenCopy() && (
        <a href={canonicalUrl()}
          style={{
            position: 'fixed', zIndex: 140, left: 0, right: 0,
            top: 'env(safe-area-inset-top, 0px)',
            display: 'block', textAlign: 'center', textDecoration: 'none',
            padding: '10px 16px', background: colour.warning, color: 'white',
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700
          }}>
          This is an old copy of the app — tap to open the current one
        </a>
      )}

      {newBuild && (
        <button onClick={() => window.location.reload()}
          style={{
            position: 'fixed', zIndex: 130, left: '50%', transform: 'translateX(-50%)',
            top: 'calc(10px + env(safe-area-inset-top, 0px))',
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            padding: '8px 16px', minHeight: 40, borderRadius: 999,
            border: 'none', background: colour.accent, color: 'white',
            boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
            fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700
          }}>
          Update available — tap to reload
        </button>
      )}

      {/* The one scrolling region. The tab bar is a sibling below it rather than
          something this has to leave room for, so there is no clearance to keep
          in step with the bar's height. */}
      <div className="tm-scroll">{renderContent()}</div>

      {/* Not `position: fixed`. It is the last child of a column that is exactly
          the height of the viewport, so it is pinned by the layout itself — which
          nothing can scroll away and no ancestor can reparent. The blur can stay
          because there is no longer anything passing underneath it. */}
      <nav aria-label="Main"
        style={desktop ? {
          // The border and the safe-area padding are inline, so the stylesheet
          // cannot override them — an inline style always wins. Everything the
          // desktop needs differently has to be decided here too.
          flexShrink: 0, background: colour.surface,
          display: 'flex', zIndex: 100
        } : {
          flexShrink: 0,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          borderTop: `1px solid ${colour.line}`, display: 'flex', zIndex: 100,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}>

        {/* The column needs a head, or it reads as five buttons floating in a
            margin. A phone has the app's name in the header of every screen and
            no room to spare; a sidebar has the room and needs the anchor. */}
        {desktop && (
          <div style={{ padding: `4px 14px 14px`, borderBottom: `1px solid ${colour.line}`, marginBottom: 8 }}>
            <div style={{ ...text('bodyStrong'), color: colour.navy }}>TechnoMed</div>
            <div style={{ ...text('caption'), color: colour.inkFaint }}>
              {user.name?.split(' ')[0] || 'Staff portal'}
            </div>
          </div>
        )}
        {/* On a phone these are five equal columns along the bottom. On a
            desktop the same buttons become rows down a sidebar: icon beside
            label, left-aligned, with the active one filled rather than only
            coloured — a tint reads as a hover state when the pointer is a
            mouse, and the row needs to say which page you are on without it.

            Done here rather than in CSS because these styles are inline, and an
            inline style cannot be overridden by a media query. */}
        {tabs.map(({ id, label, desktopLabel, Icon }) => {
          const active = nav.tab === id
          // Cleared by opening the tab, which is what marks the channel read.
          const waiting = id === 'messages' && !active ? unread.count : 0
          return (
            <button key={id} onClick={() => navigate({ tab: id })}
              aria-current={active ? 'page' : undefined}
              style={desktop ? {
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 14px', borderRadius: radius.control,
                background: active ? colour.accentSoft : 'transparent',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                color: active ? colour.accentDeep : colour.inkMuted, font: 'inherit'
              } : {
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 4, padding: '9px 2px 8px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: active ? colour.accent : colour.inkFainter, font: 'inherit'
              }}>
              {/* Weight, not fill, marks the active tab — it keeps the set
                  looking like one family instead of two icon styles. */}
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <Icon size={desktop ? 20 : 23} strokeWidth={active ? 2.1 : 1.6} />
                {waiting > 0 && (
                  <span
                    aria-label={`${waiting} unread message${waiting === 1 ? '' : 's'}`}
                    style={{
                      position: 'absolute', top: -5, left: '55%',
                      minWidth: 16, height: 16, padding: '0 4px', boxSizing: 'border-box',
                      borderRadius: 999, background: colour.danger, color: 'white',
                      ...text('micro'), fontWeight: 700, lineHeight: '16px',
                      textAlign: 'center'
                    }}>
                    {waiting > 9 ? '9+' : waiting}
                  </span>
                )}
              </span>
              <span style={{
                ...text(desktop ? 'bodyStrong' : 'micro'),
                letterSpacing: '0.1px', textTransform: 'none',
                fontWeight: active ? 700 : desktop ? 500 : 500
              }}>
                {(desktop && desktopLabel) || label}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

// A non-admin who somehow lands on the admin tab falls back to Today rather
// than a blank screen.
function renderTarget(nav, user) {
  if (nav.tab === 'admin' && !user.isAdmin) return { tab: 'cases', sub: null }
  return nav
}
