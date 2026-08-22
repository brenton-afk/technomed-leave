import React, { useState } from 'react'
import axios from 'axios'
import { Page, Header, Body } from '../design/Shell.jsx'
import { colour, text, space, radius, border } from '../design/tokens.js'


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

export default function LeaveForm({ user, onSuccess, onBack }) {
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const staffMember = user?.staff || user
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    division: staffMember?.division || '',
    role: staffMember?.role || '',
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

  const inp = { width:'100%', padding:'12px 14px', border:'1px solid rgba(26,43,74,0.12)', borderRadius:'10px', fontSize:'16px', background:'white', color:colour.navy, outline:'none', boxSizing:'border-box', fontFamily:'inherit', appearance:'none', WebkitAppearance:'none' }
  const grp = { marginBottom:'18px' }
  const lbl = { display:'block', fontSize:'14px', fontWeight:'600', color:colour.navy, marginBottom:'4px' }

  return (
    <Page style={{ display:'flex', flexDirection:'column' }}>
      <Header
        eyebrow={`Leave application · step ${step + 1} of ${STEPS.length}`}
        title={STEPS[step]}
        onBack={step === 0 ? onBack : back}
      >
        <div style={{ height:3, background:'rgba(255,255,255,0.14)', borderRadius:2, overflow:'hidden' }}>
          <div style={{ height:'100%', background:colour.accent, width:progress, transition:'width 0.4s' }} />
        </div>
      </Header>

      <div style={{ flex:1, padding:'20px 20px 100px', background:colour.canvas }}>
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
              <button key={t.id} style={{ display:'flex', alignItems:'center', gap:14, padding:14, border:`1.5px solid ${form.leaveType===t.id?colour.accent:'rgba(26,43,74,0.12)'}`, borderRadius:12, background: form.leaveType===t.id?'#e6f4f2':'white', cursor:'pointer', width:'100%', marginBottom:10, textAlign:'left', boxSizing:'border-box' }}
                onClick={() => setField('leaveType', t.id)}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, color:colour.navy }}>{t.label}</div>
                  <div style={{ fontSize:12.5, color:colour.inkFaint, marginTop:2 }}>{t.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={grp}>
              <label style={lbl}>Reason for leave</label>
              <p style={{ fontSize:12.5, color:colour.inkFaint, marginBottom:8 }}>This will appear in the notification email to management</p>
              <textarea style={{ ...inp, minHeight:100, lineHeight:1.6, resize:'none' }} placeholder="e.g. Family holiday, medical procedure..." value={form.reason} onChange={e => setField('reason', e.target.value)} />
            </div>
            <div style={{ background:'rgba(42,181,160,0.07)', border:'1px solid rgba(42,181,160,0.18)', borderRadius:10, padding:'12px 14px', fontSize:14, color:colour.inkFaint, lineHeight:1.6 }}>
              🔒 Your application will be reviewed by management before anything is confirmed.
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ background:'white', border:'1px solid rgba(26,43,74,0.08)', borderRadius:14, overflow:'hidden', marginBottom:14 }}>
              <div style={{ background:colour.navy, padding:'10px 14px', fontSize:12.5, fontWeight:600, color:'rgba(255,255,255,0.6)', letterSpacing:1, textTransform:'uppercase' }}>Application summary</div>
              {[['Employee',form.name],['Division',form.division],['First day',fmt(form.startDate)],['Last day',fmt(form.endDate)],['Return date',fmt(form.returnDate)],['Reason',form.reason]].map(([l,v],i) => (
                <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'10px 14px', borderBottom:'0.5px solid rgba(26,43,74,0.08)', gap:12, background:i%2===0?'#f8f9fc':'white' }}>
                  <span style={{ fontSize:12.5, color:colour.inkFaint }}>{l}</span>
                  <span style={{ fontSize:14, fontWeight:500, color:'#1a2b4a', textAlign:'right' }}>{v||'---'}</span>
                </div>
              ))}
              <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 14px', gap:12 }}>
                <span style={{ fontSize:12.5, color:colour.inkFaint }}>Leave type</span>
                <span style={{ fontSize:12.5, fontWeight:600, background:'#e6f4f2', color:'#1a7a6e', padding:'3px 10px', borderRadius:20 }}>{leaveLabel}</span>
              </div>
            </div>
            <div style={{ background:'rgba(42,181,160,0.07)', border:'1px solid rgba(42,181,160,0.18)', borderRadius:10, padding:'12px 14px', fontSize:14, color:colour.inkFaint, lineHeight:1.6 }}>
              📧 Management will be notified and will review your application.
            </div>
          </div>
        )}

        {error && <div style={{ background:colour.dangerSoft, border:'1px solid rgba(192,57,43,0.2)', borderRadius:10, padding:'11px 14px', fontSize:14, color:colour.danger, marginTop:8 }}>{error}</div>}
      </div>

      <div style={{ position:'fixed', bottom:'70px', left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:430, display:'flex', gap:10, padding:'12px 20px', background:'white', borderTop:'0.5px solid rgba(26,43,74,0.1)', boxSizing:'border-box', zIndex:50 }}>
        {step > 0 && <button style={{ flex:1, padding:14, borderRadius:10, border:'1.5px solid rgba(26,43,74,0.2)', background:'transparent', fontSize:16, fontWeight:500, color:colour.inkFaint, cursor:'pointer' }} onClick={back} disabled={submitting}>Back</button>}
        {step < STEPS.length-1
          ? <button style={{ flex:2, padding:14, borderRadius:10, border:'none', background:colour.navy, fontSize:16, fontWeight:600, color:'white', cursor:'pointer' }} onClick={next}>Continue →</button>
          : <button style={{ flex:2, padding:14, borderRadius:10, border:'none', background:'#1a7a6e', fontSize:16, fontWeight:600, color:'white', cursor:'pointer', opacity:submitting?0.7:1 }} onClick={submit} disabled={submitting}>{submitting?'Submitting…':'Submit application ✓'}</button>
        }
      </div>
    </Page>
  )
}
