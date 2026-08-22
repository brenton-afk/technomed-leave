import React, { useState, useEffect, useCallback } from 'react'
import PinScreen from './pages/PinScreen.jsx'
import TodayFeed from './pages/TodayFeed.jsx'
import LeaveForm from './pages/LeaveForm.jsx'
import Success from './pages/Success.jsx'
import TodayView from './pages/TodayView.jsx'
import KitRoom from './pages/KitRoom.jsx'
import Projects from './pages/Projects.jsx'
import UsageScan from './pages/UsageScan.jsx'
import ClinicalPlan from './pages/ClinicalPlan.jsx'
import Timesheets from './pages/Timesheets.jsx'
import AdminPortal from './pages/admin/AdminPortal.jsx'
import FaceIdSetup from './pages/FaceIdSetup.jsx'
import FileBrowser from './pages/FileBrowser.jsx'
import { CasesHub, MeHub, ComingSoonSection } from './pages/Hubs.jsx'
import { colour, text, font } from './design/tokens.js'
import {
  IconToday, IconScan, IconCases, IconMe, IconAdmin,
  IconStock, IconPayslip, IconLock, IconBack
} from './design/icons.jsx'

// ─── Navigation ───────────────────────────────────────────────────────────────
// Five destinations, because a bottom bar stops being scannable past about five.
// The previous eight were each one tap away but none of them stood out, which is
// the failure mode this replaces.
//
// Depth is {tab, sub}: a tab shows its hub, a sub shows one screen with a back
// arrow. Still state rather than routes — the app has never had a router, and
// adding one for two levels would not earn its keep.

const TABS = [
  { id: 'today', label: 'Today', Icon: IconToday },
  { id: 'scan', label: 'Scan', Icon: IconScan },
  { id: 'cases', label: 'Cases', Icon: IconCases },
  { id: 'me', label: 'Me', Icon: IconMe },
  { id: 'admin', label: 'Admin', Icon: IconAdmin, adminOnly: true }
]

// Matches the server-side session TTL in api/_auth.js.
// Screens built on the new Header draw their own back arrow. Everything else
// predates it and gets a floating control instead, which avoids rewriting six
// working pages just to add one button.
const SELF_BACK = new Set(['resources', 'stock', 'usagefiles', 'security', 'payslips'])

// Matches the server-side session TTL in api/_auth.js.
const SESSION_MAX_AGE_MS = 60 * 60 * 1000

function loadStoredSession() {
  const saved = sessionStorage.getItem('tm_user')
  const loginTime = parseInt(sessionStorage.getItem('tm_login_time') || '0', 10)
  if (!saved || !loginTime) return null
  if (Date.now() - loginTime > SESSION_MAX_AGE_MS) return null
  try { return JSON.parse(saved) } catch { return null }
}

export default function App() {
  const [user, setUser] = useState(null)
  const [nav, setNav] = useState({ tab: 'today', sub: null })
  const [submitted, setSubmitted] = useState(null)

  useEffect(() => {
    const restored = loadStoredSession()
    if (restored) setUser(restored)
    else clearSession()
  }, [])

  // The stored login time is checked, not just written, so a session really does
  // expire after its hour.
  useEffect(() => {
    if (!user) return
    const timer = setInterval(() => { if (!loadStoredSession()) handleLogout() }, 60 * 1000)
    return () => clearInterval(timer)
  }, [user])

  function clearSession() {
    sessionStorage.removeItem('tm_user')
    sessionStorage.removeItem('tm_login_time')
  }

  function handleLogin(userData) {
    setUser(userData)
    sessionStorage.setItem('tm_user', JSON.stringify(userData))
    sessionStorage.setItem('tm_login_time', Date.now().toString())
    setNav({ tab: 'today', sub: null })
  }

  function handleLogout() {
    const token = user?.token
    setUser(null)
    setNav({ tab: 'today', sub: null })
    clearSession()
    if (token) {
      fetch('/api/auth/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout', token })
      }).catch(() => {})
    }
  }

  const navigate = useCallback(target => {
    setNav(typeof target === 'string' ? { tab: target, sub: null } : { sub: null, ...target })
    window.scrollTo?.(0, 0)
  }, [])

  const back = useCallback(() => setNav(n => ({ tab: n.tab, sub: null })), [])

  if (!user) return <PinScreen onLogin={handleLogin} />

  if (submitted) {
    return <Success form={submitted} onReset={() => { setSubmitted(null); navigate({ tab: 'today' }) }} />
  }

  const tabs = TABS.filter(t => !t.adminOnly || user.isAdmin)

  function renderContent() {
    const { tab, sub } = renderTarget(nav, user)

    if (tab === 'today') {
      return (
        <>
          <FaceIdSetup user={user} />
          <TodayFeed user={user} onNavigate={navigate} />
        </>
      )
    }

    if (tab === 'scan') return <UsageScan user={user} />

    if (tab === 'cases') {
      switch (sub) {
        case 'plan': return <ClinicalPlan user={user} />
        case 'calendar': return <TodayView user={user} />
        case 'kit': return <KitRoom user={user} />
        case 'projects': return <Projects user={user} />
        case 'resources':
          return <FileBrowser user={user} root="resources" eyebrow="Case support" title="Resources" onBack={back} />
        case 'stock':
          return <ComingSoonSection eyebrow="Case support" title="Stock take" icon={IconStock} onBack={back}
            detail="Counting and reconciling consignment stock will live here. The section exists so the structure is right — tell me how you count today and I'll build it." />
        default: return <CasesHub user={user} onNavigate={navigate} />
      }
    }

    if (tab === 'me') {
      switch (sub) {
        case 'timesheets': return <Timesheets user={user} />
        case 'leave': return <LeaveForm user={user} onSuccess={setSubmitted} />
        case 'usagefiles':
          return <FileBrowser user={user} root="usage" eyebrow="Your files" title="Filed usage" onBack={back} />
        case 'security':
          return <ComingSoonSection eyebrow="Account" title="Sign-in & Face ID" icon={IconLock} onBack={back}
            detail="Face ID is offered on the Today screen the first time you sign in on a device. Managing enrolled devices from here is next." />
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
    <div className="tm-shell" style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      background: colour.canvas, fontFamily: font
    }}>
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

      <div style={{ flex: 1, paddingBottom: 76 }}>{renderContent()}</div>

      <nav className="tm-fixed" aria-label="Main"
        style={{
          position: 'fixed', bottom: 0,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          borderTop: `1px solid ${colour.line}`, display: 'flex', zIndex: 100,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}>
        {tabs.map(({ id, label, Icon }) => {
          const active = nav.tab === id
          return (
            <button key={id} onClick={() => navigate({ tab: id })}
              aria-current={active ? 'page' : undefined}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 4, padding: '9px 2px 8px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: active ? colour.accent : colour.inkFainter, font: 'inherit'
              }}>
              {/* Weight, not fill, marks the active tab — it keeps the set
                  looking like one family instead of two icon styles. */}
              <Icon size={23} strokeWidth={active ? 2.1 : 1.6} />
              <span style={{
                ...text('micro'), letterSpacing: '0.1px', textTransform: 'none',
                fontWeight: active ? 700 : 500
              }}>
                {label}
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
  if (nav.tab === 'admin' && !user.isAdmin) return { tab: 'today', sub: null }
  return nav
}
