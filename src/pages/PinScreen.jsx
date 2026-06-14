import React, { useState, useEffect } from 'react'
import { STAFF } from '../staffConfig.js'

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

export default function PinScreen({ onLogin }) {
  const [step, setStep] = useState('select')
  const [selectedEmail, setSelectedEmail] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pinInput, setPinInput] = useState('')

  const staff = STAFF.find(s => s.email === selectedEmail)

  function handleStaffSelect(email) {
    setSelectedEmail(email); setPin(''); setError(''); setPinInput('')
    fetch('/api/auth/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check', email })
    }).then(r => r.json()).then(data => {
      if (data.hasPin) setStep('pin')
      else setStep('setup')
    })
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

  useEffect(() => {
    if (!isMobile) {
      function handleKey(e) {
        if (e.key >= '0' && e.key <= '9') addDigit(e.key)
        if (e.key === 'Backspace') deleteDigit()
        if (e.key === 'Enter') handleAction()
      }
      window.addEventListener('keydown', handleKey)
      return () => window.removeEventListener('keydown', handleKey)
    }
  })

  async function verifyPin(pinToCheck) {
    setLoading(true)
    const res = await fetch('/api/auth/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', email: selectedEmail, pin: pinToCheck })
    })
    const data = await res.json()
    setLoading(false)
    if (data.valid) {
      onLogin({ name: data.name, email: selectedEmail, isAdmin: data.isAdmin })
    } else {
      setError('Incorrect PIN. Please try again.')
      setPin(''); setPinInput('')
    }
  }

  function handleAction() {
    if (step === 'pin') {
      const p = isMobile ? pin : pinInput
      if (p.length === 4) verifyPin(p)
    }
    if (step === 'setup' && pin.length === 4) { setStep('confirm'); setError('') }
    if (step === 'confirm') {
      if (confirmPin.length !== 4) return
      if (pin !== confirmPin) { setError('PINs do not match. Try again.'); setConfirmPin(''); return }
      setLoading(true)
      fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set', email: selectedEmail, newPin: pin })
      }).then(r => r.json()).then(data => {
        setLoading(false)
        if (data.success) onLogin({ name: data.name, email: selectedEmail, isAdmin: data.isAdmin })
        else setError('Failed to set PIN. Please try again.')
      })
    }
  }

  // Desktop PIN input change handler
  function handleDesktopPinChange(e) {
    const val = e.target.value.replace(/\D/g,'').slice(0,4)
    setPinInput(val)
    setError('')
    if (val.length === 4) verifyPin(val)
  }

  // Desktop setup input
  function handleDesktopSetupChange(e, field) {
    const val = e.target.value.replace(/\D/g,'').slice(0,4)
    if (field === 'pin') setPin(val)
    if (field === 'confirm') setConfirmPin(val)
    setError('')
  }

  const currentPin = step === 'confirm' ? confirmPin : pin

  const w = { minHeight:'100vh', maxWidth:'430px', margin:'0 auto', display:'flex', flexDirection:'column', background:'#042746', fontFamily:'-apple-system,sans-serif' }
  const top = { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 24px 20px' }
  const keyStyle = { background:'rgba(255,255,255,0.1)', border:'none', borderRadius:'50%', width:'72px', height:'72px', fontSize:'24px', color:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto' }
  const btnStyle = { width:'100%', padding:'14px', background:'#2ab5a0', border:'none', borderRadius:'10px', color:'white', fontSize:'16px', fontWeight:'600', cursor:'pointer' }
  const desktopInputStyle = { width:'100%', padding:'16px', border:'2px solid rgba(255,255,255,0.2)', borderRadius:'12px', fontSize:'32px', background:'rgba(255,255,255,0.08)', color:'white', outline:'none', textAlign:'center', letterSpacing:'16px', boxSizing:'border-box', fontFamily:'monospace', WebkitTextSecurity: step === 'pin' ? 'disc' : 'disc' }

  const titleMap = { pin: `Hi, ${staff?.name?.split(' ')[0] || ''}`, setup: 'Create your PIN', confirm: 'Confirm your PIN' }
  const hintMap = {
    pin: isMobile ? 'Enter your 4-digit PIN' : 'Type your 4-digit PIN',
    setup: 'Choose a 4-digit PIN for your account',
    confirm: 'Enter your PIN again to confirm'
  }

  if (step === 'select') {
    return (
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
          {!isMobile && (
            <div style={{ marginTop:24, padding:'12px 16px', background:'rgba(42,181,160,0.1)', border:'1px solid rgba(42,181,160,0.3)', borderRadius:10, fontSize:12, color:'rgba(255,255,255,0.6)', textAlign:'center' }}>
              💻 On desktop? Your browser or password manager can save your PIN for quick login.
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={w}>
      <div style={top}>
        <img src="/logo.png" alt="TechnoMed" style={{ height:'48px', width:'auto', marginBottom:'6px' }} />
        <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'32px' }}>Staff Portal</div>
        <div style={{ fontSize:'22px', fontWeight:'700', color:'white', marginBottom:'8px', textAlign:'center' }}>{titleMap[step]}</div>
        <div style={{ fontSize:'14px', color:'rgba(255,255,255,0.55)', marginBottom:'28px', textAlign:'center' }}>{hintMap[step]}</div>

        {/* Desktop: text input that password managers can save */}
        {!isMobile ? (
          <div style={{ width:'100%', marginBottom:16 }}>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete={step === 'pin' ? 'current-password' : 'new-password'}
              id={step === 'pin' ? 'pin-login' : 'pin-setup'}
              name={step === 'pin' ? 'pin' : step === 'setup' ? 'new-pin' : 'confirm-pin'}
              placeholder="····"
              value={step === 'confirm' ? confirmPin : (step === 'pin' ? pinInput : pin)}
              onChange={step === 'pin' ? handleDesktopPinChange : (e) => handleDesktopSetupChange(e, step === 'confirm' ? 'confirm' : 'pin')}
              onKeyDown={e => { if (e.key === 'Enter') handleAction() }}
              style={desktopInputStyle}
              autoFocus
            />
            {error && <div style={{ fontSize:'13px', color:'#ff6b6b', marginTop:8, textAlign:'center' }}>{error}</div>}
            {loading && <div style={{ color:'rgba(255,255,255,0.5)', fontSize:'14px', marginTop:8, textAlign:'center' }}>Please wait...</div>}
            {step !== 'pin' && (step === 'setup' ? pin : confirmPin).length === 4 && !loading && (
              <button style={{ ...btnStyle, marginTop:16 }} onClick={handleAction}>
                {step === 'setup' ? 'Continue →' : 'Set PIN'}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile: dot indicators + keypad */}
            <div style={{ display:'flex', gap:'16px', marginBottom:'12px' }}>
              {[0,1,2,3].map(i => <div key={i} style={{ width:'14px', height:'14px', borderRadius:'50%', background: currentPin.length > i ? '#2ab5a0' : 'transparent', border: currentPin.length > i ? '2px solid #2ab5a0' : '2px solid rgba(255,255,255,0.3)' }} />)}
            </div>
            {error && <div style={{ fontSize:'13px', color:'#ff6b6b', marginBottom:'16px', textAlign:'center' }}>{error}</div>}
            {loading && <div style={{ color:'rgba(255,255,255,0.5)', fontSize:'14px' }}>Please wait...</div>}
          </>
        )}
      </div>

      {/* Mobile keypad only */}
      {isMobile && (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', padding:'0 32px 16px' }}>
            {[1,2,3,4,5,6,7,8,9].map(n => <button key={n} style={keyStyle} onClick={() => addDigit(String(n))}>{n}</button>)}
            <div />
            <button style={keyStyle} onClick={() => addDigit('0')}>0</button>
            <button style={{ ...keyStyle, background:'transparent', fontSize:'22px', color:'rgba(255,255,255,0.6)' }} onClick={deleteDigit}>⌫</button>
          </div>
          {currentPin.length === 4 && !loading && (
            <div style={{ padding:'0 32px 16px' }}>
              <button style={btnStyle} onClick={handleAction}>{step === 'pin' ? 'Sign in' : step === 'setup' ? 'Continue' : 'Set PIN'}</button>
            </div>
          )}
        </>
      )}

      <div style={{ display:'flex', justifyContent:'center', paddingBottom:'32px' }}>
        <button style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.4)', fontSize:'14px', cursor:'pointer', padding:'12px' }}
          onClick={() => { setStep('select'); setSelectedEmail(''); setPin(''); setConfirmPin(''); setError(''); setPinInput('') }}>← Back</button>
      </div>
    </div>
  )
}
