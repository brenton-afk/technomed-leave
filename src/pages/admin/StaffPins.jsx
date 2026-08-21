import React, { useState, useEffect, useMemo } from 'react'

const NAVY = '#042746'
const TEAL = '#189a85'
const MUTED = '#6b7a8d'
const BORDER = 'rgba(26,43,74,0.12)'

// Who has signed in before, and a way to send someone back through first-time
// PIN setup. Clearing a PIN is the only recovery path for a staff member who
// has forgotten theirs — PINs are not readable, only replaceable.
export default function StaffPins({ user }) {
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState('')

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'roster' })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setRoster(data.roster || [])
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  async function reset(member) {
    setBusy(member.email); setError(''); setNotice('')
    try {
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'reset', targetEmail: member.email })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setNotice(`${member.name}'s PIN was cleared. They'll be asked to create a new one next time they sign in.`)
      setConfirming(null)
      await load()
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  const neverSignedIn = roster.filter(m => !m.hasPin)

  return (
    <div>
      {error && <div style={{ background:'#fdecea', color:'#c0392b', padding:12, borderRadius:10, fontSize:13, marginBottom:12 }}>{error}</div>}
      {notice && <div style={{ background:'#e6f4f2', color:TEAL, padding:12, borderRadius:10, fontSize:13, marginBottom:12, lineHeight:1.5 }}>{notice}</div>}

      {!loading && neverSignedIn.length > 0 && (
        <div style={{ background:'#fff8e6', border:'1px solid rgba(245,158,11,0.3)', borderRadius:10, padding:'11px 13px', marginBottom:12 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#8a5a00', marginBottom:3 }}>
            Never signed in ({neverSignedIn.length})
          </div>
          <div style={{ fontSize:12, color:'#8a5a00', lineHeight:1.5 }}>
            {neverSignedIn.map(m => m.name).join(', ')} — they'll be prompted to create a PIN on first sign-in.
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign:'center', padding:30, color:MUTED, fontSize:14 }}>Loading…</div>}

      {roster.map(member => (
        <div key={member.email} style={{ background:'white', borderRadius:12, padding:'12px 15px', marginBottom:9, border:`1px solid ${BORDER}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:NAVY }}>
                {member.name}
                {member.isAdmin && <span style={{ fontSize:10, fontWeight:600, color:TEAL, marginLeft:7 }}>ADMIN</span>}
              </div>
              <div style={{ fontSize:11.5, color:MUTED, marginTop:2 }}>{member.email}</div>
            </div>
            <span style={{ fontSize:11, fontWeight:600, padding:'4px 10px', borderRadius:20, whiteSpace:'nowrap',
              background: member.hasPin ? '#e6f4f2' : '#fff3cd', color: member.hasPin ? TEAL : '#856404' }}>
              {member.hasPin ? 'PIN set' : 'No PIN yet'}
            </span>
          </div>

          {member.hasPin && (
            confirming === member.email ? (
              <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid rgba(26,43,74,0.06)' }}>
                <div style={{ fontSize:12, color:MUTED, marginBottom:8, lineHeight:1.5 }}>
                  Clear {member.name.split(' ')[0]}'s PIN? They'll set a new one on their next sign-in.
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => setConfirming(null)}
                    style={{ flex:1, padding:10, background:'#f0f3f7', border:'none', borderRadius:8, fontSize:13, color:MUTED, cursor:'pointer' }}>Cancel</button>
                  <button onClick={() => reset(member)} disabled={busy === member.email}
                    style={{ flex:2, padding:10, background:'#c0392b', color:'white', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer' }}>
                    {busy === member.email ? 'Clearing…' : 'Clear PIN'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirming(member.email)}
                style={{ marginTop:9, padding:'7px 12px', background:'transparent', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:12, color:MUTED, cursor:'pointer' }}>
                Reset PIN
              </button>
            )
          )}
        </div>
      ))}

      <button onClick={load} style={{ width:'100%', padding:12, background:'transparent', border:`1px solid ${BORDER}`, borderRadius:8, fontSize:13, color:MUTED, cursor:'pointer', marginTop:6 }}>
        Refresh
      </button>
    </div>
  )
}
