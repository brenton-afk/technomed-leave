import React, { useState, useEffect, useCallback } from 'react'
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { colour as tokenColour } from '../design/tokens.js'

// ─── Opening the app when you are already signed in ──────────────────────────
// The session lasts a month and lives on the device, so the thing between a
// phone somebody has picked up and a list of patients is the phone's own
// biometric. That is the trade that makes a month-long session reasonable, and
// it is the arrangement every banking app on the same phone already uses.
//
// It is never a dead end. Face ID is attempted on its own, because asking
// somebody to tap a button to get a prompt that then asks them again is two
// steps for one decision — but a device that cannot do it, or a person whose
// face it will not take, always has the PIN.

const NAVY = tokenColour.navy
const TEAL = tokenColour.accent

export default function LockScreen({ user, onUnlock, onUsePin }) {
  const [state, setState] = useState('trying')   // trying | failed | unsupported
  const [tries, setTries] = useState(0)

  const unlock = useCallback(async () => {
    setState('trying')
    try {
      const optRes = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'passkey-login-options', email: user?.email })
      })
      const optData = await optRes.json()
      if (optData.error) throw new Error(optData.error)

      const assertion = await startAuthentication({ optionsJSON: optData.options })

      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'passkey-login', email: user?.email, response: assertion
        })
      })
      const data = await res.json()
      if (!data.valid) throw new Error(data.error || 'That did not work')
      onUnlock()
    } catch {
      // Cancelled, no passkey on this device, or a face it would not take.
      // All of them mean the same thing here: offer it again, and offer the
      // PIN. Nothing is said about which, because the difference is not
      // actionable and a specific message would only be a hint to somebody
      // holding a phone that is not theirs.
      setState('failed')
    }
  }, [user?.email, onUnlock])

  useEffect(() => {
    if (!browserSupportsWebAuthn()) { setState('unsupported'); return }
    unlock()
    // Once, on open. Retrying is a tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries])

  const first = (user?.name || '').split(' ')[0]

  return (
    <div style={{
      minHeight: '100%', background: NAVY, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 28, textAlign: 'center'
    }}>
      <img src="/logo.png" alt="TechnoMed" style={{ height: 40, marginBottom: 28 }} />

      <div style={{
        width: 64, height: 64, borderRadius: '50%', marginBottom: 18,
        background: 'rgba(42,181,160,0.18)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 25
      }} aria-hidden="true">
        {state === 'trying' ? '◌' : '🔒'}
      </div>

      <div style={{ fontSize: 19, fontWeight: 700, color: 'white', marginBottom: 6 }}>
        {first ? `Welcome back, ${first}` : 'Welcome back'}
      </div>
      <div style={{
        fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6,
        maxWidth: 300, marginBottom: 26
      }}>
        {state === 'trying' && 'Unlocking…'}
        {state === 'failed' && 'Unlock to see the cases.'}
        {state === 'unsupported' && 'This device cannot unlock with Face ID.'}
      </div>

      {state !== 'trying' && state !== 'unsupported' && (
        <button onClick={() => setTries(n => n + 1)}
          style={{
            width: '100%', maxWidth: 300, padding: 15, borderRadius: 10, border: 'none',
            background: TEAL, color: 'white', fontSize: 16, fontWeight: 700,
            cursor: 'pointer', marginBottom: 10
          }}>
          Unlock
        </button>
      )}

      <button onClick={onUsePin}
        style={{
          width: '100%', maxWidth: 300, padding: 14, borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.22)', background: 'transparent',
          color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 600, cursor: 'pointer'
        }}>
        Use my PIN instead
      </button>
    </div>
  )
}
