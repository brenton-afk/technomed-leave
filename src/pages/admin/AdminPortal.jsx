import React, { useState, useEffect } from 'react'

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

export default function AdminPortal({ user }) {
  const [applications, setApplications] = useState({ pending: [], approved: [], declined: [] })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending')
  const [actionLoading, setActionLoading] = useState(null)
  const [declineModal, setDeclineModal] = useState(null)
  const [declineReason, setDeclineReason] = useState('')
  const [error, setError] = useState('')

  const password = process.env.ADMIN_PASSWORD || 'Technoadmin2026'

  useEffect(() => { fetchApplications() }, [])

  async function fetchApplications() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/applications?password=Technoadmin2026`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.xeroError) alert('Xero error: ' + data.xeroError)
      if (data.xeroResult) alert('Xero success! Leave ID: ' + data.xeroResult.leaveApplicationID)
      setApplications(data)
    } catch (err) {
      setError('Failed to load applications: ' + err.message)
    }
    setLoading(false)
  }

  async function handleAction(id, action, reason = '') {
    setActionLoading(id + action)
    try {
      const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, password: 'Technoadmin2026', declineReason: reason })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.xeroError) alert('Xero error: ' + data.xeroError)
      if (data.xeroResult) alert('Xero success! Leave ID: ' + data.xeroResult.leaveApplicationID)
      await fetchApplications()
      setDeclineModal(null)
      setDeclineReason('')
    } catch (err) {
      alert('Action failed: ' + err.message)
    }
    setActionLoading(null)
  }

  const tabs = [
    { id: 'pending', label: 'Pending', count: applications.pending?.length || 0 },
    { id: 'approved', label: 'Approved', count: applications.approved?.length || 0 },
    { id: 'declined', label: 'Declined', count: applications.declined?.length || 0 }
  ]

  const currentApps = applications[tab] || []

  return (
    <div style={{ minHeight:'100vh', background:'#f0f3f7', fontFamily:'-apple-system,sans-serif' }}>
      <div style={{ background:'#042746', paddingTop:56, paddingLeft:20, paddingRight:20, paddingBottom:20 }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height:40, width:'auto', marginBottom:4 }} />
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:8 }}>Admin Portal</div>
        <div style={{ fontSize:18, fontWeight:700, color:'white', marginBottom:4 }}>Leave Applications</div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,0.5)', marginBottom:16 }}>Welcome, {user?.name?.split(' ')[0]}</div>
        <div style={{ display:'flex', gap:8 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding:'7px 14px', borderRadius:20, border:'none', background: tab===t.id ? 'white' : 'rgba(255,255,255,0.12)', color: tab===t.id ? '#042746' : 'white', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              {t.label} {t.count > 0 && `(${t.count})`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:16 }}>
        {loading && <div style={{ textAlign:'center', padding:40, color:'#6b7a8d' }}>Loading...</div>}
        {error && <div style={{ background:'#fdecea', color:'#c0392b', padding:'12px 14px', borderRadius:10, marginBottom:12, fontSize:13 }}>{error}</div>}

        {!loading && currentApps.length === 0 && (
          <div style={{ background:'white', borderRadius:12, padding:40, textAlign:'center', color:'#6b7a8d', fontSize:14 }}>
            No {tab} applications
          </div>
        )}

        {currentApps.map(app => (
          <div key={app.id} style={{ background:'white', borderRadius:12, marginBottom:12, overflow:'hidden', border:'1px solid rgba(26,43,74,0.08)' }}>
            <div style={{ padding:'14px 16px', borderBottom:'1px solid rgba(26,43,74,0.06)', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:'#042746' }}>{app.name}</div>
                <div style={{ fontSize:12, color:'#6b7a8d', marginTop:2 }}>{app.division} · {LEAVE_LABELS[app.leaveType] || app.leaveType}</div>
              </div>
              <span style={{ fontSize:11, fontWeight:600, padding:'4px 10px', borderRadius:20, background: app.status==='pending'?'#fff3cd':app.status==='approved'?'#e6f4f2':'#fdecea', color: app.status==='pending'?'#856404':app.status==='approved'?'#1a7a6e':'#c0392b' }}>
                {app.status==='pending'?'⏳ Pending':app.status==='approved'?'✅ Approved':'❌ Declined'}
              </span>
            </div>
            <div style={{ padding:'12px 16px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
                {[['First day', formatDate(app.startDate)], ['Last day', formatDate(app.endDate)], ['Return date', formatDate(app.returnDate)], ['Submitted', new Date(app.submittedAt).toLocaleDateString('en-AU')]].map(([l,v]) => (
                  <div key={l}>
                    <div style={{ fontSize:11, color:'#6b7a8d', marginBottom:2 }}>{l}</div>
                    <div style={{ fontSize:13, fontWeight:500, color:'#042746' }}>{v}</div>
                  </div>
                ))}
              </div>
              {app.reason && <div style={{ background:'#f8f9fc', borderRadius:8, padding:'10px 12px', fontSize:13, color:'#042746' }}><span style={{ color:'#6b7a8d', fontSize:11 }}>Reason: </span>{app.reason}</div>}
            </div>
            {app.status === 'pending' && (
              <div style={{ padding:'12px 16px', borderTop:'1px solid rgba(26,43,74,0.06)', display:'flex', gap:10 }}>
                <button onClick={() => handleAction(app.id, 'approve')} disabled={actionLoading === app.id+'approve'}
                  style={{ flex:2, padding:12, background:'#1a7a6e', color:'white', border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor:'pointer', opacity: actionLoading===app.id+'approve'?0.7:1 }}>
                  {actionLoading === app.id+'approve' ? 'Approving…' : '✅ Approve'}
                </button>
                <button onClick={() => setDeclineModal(app)} style={{ flex:1, padding:12, background:'#fdecea', color:'#c0392b', border:'1px solid rgba(192,57,43,0.2)', borderRadius:8, fontSize:14, fontWeight:600, cursor:'pointer' }}>
                  ❌ Decline
                </button>
              </div>
            )}
          </div>
        ))}

        <button onClick={fetchApplications} style={{ width:'100%', padding:12, background:'transparent', border:'1px solid rgba(26,43,74,0.15)', borderRadius:8, fontSize:13, color:'#6b7a8d', cursor:'pointer', marginTop:8 }}>
          Refresh
        </button>
      </div>

      {declineModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:20, zIndex:1000 }}>
          <div style={{ background:'white', borderRadius:16, padding:24, width:'100%', maxWidth:400 }}>
            <div style={{ fontSize:17, fontWeight:700, color:'#042746', marginBottom:6 }}>Decline application</div>
            <div style={{ fontSize:13, color:'#6b7a8d', marginBottom:16 }}>Declining leave for <strong>{declineModal.name}</strong>. Please provide a reason:</div>
            <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="e.g. Operational requirements..." rows={3}
              style={{ width:'100%', padding:'12px 14px', border:'1px solid rgba(26,43,74,0.15)', borderRadius:10, fontSize:14, resize:'none', outline:'none', boxSizing:'border-box', marginBottom:16, fontFamily:'inherit' }} />
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => { setDeclineModal(null); setDeclineReason('') }} style={{ flex:1, padding:12, background:'#f0f3f7', border:'none', borderRadius:8, fontSize:14, cursor:'pointer', color:'#6b7a8d' }}>Cancel</button>
              <button onClick={() => handleAction(declineModal.id, 'decline', declineReason)} disabled={!declineReason.trim()}
                style={{ flex:2, padding:12, background:'#c0392b', color:'white', border:'none', borderRadius:8, fontSize:14, fontWeight:600, cursor:'pointer', opacity:!declineReason.trim()?0.5:1 }}>
                Confirm Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
