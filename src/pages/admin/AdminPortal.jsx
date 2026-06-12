import React, { useState, useEffect } from 'react'
import axios from 'axios'

const LEAVE_LABELS = {
  'ANNUAL_LEAVE': 'Annual Leave',
  'SICK': 'Personal / Sick Leave',
  'TOIL': 'Time Off In Lieu (TOIL)'
}

function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${months[parseInt(m)-1]} ${y}`
}

export default function AdminPortal() {
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [error, setError] = useState('')
  const [applications, setApplications] = useState({ pending: [], approved: [], declined: [] })
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('pending')
  const [actionLoading, setActionLoading] = useState(null)
  const [declineModal, setDeclineModal] = useState(null)
  const [declineReason, setDeclineReason] = useState('')

  async function login() {
    setError('')
    try {
      const res = await axios.get(`/api/admin/applications?password=${encodeURIComponent(password)}`)
      setApplications(res.data)
      setLoggedIn(true)
    } catch {
      setError('Incorrect password')
    }
  }

  async function fetchApplications() {
    setLoading(true)
    try {
      const res = await axios.get(`/api/admin/applications?password=${encodeURIComponent(password)}`)
      setApplications(res.data)
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  async function handleAction(id, action, reason = '') {
    setActionLoading(id + action)
    try {
      await axios.post('/api/admin/action', { id, action, password, declineReason: reason })
      await fetchApplications()
      setDeclineModal(null)
      setDeclineReason('')
    } catch (err) {
      alert(err.response?.data?.error || 'Action failed')
    }
    setActionLoading(null)
  }

  if (!loggedIn) {
    return (
      <div style={{ minHeight: '100vh', background: '#f0f3f7', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: 'white', borderRadius: 16, overflow: 'hidden', width: '100%', maxWidth: 400, boxShadow: '0 4px 24px rgba(26,43,74,0.12)' }}>
          <div style={{ background: '#042746', padding: '28px 28px 24px' }}>
            <img src="/logo.png" alt="TechnoMed" style={{ height: 44, width: 'auto', marginBottom: 6 }} />
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12 }}>Admin Portal</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'white' }}>Leave Management</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>Approve or decline leave applications</div>
          </div>
          <div style={{ padding: 28 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#042746', display: 'block', marginBottom: 6 }}>Admin password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && login()}
                placeholder="Enter password"
                style={{ width: '100%', padding: '12px 14px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 10, fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            {error && <div style={{ background: '#fdecea', color: '#c0392b', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{error}</div>}
            <button onClick={login} style={{ width: '100%', padding: 14, background: '#042746', color: 'white', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              Sign in →
            </button>
          </div>
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'pending', label: 'Pending', count: applications.pending?.length || 0 },
    { id: 'approved', label: 'Approved', count: applications.approved?.length || 0 },
    { id: 'declined', label: 'Declined', count: applications.declined?.length || 0 }
  ]

  const currentApps = applications[tab] || []

  return (
    <div style={{ minHeight: '100vh', background: '#f0f3f7', maxWidth: 680, margin: '0 auto' }}>
      <div style={{ background: '#042746', padding: '48px 20px 20px' }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height: 40, width: 'auto', marginBottom: 4 }} />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 12 }}>Admin Portal</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'white', marginBottom: 16 }}>Leave Applications</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: tab === t.id ? 'white' : 'rgba(255,255,255,0.12)', color: tab === t.id ? '#042746' : 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {t.label} {t.count > 0 && `(${t.count})`}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {currentApps.length === 0 && (
          <div style={{ background: 'white', borderRadius: 12, padding: 40, textAlign: 'center', color: '#6b7a8d', fontSize: 14 }}>
            No {tab} applications
          </div>
        )}
        {currentApps.map(app => (
          <div key={app.id} style={{ background: 'white', borderRadius: 12, marginBottom: 12, overflow: 'hidden', border: '1px solid rgba(26,43,74,0.08)' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(26,43,74,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#042746' }}>{app.name}</div>
                <div style={{ fontSize: 12, color: '#6b7a8d', marginTop: 2 }}>{app.division} · {LEAVE_LABELS[app.leaveType] || app.leaveType}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: app.status === 'pending' ? '#fff3cd' : app.status === 'approved' ? '#e6f4f2' : '#fdecea', color: app.status === 'pending' ? '#856404' : app.status === 'approved' ? '#1a7a6e' : '#c0392b' }}>
                {app.status === 'pending' ? '⏳ Pending' : app.status === 'approved' ? '✅ Approved' : '❌ Declined'}
              </span>
            </div>
            <div style={{ padding: '12px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                {[['First day', formatDate(app.startDate)], ['Last day', formatDate(app.endDate)], ['Return date', formatDate(app.returnDate)], ['Submitted', new Date(app.submittedAt).toLocaleDateString('en-AU')]].map(([label, value]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: '#6b7a8d', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#042746' }}>{value}</div>
                  </div>
                ))}
              </div>
              {app.reason && <div style={{ background: '#f8f9fc', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#042746' }}><span style={{ color: '#6b7a8d', fontSize: 11 }}>Reason: </span>{app.reason}</div>}
              {app.declineReason && <div style={{ background: '#fdecea', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#c0392b', marginTop: 8 }}><span style={{ fontSize: 11 }}>Declined: </span>{app.declineReason}</div>}
            </div>
            {app.status === 'pending' && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(26,43,74,0.06)', display: 'flex', gap: 10 }}>
                <button onClick={() => handleAction(app.id, 'approve')} disabled={actionLoading === app.id + 'approve'} style={{ flex: 2, padding: 12, background: '#1a7a6e', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  {actionLoading === app.id + 'approve' ? 'Approving…' : '✅ Approve'}
                </button>
                <button onClick={() => setDeclineModal(app)} style={{ flex: 1, padding: 12, background: '#fdecea', color: '#c0392b', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  ❌ Decline
                </button>
              </div>
            )}
          </div>
        ))}
        <button onClick={fetchApplications} style={{ width: '100%', padding: 12, background: 'transparent', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 8, fontSize: 13, color: '#6b7a8d', cursor: 'pointer', marginTop: 8 }}>
          Refresh
        </button>
      </div>
      {declineModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#042746', marginBottom: 6 }}>Decline application</div>
            <div style={{ fontSize: 13, color: '#6b7a8d', marginBottom: 16 }}>Declining leave for <strong>{declineModal.name}</strong>. Please provide a reason:</div>
            <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="e.g. Insufficient leave balance, operational requirements…" rows={3} style={{ width: '100%', padding: '12px 14px', border: '1px solid rgba(26,43,74,0.15)', borderRadius: 10, fontSize: 14, resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setDeclineModal(null); setDeclineReason('') }} style={{ flex: 1, padding: 12, background: '#f0f3f7', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: '#6b7a8d' }}>Cancel</button>
              <button onClick={() => handleAction(declineModal.id, 'decline', declineReason)} disabled={!declineReason.trim()} style={{ flex: 2, padding: 12, background: '#c0392b', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: !declineReason.trim() ? 0.5 : 1 }}>
                Confirm Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
