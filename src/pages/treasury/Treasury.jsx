import React, { useCallback, useEffect, useState } from 'react'
import { Page, Header, Body, Button, EmptyState } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { IconLock } from '../../design/icons.jsx'
import LockScreen from '../LockScreen.jsx'
import { treasuryCall, Field, fieldBox, Problem } from './ui.jsx'
import Home from './Home.jsx'
import Bitcoin from './Bitcoin.jsx'
import Holdings from './Holdings.jsx'
import Dca from './Dca.jsx'
import Cash from './Cash.jsx'
import Trust from './Trust.jsx'
import Snapshots from './Snapshots.jsx'
import Settings from './Settings.jsx'
import Purchases from './Purchases.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── The Treasury section ────────────────────────────────────────────────────
// Private: brenton@ (and whoever else is on TREASURY_USERS). The server is what
// enforces that — this screen only asks it. Anyone else who somehow lands here
// gets the server's 404 and a way back, and never sees a figure.
//
// Opening it asks for Face ID, or the PIN. The phone gets a fresh sign-in from
// that and hands it to the server, which unlocks this session for fifteen
// minutes of use (see api/_treasuryAccess.js). When that runs out, any screen
// that is refused comes back here to ask again.

const SCREENS = { home: Home, bitcoin: Bitcoin, holdings: Holdings, dca: Dca, cash: Cash, trust: Trust, snapshots: Snapshots, settings: Settings, purchases: Purchases }

async function unlockWith(user, proofToken) {
  const res = await fetch('/api/treasury?action=unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${proofToken}` },
    body: JSON.stringify({ mainToken: user.token })
  })
  if (!res.ok) throw new Error('That did not unlock it.')
}

function PinUnlock({ user, onDone, onCancel }) {
  const [pin, setPin] = useState('')
  const [problem, setProblem] = useState(null)
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true); setProblem(null)
    try {
      const res = await fetch('/api/auth/pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', email: user.email, pin })
      })
      const data = await res.json()
      if (!data.valid || !data.token) throw new Error('That PIN did not work.')
      await unlockWith(user, data.token)
      onDone()
    } catch (err) { setProblem(err.message); setPin('') } finally { setBusy(false) }
  }
  return (
    <Page>
      <Header eyebrow="Treasury" title="Enter your PIN" onBack={onCancel} />
      <Body>
        <Problem>{problem}</Problem>
        <Field label="PIN">
          <input style={inputStyle} type="password" inputMode="numeric" autoComplete="current-password" maxLength={4} autoFocus
            value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && pin.length === 4) go() }} />
        </Field>
        <Button disabled={pin.length !== 4 || busy} onClick={go}>Unlock</Button>
      </Body>
    </Page>
  )
}

export default function Treasury({ user, onBack, notice }) {
  // checking | lock | pin | open | absent
  const [state, setState] = useState('checking')
  const [screen, setScreen] = useState(notice ? 'settings' : 'home')
  const [problem, setProblem] = useState(null)

  useEffect(() => {
    let live = true
    treasuryCall(user, 'access')
      .then(r => { if (live) setState(r.unlocked ? 'open' : 'lock') })
      .catch(() => { if (live) setState('absent') })
    return () => { live = false }
  }, [user])

  const onLocked = useCallback(() => setState('lock'), [])
  const go = useCallback(s => { setScreen(s); window.scrollTo?.(0, 0) }, [])

  async function lockNow() {
    try { await treasuryCall(user, 'lock', { method: 'POST' }) } catch { /* locked either way */ }
    setState('lock')
    onBack()
  }

  if (state === 'checking') {
    return <Page><Header eyebrow="Private" title="Treasury" onBack={onBack} subtitle="Checking…" /></Page>
  }

  if (state === 'absent') {
    return (
      <Page>
        <Header title="Not available" onBack={onBack} />
        <Body><EmptyState icon={IconLock} title="Nothing here" detail="This section is not available." /></Body>
      </Page>
    )
  }

  if (state === 'lock') {
    return (
      <div style={{ height: '100%' }}>
        <LockScreen user={user}
          reason="Treasury holds the company's finances."
          onUnlock={async data => {
            setProblem(null)
            try { await unlockWith(user, data?.token); setState('open') } catch (err) { setProblem(err.message); setState('pin') }
          }}
          onUsePin={() => setState('pin')}
          onCancel={onBack} />
      </div>
    )
  }

  if (state === 'pin') {
    return (
      <>
        {problem && <div style={{ ...text('caption'), color: colour.warning, padding: space.md }}>{problem}</div>}
        <PinUnlock user={user} onDone={() => setState('open')} onCancel={onBack} />
      </>
    )
  }

  const Screen = SCREENS[screen] || Home
  return (
    <Screen user={user} go={go} onLocked={onLocked} onLock={lockNow} notice={notice}
      onBack={screen === 'home' ? onBack : () => go('home')} />
  )
}
