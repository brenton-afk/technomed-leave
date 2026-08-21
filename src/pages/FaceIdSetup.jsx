import React, { useState, useEffect, useMemo } from 'react'
import {
  startRegistration, browserSupportsWebAuthn, platformAuthenticatorIsAvailable
} from '@simplewebauthn/browser'

const NAVY = '#042746'
const TEAL = '#189a85'
const MUTED = '#6b7a8d'
const BORDER = 'rgba(26,43,74,0.12)'
const DISMISS_KEY = 'tm_faceid_dismissed'

// Offers to enrol this device for Face ID / Touch ID, once, on the home screen.
// Enrolment requires the session that the PIN just created, which is what makes
// it safe: only someone who already knows the PIN can add a passkey.
export default function FaceIdSetup({ user }) {
  const [state, setState] = useState('checking') // checking | offer | busy | done | hidden
  const [error, setError] = useState('')

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])

  useEffect(() => { check() }, [])

  async function check() {
    if (localStorage.getItem(DISMISS_KEY) === user?.email) { setState('hidden'); return }
    if (!browserSupportsWebAuthn()) { setState('hidden'); return }
    try {
      // Only offer this where the device itself can do biometrics — a desktop
      // without a platform authenticator would just show a confusing prompt.
      if (!(await platformAuthenticatorIsAvailable())) { setState('hidden'); return }
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'passkey-list' })
      })
      const data = await res.json()
      if (data.error) { setState('hidden'); return }
      setState((data.passkeys || []).length > 0 ? 'hidden' : 'offer')
    } catch {
      setState('hidden')
    }
  }

  async function enable() {
    setState('busy'); setError('')
    try {
      const optRes = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ action: 'passkey-register-options' })
      })
      const optData = await optRes.json()
      if (optData.error) throw new Error(optData.error)

      const attestation = await startRegistration({ optionsJSON: optData.options })

      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          action: 'passkey-register',
          response: attestation,
          label: /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'This device'
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setState('done')
    } catch (err) {
      const cancelled = /NotAllowedError|abort|cancel/i.test(`${err?.name} ${err?.message}`)
      setError(cancelled ? '' : (err.message || 'Could not set up Face ID on this device.'))
      setState('offer')
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, user?.email || '1')
    setState('hidden')
  }

  if (state === 'checking' || state === 'hidden') return null

  if (state === 'done') {
    return (
      <div style={{ margin: '12px 16px 0', background: '#e6f4f2', border: '1px solid rgba(24,154,133,0.3)', borderRadius: 12, padding: '13px 15px', display: 'flex', gap: 11, alignItems: 'center' }}>
        <span style={{ fontSize: 20 }}>✓</span>
        <div style={{ fontSize: 13, color: TEAL, lineHeight: 1.5 }}>
          <strong>Face ID is on for this device.</strong><br />
          <span style={{ color: MUTED }}>Next time, sign in with a glance. Your PIN still works too.</span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ margin: '12px 16px 0', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12, padding: 15 }}>
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ fontSize: 22, lineHeight: 1.1 }}>🔐</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, marginBottom: 3 }}>Sign in with Face ID</div>
          <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
            Use Face ID, Touch ID or your device passcode instead of typing your PIN.
            Only on this device — your PIN keeps working everywhere.
          </div>
        </div>
      </div>
      {error && (
        <div style={{ background: '#fdecea', color: '#c0392b', borderRadius: 8, padding: '9px 11px', fontSize: 12, marginBottom: 10, lineHeight: 1.45 }}>{error}</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={dismiss} disabled={state === 'busy'}
          style={{ flex: 1, padding: 11, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 9, fontSize: 13, color: MUTED, cursor: 'pointer' }}>
          Not now
        </button>
        <button onClick={enable} disabled={state === 'busy'}
          style={{ flex: 2, padding: 11, background: state === 'busy' ? '#c8d2dc' : TEAL, color: 'white', border: 'none', borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: state === 'busy' ? 'default' : 'pointer' }}>
          {state === 'busy' ? 'Waiting for Face ID…' : 'Turn on Face ID'}
        </button>
      </div>
    </div>
  )
}
