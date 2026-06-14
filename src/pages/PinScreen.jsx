import React, { useState } from 'react'
import { STAFF } from '../staffConfig.js'

export default function PinScreen({ onLogin }) {
  const [step, setStep] = useState('select')
  const [selectedEmail, setSelectedEmail] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const staff = STAFF.find(s => s.email === selectedEmail)

  function handleStaffSelect(email) {
    setSelectedEmail(email); setPin(''); setError('')
    fetch('/api/auth/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check', email }) })
      .then(r => r.json()).then(data => { if (data.hasPin) setStep('pin'); else setStep('setup') })
  }

  function addDigit(d) {
    if (step === 'confirm' && confirmPin.length < 4) setConfirmPin(p => p + d)
    else if (pin.length < 4) setPin(p => p + d)
  }

  function deleteDigit() {
    setError('')
    if (step === 'confirm') setConfirmPin(p => p.slice(0,-1))
    else setPin(p => p.slice(0,-1))
  }

  function handleAction() {
    if (step === 'pin' && pin.length === 4) {
      setLoading(true)
      fetch('/api/auth/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', email: selectedEmail, pin }) })
        .then(r => r.json()).then(data => {
          setLoading(false)
          if (data.valid) onLogin({ name: data.name, email: selectedEmail, isAdmin: data.isAdmin })
          else { setError('Incorrect PIN. Please try again.'); setPin('') }
        })
    }
    if (step === 'setup' && pin.length === 4) { setStep('confirm'); setError('') }
    if (step === 'confirm' && confirmPin.length === 4) {
      if (pin !== confirmPin) { setError('PINs do not match. Try again.'); setConfirmPin(''); return }
      setLoading(true)
      fetch('/api/auth/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set', email: selectedEmail, newPin: pin }) })
        .then(r => r.json()).then(data => {
          setLoading(false)
          if (data.success) onLogin({ name: data.name, email: selectedEmail, isAdmin: data.isAdmin })
          else setError('Failed to set PIN. Please try again.')
        })
    }
  }

  const currentPin = step === 'confirm' ? confirmPin : pin
  const w = { minHeight:'100vh', maxWidth:'430px', margin:'0 auto', display:'flex', flexDirection:'column', background:'#042746', fontFamily:'-apple-system,sans-serif' }
  const top = { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 24px 20px' }
  const key = { background:'rgba(255,255,255,0.1)', border:'none', borderRadius:'50%', width:'72px', height:'72px', fontSize:'24px', color:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto' }
  const btn = { width:'100%', padding:'14px', background:'#2ab5a0', border:'none', borderRadius:'10px', color:'white', fontSize:'16px', fontWeight:'600', cursor:'pointer' }

  if (step === 'select') return (
    <div style={w}>
      <div style={top}>
        <img src="/logo.png" alt="TechnoMed" style={{ height:'48px', width:'auto', marginBottom:'6px' }} />
        <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'32px' }}>Staff Portal</div>
        <div style={{ fontSize:'22px', fontWeight:'700', color:'white', marginBottom:'8px' }}>Welcome</div>
        <div style={{ fontSize:'14px', color:'rgba(255,255,255,0.55)', marginBottom:'32px' }}>Select your name to sign in</div>
        <div style={{ position:'relative', width:'100%' }}>
          <select style={{ width:'100%', padding:'12px 14px', border:'1px solid rgba(255,255,255,0.2)', borderRadius:'10px', fontSize:'15px', background:'rgba(255,255,255,0.08)', color:'white', outline:'none', appearance:'none', WebkitAppearance:'none', boxSizing:'border-box' }}
            value={selectedEmail} onChange={e => e.target.value && handleStaffSelect(e.target.value)}>
            <option value="">Select your name...</option>
            {STAFF.map(s => <option key={s.email} value={s.email}>{s.name}</option>)}
          </select>
          <div style={{ position:'absolute', right:'14px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none', borderLeft:'5px solid transparent', borderRight:'5px solid transparent', borderTop:'6px solid rgba(255,255,255,0.5)' }} />
        </div>
      </div>
    </div>
  )

  const titleMap = { pin: `Hi, ${staff?.name?.split(' ')[0] || ''}`, setup: 'Create your PIN', confirm: 'Confirm your PIN' }
  const hintMap = { pin: 'Enter your 4-digit PIN', setup: 'Choose a 4-digit PIN for your account', confirm: 'Enter your PIN again to confirm' }

  return (
    <div style={w}>
      <div style={top}>
        <img src="/logo.png" alt="TechnoMed" style={{ height:'48px', width:'auto', marginBottom:'6px' }} />
        <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'32px' }}>Staff Portal</div>
        <div style={{ fontSize:'22px', fontWeight:'700', color:'white', marginBottom:'8px', textAlign:'center' }}>{titleMap[step]}</div>
        <div style={{ fontSize:'14px', color:'rgba(255,255,255,0.55)', marginBottom:'32px', textAlign:'center' }}>{hintMap[step]}</div>
        <div style={{ display:'flex', gap:'16px', marginBottom:'12px' }}>
          {[0,1,2,3].map(i => <div key={i} style={{ width:'14px', height:'14px', borderRadius:'50%', background: currentPin.length > i ? '#2ab5a0' : 'transparent', border: currentPin.length > i ? '2px solid #2ab5a0' : '2px solid rgba(255,255,255,0.3)' }} />)}
        </div>
        {error && <div style={{ fontSize:'13px', color:'#ff6b6b', marginBottom:'16px', textAlign:'center' }}>{error}</div>}
        {loading && <div style={{ color:'rgba(255,255,255,0.5)', fontSize:'14px' }}>Please wait...</div>}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', padding:'0 32px 16px' }}>
        {[1,2,3,4,5,6,7,8,9].map(n => <button key={n} style={key} onClick={() => addDigit(String(n))}>{n}</button>)}
        <div />
        <button style={key} onClick={() => addDigit('0')}>0</button>
        <button style={{ ...key, background:'transparent', fontSize:'22px', color:'rgba(255,255,255,0.6)' }} onClick={deleteDigit}>⌫</button>
      </div>
      {currentPin.length === 4 && !loading && (
        <div style={{ padding:'0 32px 16px' }}>
          <button style={btn} onClick={handleAction}>{step === 'pin' ? 'Sign in' : step === 'setup' ? 'Continue' : 'Set PIN'}</button>
        </div>
      )}
      <div style={{ display:'flex', justifyContent:'center', paddingBottom:'32px' }}>
        <button style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.4)', fontSize:'14px', cursor:'pointer', padding:'12px' }}
          onClick={() => { setStep('select'); setSelectedEmail(''); setPin(''); setConfirmPin(''); setError('') }}>← Back</button>
      </div>
    </div>
  )
}
