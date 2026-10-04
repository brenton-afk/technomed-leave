import React, { useState, useEffect, useCallback } from 'react'
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { colour as tokenColour } from '../design/tokens.js'

// ─── Stepping up, for the administration side ────────────────────────────────
// This used to stand in front of the whole app on every cold open, and it was
// wrong: the phone or laptop is already locked by its operating system, so a
// second check to look at a case list taxed the ninety-nine opens where
// nothing was wrong to catch none of them.
//
// It guards the admin portal now, which holds everybody's pay, everybody's
// PINs and the system settings. Step up where the stakes are, rather than
// taxing every screen equally.
//
// It is never a dead end. Face ID is attempted on its own, because asking
// somebody to tap a button to get a prompt that then asks them again is two
// steps for one decision — a device that cannot do it has the PIN, and
// somebody who tapped Admin by mistake has a way back that is not signing
// out.

const NAVY = tokenColour.navy
const TEAL = tokenColour.accent

export default function LockScreen({ user, onUnlock, onUsePin, reason, onCancel }) {
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
        {state === 'failed' && (reason || 'Unlock to carry on.')}
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

      {/* A way out that is not signing out. Somebody who tapped Admin by
          mistake should not have to re-authenticate to get back to the cases. */}
      {onCancel && (
        <button onClick={onCancel}
          style={{
            marginTop: 10, background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.5)', fontSize: 14, padding: 10
          }}>
          Not now
        </button>
      )}
    </div>
  )
}
