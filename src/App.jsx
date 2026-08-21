import React, { useState, useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import PinScreen from './pages/PinScreen.jsx'
import LeaveForm from './pages/LeaveForm.jsx'
import TodayView from './pages/TodayView.jsx'
import AdminPortal from './pages/admin/AdminPortal.jsx'
import ComingSoon from './pages/ComingSoon.jsx'
import KitRoom from './pages/KitRoom.jsx'
import Success from './pages/Success.jsx'
import Projects from './pages/Projects.jsx'
import UsageScan from './pages/UsageScan.jsx'

const TABS = [
  { id: 'home', label: 'Today', icon: '📅' },
  { id: 'leave', label: 'Leave', icon: '🏖' },
  { id: 'payroll', label: 'Payroll', icon: '💰' },
  { id: 'kitroom', label: 'Kit Room', icon: '🔧' },
  { id: 'usage', label: 'Usage', icon: '📷' },
  { id: 'projects', label: 'Projects', icon: '📋' },
  { id: 'admin', label: 'Admin', icon: '⚙️' },
  { id: 'logout', label: 'Log out', icon: '🚪' }
]

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
  const [activeTab, setActiveTab] = useState('home')
  const [submitted, setSubmitted] = useState(false)
  const [submittedForm, setSubmittedForm] = useState(null)

  useEffect(() => {
    const restored = loadStoredSession()
    if (restored) setUser(restored)
    else clearSession()
  }, [])

  // The stored login time was previously written but never checked, so sessions
  // outlived their intended hour. Expire them on restore and while open.
  useEffect(() => {
    if (!user) return
    const timer = setInterval(() => {
      if (!loadStoredSession()) handleLogout()
    }, 60 * 1000)
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
  }

  function handleLogout() {
    const token = user?.token
    setUser(null)
    setActiveTab('home')
    clearSession()
    if (token) {
      fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout', token })
      }).catch(() => {})
    }
  }

  function handleSuccess(form) {
    setSubmittedForm(form)
    setSubmitted(true)
  }

  function handleReset() {
    setSubmitted(false)
    setSubmittedForm(null)
  }

  if (!user) return <BrowserRouter><PinScreen onLogin={handleLogin} /></BrowserRouter>

  if (submitted) return <BrowserRouter><Success form={submittedForm} onReset={handleReset} /></BrowserRouter>

  function renderContent() {
    switch (activeTab) {
      case 'home': return <TodayView user={user} />
      case 'leave': return <LeaveForm user={user} onSuccess={handleSuccess} />
      case 'payroll': return <ComingSoon title="Payroll" subtitle="Timesheets and pay run submission coming soon" icon="💰" />
      case 'kitroom': return <KitRoom user={user} />
      case 'usage': return <UsageScan user={user} />
      case 'projects': return <Projects user={user} />
      case 'logout': return null
      case 'admin':
        if (user.isAdmin) return <AdminPortal user={user} />
        return <ComingSoon title="Admin" subtitle="You do not have admin access. Please contact Brenton or Erin." icon="🔒" isLocked />
      default: return null
    }
  }

  return (
    <BrowserRouter>
      <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', background:'#f0f3f7', fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif', width:'100%' }}>
        <div style={{ flex:1, overflowY:'auto', paddingBottom:'70px' }}>
          {renderContent()}
        </div>
        <div style={{ position:'fixed', bottom:0, left:0, right:0, width:'100%', background:'white', borderTop:'0.5px solid rgba(26,43,74,0.12)', display:'flex', zIndex:100, boxShadow:'0 -2px 12px rgba(26,43,74,0.08)' }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <button key={tab.id} onClick={() => { if (tab.id === 'logout') { if (window.confirm('Log out of TechnoMed Portal?')) handleLogout() } else setActiveTab(tab.id) }}
                style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'8px 4px 12px', background:'transparent', border:'none', cursor:'pointer', gap:'3px', position:'relative' }}>
                {active && <div style={{ position:'absolute', top:0, left:'50%', transform:'translateX(-50%)', width:'24px', height:'3px', background:'#2ab5a0', borderRadius:'0 0 3px 3px' }} />}
                <span style={{ fontSize:'20px', lineHeight:1 }}>{tab.icon}</span>
                <span style={{ fontSize:'10px', fontWeight: active ? '700' : '400', color: active ? '#042746' : '#9aabb8' }}>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </BrowserRouter>
  )
}
