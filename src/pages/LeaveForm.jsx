import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

const STAFF = [
  { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', division: 'Operations', role: 'Managing Director' },
  { name: 'Erin Smallbon', email: 'erin@technomed.com.au', division: 'Operations', role: 'General Manager' },
  { name: 'Emma Lovering', email: 'marketing@technomed.com.au', division: 'Operations', role: 'Co-Founder, Brand Lead' },
  { name: 'Toni Hoppitt', email: 'toni@technomed.com.au', division: 'Operations', role: 'Operations Coordinator' },
  { name: 'Ben Cassidy', email: 'ben@technomed.com.au', division: 'Spine', role: 'Clinical Support Specialist' },
  { name: 'Mat Usher', email: 'mat@technomed.com.au', division: 'CMF', role: 'Business Development and Director' },
  { name: 'Jeremy Sharpen', email: 'jeremy@technomed.com.au', division: 'Orthopaedics', role: 'Director of Orthopaedics' },
  { name: 'April Foale', email: 'april@technomed.com.au', division: 'Orthopaedics', role: 'Clinical Support Specialist' },
  { name: 'Aimee Vulinovich', email: 'aimee@technomed.com.au', division: 'Spine', role: 'Clinical Support Specialist' }
]

const LEAVE_TYPES = [
  { id: 'ANNUAL_LEAVE', label: 'Annual Leave', desc: 'Planned holiday or personal time off' },
  { id: 'SICK', label: 'Personal / Sick Leave', desc: 'Illness, injury or personal circumstances' },
  { id: 'TOIL', label: 'Time Off In Lieu (TOIL)', desc: 'Using time accrued from overtime hours' }
]

const STEPS = ['Your details', 'Leave dates', 'Type of leave', 'Reason', 'Review & submit']

function fmt(d) {
  if (!d) return '---'
  const parts = d.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return parseInt(parts[2]) + ' ' + months[parseInt(parts[1])-1] + ' ' + parts[0]
}

const css = {
  app: { minHeight:'100vh', maxWidth:'430px', margin:'0 auto', display:'flex', flexDirection:'column', background:'#f0f3f7', fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif' },
  hdr: { background:'#042746', padding:'48px 20px 18px', position:'relative' },
  cnt: { position:'absolute', top:'16px', right:'20px', fontSize:'11px', color:'rgba(255,255,255,0.4)' },
  logo: { height:'44px', width:'auto', marginBottom:'4px', display:'block' },
  sub: { fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'12px' },
  ttl: { fontSize:'20px', fontWeight:'700', color:'white', marginBottom:'3px' },
  pb: { height:'2px', background:'rgba(255,255,255,0.12)', borderRadius:'1px', overflow:'hidden', marginTop:'14px' },
  pf: { height:'100%', background:'#2ab5a0', borderRadius:'1px', transition:'width 0.4s' },
  body: { flex:'1', overflowY:'auto', background:'#f0f3f7', padding:'22px 20px 8px' },
  grp: { marginBottom:'18px' },
  lbl: { display:'block', fontSize:'13px', fontWeight:'600', color:'#042746', marginBottom:'4px' },
  hnt: { fontSize:'12px', color:'#6b7a8d', marginBottom:'8px', lineHeight:'1.5', margin:'0 0 8px 0' },
  inp: { width:'100%', padding:'12px 14px', border:'1px solid rgba(26,43,74,0.12)', borderRadius:'10px', fontSize:'15px', background:'white', color:'#042746', outline:'none', boxSizing:'border-box', fontFamily:'inherit', appearance:'none', WebkitAppearance:'none' },
  sw: { position:'relative' },
  sa: { position:'absolute', right:'14px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none', width:'0', height:'0', borderLeft:'5px solid transparent', borderRight:'5px solid transparent', borderTop:'6px solid #6b7a8d' },
  lt: { display:'flex', alignItems:'center', gap:'14px', padding:'14px', border:'1.5px solid rgba(26,43,74,0.12)', borderRadius:'12px', background:'white', cursor:'pointer', width:'100%', marginBottom:'10px', textAlign:'left', boxSizing:'border-box' },
  lts: { border:'1.5px solid #2ab5a0', background:'#e6f4f2' },
  ln: { fontSize:'14px', fontWeight:'600', color:'#042746' },
  ld: { fontSize:'12px', color:'#6b7a8d', marginTop:'2px' },
  di: { background:'rgba(42,181,160,0.07)', border:'1px solid rgba(42,181,160,0.18)', borderRadius:'10px', padding:'12px 14px', fontSize:'13px', color:'#6b7a8d', lineHeight:'1.6', marginTop:'12px' },
  sc: { background:'white', border:'1px solid rgba(26,43,74,0.08)', borderRadius:'14px', overflow:'hidden', marginBottom:'14px' },
  sh: { background:'#042746', padding:'10px 14px', fontSize:'11px', fontWeight:'600', color:'rgba(255,255,255,0.6)', letterSpacing:'1px', textTransform:'uppercase' },
  sr: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'10px 14px', borderBottom:'0.5px solid rgba(26,43,74,0.08)', gap:'12px' },
  sl: { fontSize:'12px', color:'#6b7a8d', flexShrink:'0' },
  sv: { fontSize:'13px', fontWeight:'500', color:'#1a2b4a', textAlign:'right' },
  bdg: { fontSize:'12px', fontWeight:'600', background:'#e6f4f2', color:'#1a7a6e', padding:'3px 10px', borderRadius:'20px' },
  err: { background:'#fdecea', border:'1px solid rgba(192,57,43,0.2)', borderRadius:'10px', padding:'11px 14px', fontSize:'13px', color:'#c0392b', marginTop:'8px' },
  nav: { display:'flex', gap:'10px', padding:'12px 20px', background:'white', borderTop:'0.5px solid rgba(26,43,74,0.1)' },
  bk: { flex:'1', padding:'14px', borderRadius:'10px', border:'1.5px solid rgba(26,43,74,0.2)', background:'transparent', fontSize:'15px', fontWeight:'500', color:'#6b7a8d', cursor:'pointer' },
  nx: { flex:'2', padding:'14px', borderRadius:'10px', border:'none', background:'#042746', fontSize:'15px', fontWeight:'600', color:'white', cursor:'pointer' },
  sb: { flex:'2', padding:'14px', borderRadius:'10px', border:'none', background:'#1a7a6e', fontSize:'15px', fontWeight:'600', color:'white', cursor:'pointer' }
}

export default function LeaveForm() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name:'', email:'', division:'', role:'', startDate:'', endDate:'', returnDate:'', leaveType:'', reason:'' })

  function setField(f, v) { setForm(function(p) { return Object.assign({}, p, {[f]:v}) }) }

  function selectStaff(e) {
    var found = null
    for (var i = 0; i < STAFF.length; i++) {
      if (STAFF[i].name === e.target.value) { found = STAFF[i]; break }
    }
    if (found) {
      setForm(function(p) { return Object.assign({}, p, { name:found.name, email:found.email, division:found.division, role:found.role }) })
    } else {
      setForm(function(p) { return Object.assign({}, p, { name:'', email:'', division:'', role:'' }) })
    }
  }

  function validate() {
    if (step === 0 && !form.name) return 'Please select your name'
    if (step === 1) {
      if (!form.startDate) return 'Please select your first day of leave'
      if (!form.endDate) return 'Please select your last day of leave'
      if (!form.returnDate) return 'Please select your return to work date'
      if (form.endDate < form.startDate) return 'Last day must be after first day'
      if (form.returnDate <= form.endDate) return 'Return date must be after last day'
    }
    if (step === 2 && !form.leaveType) return 'Please select a leave type'
    if (step === 3 && !form.reason.trim()) return 'Please enter a reason'
    return ''
  }

  function next() {
    var err = validate()
    if (err) { setError(err); return }
    setError('')
    setStep(function(s) { return s + 1 })
  }

  function back() {
    setError('')
    setStep(function(s) { return s - 1 })
  }

  function submit() {
    setSubmitting(true)
    setError('')
    axios.post('/api/submit', form).then(function() {
      navigate('/success', { state: { form: form } })
    }).catch(function(e) {
      setError((e.response && e.response.data && e.response.data.error) || 'Submission failed. Please try again.')
      setSubmitting(false)
    })
  }

  var leaveLabel = '---'
  for (var i = 0; i < LEAVE_TYPES.length; i++) {
    if (LEAVE_TYPES[i].id === form.leaveType) { leaveLabel = LEAVE_TYPES[i].label; break }
  }

  var progress = ((step + 1) / STEPS.length * 100) + '%'

  return React.createElement('div', { style: css.app },
    React.createElement('div', { style: css.hdr },
      React.createElement('div', { style: css.cnt }, (step+1) + ' of ' + STEPS.length),
      React.createElement('img', { src: '/logo.png', alt: 'TechnoMed', style: css.logo }),
      React.createElement('div', { style: css.sub }, 'Staff Portal'),
      React.createElement('div', { style: css.ttl }, STEPS[step]),
      React.createElement('div', { style: css.pb },
        React.createElement('div', { style: Object.assign({}, css.pf, { width: progress }) })
      )
    ),
    React.createElement('div', { style: css.body },
      step === 0 && React.createElement('div', null,
        React.createElement('div', { style: css.grp },
          React.createElement('label', { style: css.lbl }, 'Your name'),
          React.createElement('p', { style: css.hnt }, 'Select your name from the list'),
          React.createElement('div', { style: css.sw },
            React.createElement('select', { style: css.inp, value: form.name, onChange: selectStaff },
              React.createElement('option', { value: '' }, 'Select your name...'),
              STAFF.map(function(s) { return React.createElement('option', { key: s.email, value: s.name }, s.name) })
            ),
            React.createElement('div', { style: css.sa })
          )
        ),
        form.division && React.createElement('div', { style: css.grp },
          React.createElement('label', { style: css.lbl }, 'Division'),
          React.createElement('input', { style: css.inp, value: form.division, readOnly: true })
        )
      ),
      step === 1 && React.createElement('div', null,
        React.createElement('div', { style: css.grp },
          React.createElement('label', { style: css.lbl }, 'First day of leave'),
          React.createElement('input', { type: 'date', style: css.inp, value: form.startDate, onChange: function(e) { setField('startDate', e.target.value) } })
        ),
        React.createElement('div', { style: css.grp },
          React.createElement('label', { style: css.lbl }, 'Last day of leave'),
          React.createElement('input', { type: 'date', style: css.inp, value: form.endDate, min: form.startDate, onChange: function(e) { setField('endDate', e.target.value) } })
        ),
        React.createElement('div', { style: css.grp },
          React.createElement('label', { style: css.lbl }, 'Return to work date'),
          React.createElement('input', { type: 'date', style: css.inp, value: form.returnDate, min: form.endDate, onChange: function(e) { setField('returnDate', e.target.value) } })
        )
      ),
      step === 2 && React.createElement('div', null,
        LEAVE_TYPES.map(function(t) {
          return React.createElement('button', { key: t.id, style: Object.assign({}, css.lt, form.leaveType === t.id ? css.lts : {}), onClick: function() { setField('leaveType', t.id) } },
            React.createElement('div', null,
              React.createElement('div', { style: css.ln }, t.label),
              React.createElement('div', { style: css.ld }, t.desc)
            )
          )
        })
      ),
      step === 3 && React.createElement('div', null,
        React.createElement('div', { style: css.grp },
          React.createElement('label', { style: css.lbl }, 'Reason for leave'),
          React.createElement('p', { style: css.hnt }, 'This will appear in the notification email to management'),
          React.createElement('textarea', { style: Object.assign({}, css.inp, { minHeight:'100px', lineHeight:'1.6', resize:'none' }), placeholder: 'e.g. Family holiday, medical procedure...', value: form.reason, onChange: function(e) { setField('reason', e.target.value) } })
        ),
        React.createElement('div', { style: css.di }, 'Your application will be reviewed by management before anything is confirmed.')
      ),
      step === 4 && React.createElement('div', null,
        React.createElement('div', { style: css.sc },
          React.createElement('div', { style: css.sh }, 'Application summary'),
          [['Employee', form.name], ['Division', form.division], ['First day', fmt(form.startDate)], ['Last day', fmt(form.endDate)], ['Return date', fmt(form.returnDate)], ['Reason', form.reason]].map(function(row) {
            return React.createElement('div', { key: row[0], style: css.sr },
              React.createElement('span', { style: css.sl }, row[0]),
              React.createElement('span', { style: css.sv }, row[1] || '---')
            )
          }),
          React.createElement('div', { style: css.sr },
            React.createElement('span', { style: css.sl }, 'Leave type'),
            React.createElement('span', { style: css.bdg }, leaveLabel)
          )
        ),
        React.createElement('div', { style: css.di }, 'Management will be notified and will review your application.')
      ),
      error && React.createElement('div', { style: css.err }, error)
    ),
    React.createElement('div', { style: css.nav },
      step > 0 && React.createElement('button', { style: css.bk, onClick: back, disabled: submitting }, 'Back'),
      step < STEPS.length - 1
        ? React.createElement('button', { style: css.nx, onClick: next }, 'Continue')
        : React.createElement('button', { style: css.sb, onClick: submit, disabled: submitting }, submitting ? 'Submitting...' : 'Submit application')
    )
  )
}
