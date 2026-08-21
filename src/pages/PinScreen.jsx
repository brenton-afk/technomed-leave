import React, { useState, useEffect } from 'react'
import { STAFF } from '../staffConfig.js'

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

const QUOTES = [
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Great things are never done by one person. They are done by a team.', author: 'Steve Jobs' },
  { text: 'Take care of your team and they will take care of everything else.', author: 'Richard Branson' },
  { text: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', author: 'Winston Churchill' },
  { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  { text: 'Alone we can do so little; together we can do so much.', author: 'Helen Keller' },
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela' },
  { text: 'In the middle of every difficulty lies opportunity.', author: 'Albert Einstein' },
  { text: 'Believe you can and you are halfway there.', author: 'Theodore Roosevelt' },
  { text: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
  { text: 'The patient is not an interruption of our work. The patient is the purpose of it.', author: 'Unknown' },
  { text: 'Coming together is a beginning. Staying together is progress. Working together is success.', author: 'Henry Ford' },
  { text: 'The strength of the team is each individual member. The strength of each member is the team.', author: 'Phil Jackson' },
  { text: 'Precision in medicine begins with precision in preparation.', author: 'TechnoMed' },
  { text: 'Every patient deserves our very best. Every single time.', author: 'TechnoMed' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { text: 'Excellence is not a destination but a continuous journey.', author: 'Brian Tracy' },
  { text: 'Small acts of kindness can change the world.', author: 'Kobi Yamada' },
]

export default function PinScreen({ onLogin }) {
  const [step, setStep] = useState('select')
  const [selectedEmail, setSelectedEmail] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)])
  const [pinInput, setPinInput] = useState('')

  const staff = STAFF.find(s => s.email === selectedEmail)

  // Whether this is a first-ever sign-in, so the setup screen can say so
  // rather than just presenting an unexplained "create a PIN".
  const [firstTime, setFirstTime] = useState(false)
  const [checking, setChecking] = useState(false)

  // Asks the server whether this person already has a PIN, and routes to
  // either sign-in or first-time setup. Every failure path has to land
  // somewhere visible: previously an error here left the user on the select
  // screen with no spinner and no message, which looked like the app simply
  // not recognising them.
  async function handleStaffSelect(email) {
    setSelectedEmail(email); setPin(''); setConfirmPin(''); setError(''); setPinInput('')
    setChecking(true)
    try {
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', email })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setFirstTime(!data.hasPin)
      setStep(data.hasPin ? 'pin' : 'setup')
    } catch (err) {
      // Clearing the selection matters: the <select> only fires onChange when
      // the value changes, so without this, picking the same name again to
      // retry would do nothing.
      setSelectedEmail('')
      setError(`Could not reach the server (${err.message}). Check your connection and select your name again.`)
    }
    setChecking(false)
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
    try {
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', email: selectedEmail, pin: pinToCheck })
      })
      const data = await res.json()
      if (data.valid) {
        onLogin({ name: data.name, email: selectedEmail, isAdmin: data.isAdmin, staff: data.staff, token: data.token })
      } else if (data.needsSetup) {
        // The PIN was cleared between selecting a name and typing — send them
        // to setup instead of claiming the PIN was wrong.
        setFirstTime(true); setStep('setup'); setPin(''); setPinInput('')
        setError('')
      } else {
        setError('Incorrect PIN. Please try again.')
        setPin(''); setPinInput('')
      }
    } catch (err) {
      // Without this the spinner used to run forever on a dropped request.
      setError('Could not reach the server. Check your connection and try again.')
      setPin(''); setPinInput('')
    }
    setLoading(false)
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
        if (data.success) onLogin({ name: data.name, email: selectedEmail, isAdmin: data.isAdmin, staff: data.staff, token: data.token })
        else {
          setError(data.error || 'Failed to set PIN. Please try again.')
          setPin(''); setConfirmPin(''); setStep('setup')
        }
      }).catch(() => {
        setLoading(false)
        setError('Could not reach the server. Check your connection and try again.')
        setConfirmPin('')
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

  const w = { minHeight:'100vh',  display:'flex', flexDirection:'column', background:'#042746', fontFamily:'-apple-system,sans-serif' }
  const top = { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 24px 20px' }
  const keyStyle = { background:'rgba(255,255,255,0.1)', border:'none', borderRadius:'50%', width:'72px', height:'72px', fontSize:'24px', color:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto' }
  const btnStyle = { width:'100%', padding:'14px', background:'#2ab5a0', border:'none', borderRadius:'10px', color:'white', fontSize:'16px', fontWeight:'600', cursor:'pointer' }
  const desktopInputStyle = { width:'100%', padding:'16px', border:'2px solid rgba(255,255,255,0.2)', borderRadius:'12px', fontSize:'32px', background:'rgba(255,255,255,0.08)', color:'white', outline:'none', textAlign:'center', letterSpacing:'16px', boxSizing:'border-box', fontFamily:'monospace', WebkitTextSecurity: step === 'pin' ? 'disc' : 'disc' }

  const titleMap = {
    pin: `Hi, ${staff?.name?.split(' ')[0] || ''}`,
    setup: firstTime ? `Welcome, ${staff?.name?.split(' ')[0] || ''}` : 'Create your PIN',
    confirm: 'Confirm your PIN'
  }
  const hintMap = {
    pin: isMobile ? 'Enter your 4-digit PIN' : 'Type your 4-digit PIN',
    setup: firstTime
      ? "First time signing in — choose a 4-digit PIN you'll use from now on"
      : 'Choose a 4-digit PIN for your account',
    confirm: 'Enter your PIN again to confirm'
  }

  if (step === 'select') {
    return (
      <div style={w}>
        <div style={top}>
          <img src="/logo.png" alt="TechnoMed" style={{ height:'48px', width:'auto', marginBottom:'6px' }} />
          <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'32px' }}>Staff Portal</div>
          <div style={{ fontSize:'22px', fontWeight:'700', color:'white', marginBottom:'8px' }}>Welcome</div>
          <div style={{ fontSize:'14px', color:'rgba(255,255,255,0.55)', marginBottom:'20px' }}>Select your name to sign in</div>
        <div style={{ background:'rgba(255,255,255,0.06)', borderRadius:12, padding:'16px 18px', marginBottom:'24px', borderLeft:'3px solid #2ab5a0' }}>
          <div style={{ fontSize:13, color:'rgba(255,255,255,0.75)', lineHeight:1.7, fontStyle:'italic', marginBottom:6 }}>{quote.text}</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', letterSpacing:'0.5px' }}>— {quote.author}</div>
        </div>
          <div style={{ position:'relative', width:'100%' }}>
            <select disabled={checking}
              style={{ width:'100%', padding:'12px 14px', border:'1px solid rgba(255,255,255,0.2)', borderRadius:'10px', fontSize:'15px', background:'rgba(255,255,255,0.08)', color:'white', outline:'none', appearance:'none', WebkitAppearance:'none', boxSizing:'border-box', opacity: checking ? 0.6 : 1 }}
              value={selectedEmail} onChange={e => e.target.value && handleStaffSelect(e.target.value)}>
              <option value="">Select your name...</option>
              {STAFF.map(s => <option key={s.email} value={s.email}>{s.name}</option>)}
            </select>
            <div style={{ position:'absolute', right:'14px', top:'50%', transform:'translateY(-50%)', pointerEvents:'none', borderLeft:'5px solid transparent', borderRight:'5px solid transparent', borderTop:'6px solid rgba(255,255,255,0.5)' }} />
          </div>

          {checking && (
            <div style={{ marginTop:16, fontSize:13, color:'rgba(255,255,255,0.55)', textAlign:'center' }}>
              Checking your account…
            </div>
          )}
          {error && (
            <div style={{ marginTop:16, padding:'12px 14px', background:'rgba(255,107,107,0.12)', border:'1px solid rgba(255,107,107,0.35)', borderRadius:10, fontSize:13, color:'#ffb3b3', lineHeight:1.5, textAlign:'center' }}>
              {error}
            </div>
          )}
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

      {step === 'pin' && (
        <div style={{ padding:'0 32px 8px', textAlign:'center', fontSize:12, color:'rgba(255,255,255,0.4)', lineHeight:1.6 }}>
          Forgotten your PIN? Ask Brenton or Erin to reset it in the Admin portal,
          then sign in and choose a new one.
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'center', paddingBottom:'32px' }}>
        <button style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.4)', fontSize:'14px', cursor:'pointer', padding:'12px' }}
          onClick={() => { setStep('select'); setSelectedEmail(''); setPin(''); setConfirmPin(''); setError(''); setPinInput(''); setFirstTime(false) }}>← Back</button>
      </div>
    </div>
  )
}
