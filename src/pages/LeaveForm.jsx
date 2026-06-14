import React, { useState } from 'react'
import axios from 'axios'

const LEAVE_TYPES = [
  { id: 'ANNUAL_LEAVE', label: 'Annual Leave', desc: 'Planned holiday or personal time off' },
  { id: 'SICK', label: 'Personal / Sick Leave', desc: 'Illness, injury or personal circumstances' },
  { id: 'TOIL', label: 'Time Off In Lieu (TOIL)', desc: 'Using time accrued from overtime hours' }
]

const STEPS = ['Leave dates', 'Type of leave', 'Reason', 'Review & submit']

function fmt(d) {
  if (!d) return '---'
  const parts = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return parseInt(parts[2]) + ' ' + months[parseInt(parts[1])-1] + ' ' + parts[0]
}

export default function LeaveForm({ user, onSuccess }) {
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    division: user?.staff?.division || '',
    role: user?.staff?.role || '',
    startDate: '', endDate: '', returnDate: '', leaveType: '', reason: ''
  })

  function setField(f, v) { setForm(p => ({ ...p, [f]: v })) }

  function validate() {
    if (step === 0) {
      if (!form.startDate) return 'Please select your first day of leave'
      if (!form.endDate) return 'Please select your last day of leave'
      if (!form.returnDate) return 'Please select your return to work date'
      if (form.endDate < form.startDate) return 'Last day must be after first day'
      if (form.returnDate <= form.endDate) return 'Return date must be after last day'
    }
    if (step === 1 && !form.leaveType) return 'Please select a leave type'
    if (step === 2 && !form.reason.trim()) return 'Please enter a reason'
    return ''
  }

  function next() {
    const err = validate()
    if (err) { setError(err); return }
    setError(''); setStep(s => s + 1)
  }

  function back() { setError(''); setStep(s => s - 1) }

  function submit() {
    setSubmitting(true); setError('')
    axios.post('/api/submit', form)
      .then(() => { if (onSuccess) onSuccess(form) })
      .catch(e => { setError(e.response?.data?.error || 'Submission failed. Please try again.'); setSubmitting(false) })
  }

  const leaveLabel = LEAVE_TYPES.find(t => t.id === form.leaveType)?.label || '---'
  const progress = ((step + 1) / STEPS.length * 100) + '%'

  const inp = { width:'100%', padding:'12px 14px', border:'1px solid rgba(26,43,74,0.12)', borderRadius:'10px', fontSize:'15px', background:'white', color:'#042746', outline:'none', boxSizing:'border-box', fontFamily:'inherit', appearance:'none', WebkitAppearance:'none' }
  const grp = { marginBottom:'18px' }
  const lbl = { display:'block', fontSize:'13px', fontWeight:'600', color:'#042746', marginBottom:'4px' }

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh', fontFamily:'-apple-system,sans-serif', background:'#f0f3f7' }}>
      <div style={{ background:'#042746', paddingTop:'env(safe-area-inset-top, 48px)', paddingLeft:20, paddingRight:20, paddingBottom:20, position:'relative' }}>
        <div style={{ paddingTop:48 }}>
          <div style={{ position:'absolute', top:16, right:20, fontSize:11, color:'rgba(255,255,255,0.4)' }}>{step+1} of {STEPS.length}</div>
          <img src="/logo.png" alt="TechnoMed" style={{ height:36, width:'auto', marginBottom:4 }} />
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:6 }}>Leave Application · {user?.name}</div>
          <div style={{ fontSize:22, fontWeight:'700', color:'white', marginBottom:12 }}>{STEPS[step]}</div>
          <div style={{ height:2, background:'rgba(255,255,255,0.12)', borderRadius:1, overflow:'hidden' }}>
            <div style={{ height:'100%', background:'#2ab5a0', width:progress, transition:'width 0.4s' }} />
          </div>
        </div>
      </div>

      <div style={{ flex:1, padding:'20px 20px 100px', background:'#f0f3f7' }}>
        {step === 0 && (
          <div>
            <div style={grp}><label style={lbl}>First day of leave</label><input type="date" style={inp} value={form.startDate} onChange={e => setField('startDate', e.target.value)} /></div>
            <div style={grp}><label style={lbl}>Last day of leave</label><input type="date" style={inp} value={form.endDate} min={form.startDate} onChange={e => setField('endDate', e.target.value)} /></div>
            <div style={grp}><label style={lbl}>Return to work date</label><input type="date" style={inp} value={form.returnDate} min={form.endDate} onChange={e => setField('returnDate', e.target.value)} /></div>
          </div>
        )}

        {step === 1 && (
          <div>
            {LEAVE_TYPES.map(t => (
              <button key={t.id} style={{ display:'flex', alignItems:'center', gap:14, padding:14, border:`1.5px solid ${form.leaveType===t.id?'#2ab5a0':'rgba(26,43,74,0.12)'}`, borderRadius:12, background: form.leaveType===t.id?'#e6f4f2':'white', cursor:'pointer', width:'100%', marginBottom:10, textAlign:'left', boxSizing:'border-box' }}
                onClick={() => setField('leaveType', t.id)}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, color:'#042746' }}>{t.label}</div>
                  <div style={{ fontSize:12, color:'#6b7a8d', marginTop:2 }}>{t.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={grp}>
              <label style={lbl}>Reason for leave</label>
              <p style={{ fontSize:12, color:'#6b7a8d', marginBottom:8 }}>This will appear in the notification email to management</p>
              <textarea style={{ ...inp, minHeight:100, lineHeight:1.6, resize:'none' }} placeholder="e.g. Family holiday, medical procedure..." value={form.reason} onChange={e => setField('reason', e.target.value)} />
            </div>
            <div style={{ background:'rgba(42,181,160,0.07)', border:'1px solid rgba(42,181,160,0.18)', borderRadius:10, padding:'12px 14px', fontSize:13, color:'#6b7a8d', lineHeight:1.6 }}>
              🔒 Your application will be reviewed by management before anything is confirmed.
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ background:'white', border:'1px solid rgba(26,43,74,0.08)', borderRadius:14, overflow:'hidden', marginBottom:14 }}>
              <div style={{ background:'#042746', padding:'10px 14px', fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.6)', letterSpacing:1, textTransform:'uppercase' }}>Application summary</div>
              {[['Employee',form.name],['Division',form.division],['First day',fmt(form.startDate)],['Last day',fmt(form.endDate)],['Return date',fmt(form.returnDate)],['Reason',form.reason]].map(([l,v],i) => (
                <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'10px 14px', borderBottom:'0.5px solid rgba(26,43,74,0.08)', gap:12, background:i%2===0?'#f8f9fc':'white' }}>
                  <span style={{ fontSize:12, color:'#6b7a8d' }}>{l}</span>
                  <span style={{ fontSize:13, fontWeight:500, color:'#1a2b4a', textAlign:'right' }}>{v||'---'}</span>
                </div>
              ))}
              <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 14px', gap:12 }}>
                <span style={{ fontSize:12, color:'#6b7a8d' }}>Leave type</span>
                <span style={{ fontSize:12, fontWeight:600, background:'#e6f4f2', color:'#1a7a6e', padding:'3px 10px', borderRadius:20 }}>{leaveLabel}</span>
              </div>
            </div>
            <div style={{ background:'rgba(42,181,160,0.07)', border:'1px solid rgba(42,181,160,0.18)', borderRadius:10, padding:'12px 14px', fontSize:13, color:'#6b7a8d', lineHeight:1.6 }}>
              📧 Management will be notified and will review your application.
            </div>
          </div>
        )}

        {error && <div style={{ background:'#fdecea', border:'1px solid rgba(192,57,43,0.2)', borderRadius:10, padding:'11px 14px', fontSize:13, color:'#c0392b', marginTop:8 }}>{error}</div>}
      </div>

      <div style={{ position:'fixed', bottom:'70px', left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:430, display:'flex', gap:10, padding:'12px 20px', background:'white', borderTop:'0.5px solid rgba(26,43,74,0.1)', boxSizing:'border-box', zIndex:50 }}>
        {step > 0 && <button style={{ flex:1, padding:14, borderRadius:10, border:'1.5px solid rgba(26,43,74,0.2)', background:'transparent', fontSize:15, fontWeight:500, color:'#6b7a8d', cursor:'pointer' }} onClick={back} disabled={submitting}>Back</button>}
        {step < STEPS.length-1
          ? <button style={{ flex:2, padding:14, borderRadius:10, border:'none', background:'#042746', fontSize:15, fontWeight:600, color:'white', cursor:'pointer' }} onClick={next}>Continue →</button>
          : <button style={{ flex:2, padding:14, borderRadius:10, border:'none', background:'#1a7a6e', fontSize:15, fontWeight:600, color:'white', cursor:'pointer', opacity:submitting?0.7:1 }} onClick={submit} disabled={submitting}>{submitting?'Submitting…':'Submit application ✓'}</button>
        }
      </div>
    </div>
  )
}
