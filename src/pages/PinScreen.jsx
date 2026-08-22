import React, { useState, useEffect } from 'react'
import { STAFF } from '../staffConfig.js'
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'

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

// Which build is actually running. Tapping it forces a reload that bypasses
// the cache, which is the fix when a phone is holding on to an older version.
function BuildStamp() {
  const built = new Date(__APP_BUILT_AT__)
  const when = built.toLocaleString('en-AU', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    timeZone: 'Australia/Hobart'
  })
  return (
    <button
      onClick={() => { window.location.href = `/?r=${Date.now()}` }}
      style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.28)', fontSize:10.5, padding:'0 0 18px', width:'100%', textAlign:'center', cursor:'pointer', letterSpacing:'0.3px' }}>
      build {__APP_COMMIT__} · {when} · tap to refresh
    </button>
  )
}

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
  const [requesting, setRequesting] = useState(false)
  const [resetRequested, setResetRequested] = useState(false)
  const [passkeyAvailable, setPasskeyAvailable] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  // idle → attempting → done | failed. Face ID is offered without a tap, but a
  // browser may refuse a WebAuthn call that is not tied to a fresh user gesture,
  // and a cancelled prompt looks the same from here — so either way the button
  // appears as a fallback rather than retrying in a loop.
  const [passkeyAuto, setPasskeyAuto] = useState('idle')

  // Face ID / Touch ID / device passcode. Additive only: the PIN keypad stays
  // on screen, so a device that cannot do this is never locked out.
  useEffect(() => {
    if (step !== 'pin' || !passkeyAvailable || passkeyAuto !== 'idle') return
    setPasskeyAuto('attempting')
    signInWithPasskey({ auto: true })
  }, [step, passkeyAvailable, passkeyAuto])

  async function signInWithPasskey({ auto = false } = {}) {
    setPasskeyBusy(true); setError('')
    try {
      const optRes = await fetch('/api/auth/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'passkey-login-options', email: selectedEmail })
      })
      const optData = await optRes.json()
      if (optData.error) throw new Error(optData.error)

      const assertion = await startAuthentication({ optionsJSON: optData.options })

      const res = await fetch('/api/auth/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'passkey-login', email: selectedEmail, response: assertion })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onLogin({ name: data.name, email: selectedEmail, isAdmin: data.isAdmin, staff: data.staff, token: data.token })
    } catch (err) {
      // A cancelled prompt, or a browser declining an ungestured call, is not
      // worth shouting about — the keypad is right there.
      const cancelled = /NotAllowedError|abort|cancel/i.test(`${err?.name} ${err?.message}`)
      if (!cancelled) setError(err.message || 'Face ID sign-in failed. Use your PIN instead.')
      if (auto) setPasskeyAuto('failed')
    }
    setPasskeyBusy(false)
  }

  // Asks the admins to clear this PIN. Grants no access by itself — the staff
  // member still has to wait for the reset — so it is safe from the sign-in
  // screen, which is the only place a locked-out person can reach.
  async function requestReset() {
    setRequesting(true); setError('')
    try {
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-reset', email: selectedEmail })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResetRequested(true)
    } catch (err) {
      setError(`Could not send the request (${err.message}). Call Brenton or Erin instead.`)
    }
    setRequesting(false)
  }

  // Asks the server whether this person already has a PIN, and routes to
  // either sign-in or first-time setup. Every failure path has to land
  // somewhere visible: previously an error here left the user on the select
  // screen with no spinner and no message, which looked like the app simply
  // not recognising them.
  async function handleStaffSelect(email) {
    setSelectedEmail(email); setPin(''); setConfirmPin(''); setError(''); setPinInput('')
    setResetRequested(false)
    setPasskeyAuto('idle')
    setChecking(true)
    try {
      const ask = body => fetch('/api/auth/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json())

      // Both lookups go out together. Sequentially, the Face ID prompt only
      // appeared after two round trips, which was long enough to feel like the
      // app was waiting for a tap.
      const canUsePasskey = browserSupportsWebAuthn()
      const [data, passkey] = await Promise.all([
        ask({ action: 'check', email }),
        canUsePasskey ? ask({ action: 'passkey-available', email }).catch(() => ({})) : Promise.resolve({})
      ])
      if (data.error) throw new Error(data.error)
      setFirstTime(!data.hasPin)
      setPasskeyAvailable(Boolean(data.hasPin && canUsePasskey && passkey.available))
      // Never signed in → the welcome screen, which explains what the portal
      // is before asking them to invent a PIN. Already enrolled → straight to
      // the keypad.
      setStep(data.hasPin ? 'pin' : 'welcome')
    } catch (err) {
      // Clearing the selection matters: the <select> only fires onChange when
      // the value changes, so without this, picking the same name again to
      // retry would do nothing.
      setSelectedEmail('')
      setError(`Could not reach the server (${err.message}). Check your connection and select your name again.`)
    }
    setChecking(false)
  }

  // Four digits submits on its own. Tapping a separate "Sign in" afterwards was
  // pure friction — the PIN is a fixed length, so completion is unambiguous.
  function addDigit(d) {
    if (loading) return
    if (step === 'confirm') {
      if (confirmPin.length >= 4) return
      const next = confirmPin + d
      setConfirmPin(next)
      if (next.length === 4) submitNewPin(pin, next)
      return
    }
    if (pin.length >= 4) return
    const next = pin + d
    setPin(next)
    if (next.length !== 4) return
    if (step === 'pin') verifyPin(next)
    else if (step === 'setup') { setStep('confirm'); setError('') }
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
    if (step === 'confirm') submitNewPin(pin, confirmPin)
  }

  function submitNewPin(chosen, confirmValue) {
    if (confirmValue.length !== 4) return
    if (chosen !== confirmValue) { setError('PINs do not match. Try again.'); setConfirmPin(''); return }
    {
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
    if (val.length !== 4) return
    if (field === 'pin' && step === 'setup') setStep('confirm')
    if (field === 'confirm') submitNewPin(pin, val)
  }

  const currentPin = step === 'confirm' ? confirmPin : pin

  const w = { minHeight:'100vh', display:'flex', flexDirection:'column', background:'#042746', fontFamily:'-apple-system,sans-serif', width:'100%', maxWidth:460, margin:'0 auto' }
  const top = { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 24px 20px', width:'100%', maxWidth:360, margin:'0 auto', boxSizing:'border-box' }
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

  // ─── Start page: first time this person has ever signed in ───
  if (step === 'welcome') {
    const features = [
      { icon: '📅', title: 'Today', body: "Your bookings and who's on leave this week" },
      { icon: '🏖', title: 'Leave', body: 'Apply for annual, personal or TOIL leave' },
      ...(staff?.hasTimesheets
        ? [{ icon: '💰', title: 'Timesheets', body: 'Enter your fortnightly hours for payroll' }]
        : []),
      { icon: '📷', title: 'Usage', body: 'Scan hospital usage forms straight from theatre' },
      { icon: '🔧', title: 'Kit Room', body: 'What kit is where, across both hospitals' }
    ]

    return (
      <div style={{ ...w, overflowY: 'auto' }}>
        <div style={{ padding: '48px 24px 24px', textAlign: 'center' }}>
          <img src="/logo.png" alt="TechnoMed" style={{ height: '46px', width: 'auto', marginBottom: '6px' }} />
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Staff Portal</div>
        </div>

        <div style={{ padding: '0 24px' }}>
          <div style={{ fontSize: '11px', color: '#2ab5a0', letterSpacing: '1.2px', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
            First time here
          </div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: 'white', marginBottom: 8, lineHeight: 1.25 }}>
            Welcome, {staff?.name?.split(' ')[0]}
          </div>
          <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.65, marginBottom: 26 }}>
            This is your TechnoMed staff portal. You haven't signed in before, so
            let's set up a 4-digit PIN — that's all you'll need from now on.
          </div>

          <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: '6px 4px', marginBottom: 22 }}>
            {features.map((f, i) => (
              <div key={f.title} style={{ display: 'flex', gap: 13, alignItems: 'flex-start', padding: '13px 14px', borderBottom: i < features.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                <span style={{ fontSize: 19, lineHeight: 1.15, flexShrink: 0 }}>{f.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'white', marginBottom: 2 }}>{f.title}</div>
                  <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{f.body}</div>
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => { setStep('setup'); setPin(''); setConfirmPin(''); setError('') }}
            style={{ ...btnStyle, padding: '16px', fontSize: '16px', fontWeight: 700, marginBottom: 12 }}>
            Create my PIN →
          </button>

          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 1.6, paddingBottom: 20 }}>
            Signing in as {staff?.email}.<br />
            Not you? <span onClick={() => { setStep('select'); setSelectedEmail(''); setFirstTime(false) }}
              style={{ color: '#2ab5a0', cursor: 'pointer', textDecoration: 'underline' }}>Choose a different name</span>
          </div>
        </div>
      </div>
    )
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

        <BuildStamp />
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
          {/* Only a fallback now — completing four digits already submits. */}
          {currentPin.length === 4 && !loading && step !== 'pin' && (
            <div style={{ padding:'0 32px 16px' }}>
              <button style={btnStyle} onClick={handleAction}>{step === 'setup' ? 'Continue' : 'Set PIN'}</button>
            </div>
          )}
        </>
      )}

      {step === 'pin' && passkeyAvailable && (
        <div style={{ padding:'0 28px 12px' }}>
          {passkeyAuto === 'failed' ? (
            <button onClick={() => signInWithPasskey()} disabled={passkeyBusy || loading}
              style={{ width:'100%', padding:'14px', background:'#2ab5a0', border:'none', borderRadius:12, color:'white', fontSize:15, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:9 }}>
              <span style={{ fontSize:17 }}>🔐</span>
              {passkeyBusy ? 'Waiting for Face ID…' : 'Try Face ID again'}
            </button>
          ) : (
            <div style={{ textAlign:'center', fontSize:13, color:'rgba(255,255,255,0.55)', padding:'4px 0 2px' }}>
              <span style={{ marginRight:7 }}>🔐</span>Waiting for Face ID…
            </div>
          )}
          <div style={{ textAlign:'center', fontSize:11, color:'rgba(255,255,255,0.3)', marginTop:8 }}>
            or enter your PIN below
          </div>
        </div>
      )}

      {step === 'pin' && (
        <div style={{ padding:'0 28px 10px' }}>
          {resetRequested ? (
            <div style={{ background:'rgba(42,181,160,0.12)', border:'1px solid rgba(42,181,160,0.35)', borderRadius:12, padding:'14px 16px', fontSize:13, color:'rgba(255,255,255,0.85)', lineHeight:1.6, textAlign:'center' }}>
              ✓ Brenton and Erin have been asked to reset your PIN.<br />
              <span style={{ color:'rgba(255,255,255,0.5)', fontSize:12 }}>
                Once they do, come back here and you'll be able to create a new one.
              </span>
            </div>
          ) : (
            <button onClick={requestReset} disabled={requesting}
              style={{ width:'100%', padding:'13px', background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.18)', borderRadius:12, color:'rgba(255,255,255,0.75)', fontSize:13.5, cursor:'pointer', lineHeight:1.4 }}>
              {requesting ? 'Sending…' : "I don't know my PIN"}
            </button>
          )}
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'center', paddingBottom:'32px' }}>
        <button style={{ background:'transparent', border:'none', color:'rgba(255,255,255,0.4)', fontSize:'14px', cursor:'pointer', padding:'12px' }}
          onClick={() => { setStep('select'); setSelectedEmail(''); setPin(''); setConfirmPin(''); setError(''); setPinInput(''); setFirstTime(false); setResetRequested(false); setPasskeyAuto('idle') }}>← Back</button>
      </div>
    </div>
  )
}
