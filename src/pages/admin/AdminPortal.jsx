import React, { useState, useEffect } from 'react'
import TimesheetApprovals from './TimesheetApprovals.jsx'
import StaffPins from './StaffPins.jsx'
import SystemStatus from './SystemStatus.jsx'

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

const HOURS_IN_A_DAY = 7.6

/** 38 → "38h · 5 days". The hours are the truth; the days are the question. */
function readBalance(entry) {
  if (!entry || entry.hours == null) return null
  const hours = Math.round(entry.hours * 10) / 10
  // Only where Xero is counting in hours. A type configured in days would
  // otherwise be divided by 7.6 and reported as a seventh of itself.
  if (!/hour/i.test(entry.units || 'Hours')) return `${hours} ${entry.units}`
  const days = Math.round((hours / HOURS_IN_A_DAY) * 10) / 10
  return `${hours}h · ${days} day${days === 1 ? '' : 's'}`
}

/**
 * Annual, sick and TOIL, as Xero holds them.
 *
 * Read rather than recomputed. Xero is what pays people, and a second opinion
 * on a leave balance is worse than none — it invites approving against the
 * wrong one.
 */
function LeaveBalances({ who, balances }) {
  if (!balances) {
    return <div style={{ fontSize:11, color:'#6b7a8d', marginBottom:10 }}>Checking leave balances…</div>
  }
  if (!balances.connected) {
    return (
      <div style={{ fontSize:11, color:'#6b7a8d', marginBottom:10 }}>
        Leave balances unavailable — Xero could not be reached.
      </div>
    )
  }

  const person = (balances.people || []).find(p =>
    (p.email || '').toLowerCase() === (who.email || '').toLowerCase()
    || p.name === who.name)

  if (!person?.matched || !person.balances) {
    // Said plainly. A blank row here would read as "no leave left", and that
    // is a different thing from "we could not find them in payroll".
    return (
      <div style={{ fontSize:11, color:'#6b7a8d', marginBottom:10 }}>
        No matching Xero employee — balances could not be checked.
      </div>
    )
  }

  const shown = [
    ['Annual', person.balances.annual],
    ['Sick', person.balances.sick],
    ['TOIL', person.balances.toil]
  ]

  return (
    <div style={{
      display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:10,
      background:'#f8f9fc', borderRadius:8, padding:'10px 12px'
    }}>
      {shown.map(([label, entry]) => {
        const text = readBalance(entry)
        return (
          <div key={label}>
            <div style={{ fontSize:11, color:'#6b7a8d', marginBottom:2 }}>{label}</div>
            <div style={{ fontSize:13, fontWeight:600, color: text ? '#042746' : '#6b7a8d' }}>
              {/* An em dash, not a nought: Xero holding no balance of this
                  type and Xero holding zero hours are different facts. */}
              {text || '—'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function AdminPortal({ user }) {
  const [applications, setApplications] = useState({ pending: [], approved: [], declined: [] })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('pending')
  const [actionLoading, setActionLoading] = useState(null)
  const [declineModal, setDeclineModal] = useState(null)
  const [declineReason, setDeclineReason] = useState('')
  const [error, setError] = useState('')
  const [domain, setDomain] = useState('leave')

  // The admin endpoints authorise on the session token minted at PIN login —
  // there is no shared password in the client bundle.
  const authHeaders = { Authorization: `Bearer ${user?.token || ''}` }

  useEffect(() => { fetchApplications(); fetchBalances() }, [])

  // What Xero says each person has left. Fetched once for the team rather than
  // per card: the same people appear across pending, approved and declined,
  // and nine lookups is enough without multiplying them by the list.
  const [balances, setBalances] = useState(null)

  async function fetchBalances() {
    try {
      const res = await fetch('/api/timesheet/agent?action=balances&all=1',
        { headers: authHeaders })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setBalances(data)
    } catch {
      // Left null, which the card reads as "could not check" rather than as
      // zero. A blank balance beside an application says "they have none",
      // which is the opposite of what a failed lookup means.
      setBalances({ connected: false, people: [] })
    }
  }

  async function fetchApplications() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/applications', { headers: authHeaders })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
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
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ id, action, declineReason: reason })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      // Approval succeeds even if an integration fails, so surface each result
      // rather than letting a silent failure look like a clean approval.
      const problems = [
        data.xeroError && `Xero: ${data.xeroError}`,
        data.calendarError && `Calendar: ${data.calendarError}`,
        data.emailError && `Email: ${data.emailError}`
      ].filter(Boolean)

      // fetchApplications clears the banner, so report after it refreshes.
      await fetchApplications()
      if (problems.length) {
        setError(`${action === 'decline' ? 'Declined' : 'Approved'}, but some steps failed — ${problems.join(' · ')}`)
      }
      setDeclineModal(null)
      setDeclineReason('')
    } catch (err) {
      setError('Action failed: ' + err.message)
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
    <div style={{ minHeight:'100%', background:'#f0f3f7', fontFamily:'-apple-system,sans-serif' }}>
      {/* Safe-area inset plus normal spacing. It was a fixed 56px, which is one
          iPhone's status bar and wrong everywhere else. */}
      <div style={{ background:'#042746', paddingTop:'calc(env(safe-area-inset-top, 0px) + 20px)', paddingLeft:20, paddingRight:20, paddingBottom:20 }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height:40, width:'auto', marginBottom:4 }} />
        <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:8 }}>Admin Portal</div>
        <div style={{ fontSize:18, fontWeight:700, color:'white', marginBottom:4 }}>Leave Applications</div>
        <div style={{ fontSize:13, color:'rgba(255,255,255,0.5)', marginBottom:16 }}>Welcome, {user?.name?.split(' ')[0]}</div>
        <div style={{ display:'flex', gap:7, marginBottom:12, flexWrap:'wrap' }}>
          {[['leave','Leave'],['timesheets','Timesheets'],['pins','Staff PINs'],['system','System']].map(([id,label]) => (
            <button key={id} onClick={() => setDomain(id)} style={{ padding:'7px 15px', borderRadius:20, border:'none', background: domain===id ? '#189a85' : 'rgba(255,255,255,0.12)', color:'white', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: domain === 'leave' ? 'flex' : 'none', gap:8 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding:'7px 14px', borderRadius:20, border:'none', background: tab===t.id ? 'white' : 'rgba(255,255,255,0.12)', color: tab===t.id ? '#042746' : 'white', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              {t.label} {t.count > 0 && `(${t.count})`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:16 }}>
        {domain === 'timesheets' && <TimesheetApprovals user={user} />}
        {domain === 'pins' && <StaffPins user={user} />}
        {domain === 'system' && <SystemStatus user={user} />}
        {domain === 'leave' && <>
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
              {/* What Xero says they have left, beside the application rather
                  than in another tab. Approving leave somebody does not have
                  is the mistake this is here to stop. */}
              <LeaveBalances who={app} balances={balances} />
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
        </>}
      </div>

      {declineModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:20, zIndex:1000 }}>
          <div style={{ background:'white', borderRadius:16, padding:24, width:'100%', maxWidth:400 }}>
            <div style={{ fontSize:17, fontWeight:700, color:'#042746', marginBottom:6 }}>Decline application</div>
            <div style={{ fontSize:13, color:'#6b7a8d', marginBottom:16 }}>Declining leave for <strong>{declineModal.name}</strong>. Please provide a reason:</div>
            <textarea value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="e.g. Operational requirements..." rows={3}
              style={{ width:'100%', padding:'12px 14px', border:'1px solid rgba(26,43,74,0.15)', borderRadius:10, fontSize: 16, resize:'none', outline:'none', boxSizing:'border-box', marginBottom:16, fontFamily:'inherit' }} />
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
