import React, { useState } from 'react'
import { Page, Header, Body, Card, SectionLabel, Button, Banner } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud } from '../../treasury/logic.js'
import { useTreasury, Field, fieldBox, Table, Note, Problem, SmallButton, treasuryCall, Locked, when } from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── Settings, import and audit ──────────────────────────────────────────────

export const OPEN_ON_TREASURY = 'tm_open_treasury'

function readPref() {
  try { return localStorage.getItem(OPEN_ON_TREASURY) === '1' } catch { return false }
}

export default function Settings({ user, onBack, onLocked, onLock, notice }) {
  const status = useTreasury(user, 'status', { onLocked, page: 'settings' })
  const audit = useTreasury(user, 'audit', { onLocked, page: 'audit' })
  const settings = useTreasury(user, 'dca', { onLocked })
  const [msg, setMsg] = useState(null)
  const [openHere, setOpenHere] = useState(readPref)
  const [manual, setManual] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [imported, setImported] = useState(null)
  const x = status.data?.xero

  async function call(action, body) {
    setMsg(null)
    try { return await treasuryCall(user, action, { method: 'POST', body }) } catch (err) {
      if (err instanceof Locked) onLocked(); else setMsg(err.message)
      return null
    }
  }

  async function connect() {
    const r = await call('xero-connect')
    if (r?.url) window.location.href = r.url
    else if (r?.error) setMsg(r.error)
  }

  async function choose(e) {
    setPreview(null); setImported(null); setMsg(null)
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const json = JSON.parse(await f.text())
      setFile(json)
      setPreview(await call('import-preview', { json }))
    } catch { setMsg('That file is not JSON. Export the tracker again and choose the .json file.') }
    e.target.value = ''
  }

  function togglePref() {
    const next = !openHere
    try { next ? localStorage.setItem(OPEN_ON_TREASURY, '1') : localStorage.removeItem(OPEN_ON_TREASURY) } catch { /* private mode */ }
    setOpenHere(next)
  }

  return (
    <Page>
      <Header eyebrow="Treasury" title="Settings" onBack={onBack} />
      <Body>
        {notice === 'xero-connected' && <Banner>Xero is connected. Figures load on the Treasury home.</Banner>}
        {notice === 'xero-failed' && <Banner tone="warning">Xero did not finish connecting. Try again, and choose TechnoMed Pty Ltd when Xero asks.</Banner>}
        {status.data && !status.data.encryption && <Banner tone="danger">TREASURY_ENC_KEY is not set in Vercel, so nothing can be saved.</Banner>}
        <Problem>{msg}</Problem>

        <SectionLabel style={{ marginTop: 0 }}>Xero (read-only)</SectionLabel>
        <Card>
          {x ? (
            <>
              <div style={{ ...text('bodyStrong'), color: colour.ink }}>
                {x.connected ? `Connected to ${x.tenantName}` : x.configured ? 'Not connected' : 'Not set up'}
              </div>
              <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.md }}>
                {x.connected ? `Since ${when(x.connectedAt)}. Read access only — nothing here can change the books.`
                  : x.configured ? 'Connect, sign in to Xero and approve TechnoMed Pty Ltd.'
                    : 'TREASURY_XERO_CLIENT_ID, _SECRET and _REDIRECT_URI need adding in Vercel first.'}
              </div>
              {x.configured && <Button onClick={connect}>{x.connected ? 'Reconnect Xero' : 'Connect Xero'}</Button>}
              {x.connected && <><div style={{ height: space.sm }} /><Button variant="quiet" onClick={async () => { if (window.confirm('Disconnect Xero from the Treasury?')) { await call('xero-disconnect'); status.reload() } }}>Disconnect</Button></>}
            </>
          ) : <Note>Loading…</Note>}
        </Card>

        <SectionLabel>Cash at bank by hand</SectionLabel>
        <Card>
          <Note>Used only when Xero has never given a bank balance. {settings.data?.settings?.manualCash ? `Now ${aud(settings.data.settings.manualCash.amount)}, set ${settings.data.settings.manualCash.at}.` : 'Not set.'}</Note>
          <Field label="Cash at bank (A$)"><input style={inputStyle} inputMode="decimal" value={manual} onChange={e => setManual(e.target.value)} /></Field>
          <Button disabled={!manual} onClick={async () => { if (await call('settings-save', { settings: { manualCash: { amount: manual } } })) { setManual(''); settings.reload() } }}>Save</Button>
        </Card>

        <SectionLabel>On-chain data</SectionLabel>
        <Card>
          <Table head={['Metric', 'Latest', 'Fetched', '']} align={['left', 'right', 'right', 'left']}
            rows={Object.entries(status.data?.onchain || {}).filter(([k]) => k !== 'lastRun').map(([k, m]) => [
              k, m.lastDate || '—', m.fetchedAt ? m.fetchedAt.slice(0, 10) : '—', m.error ? <span key="e" style={{ color: colour.warning }}>{m.error}</span> : (m.source || '')
            ])} />
          <Note>Fetched twice a day by the scheduled job, within BGeometrics' free allowance.</Note>
        </Card>

        <SectionLabel>This device</SectionLabel>
        <Card>
          <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, ...text('body'), color: colour.ink }}>
            <input type="checkbox" checked={openHere} onChange={togglePref} style={{ width: 20, height: 20, fontSize: 16 }} />
            Open the app on Treasury
          </label>
          <Note>Handy for the home-screen icon. Face ID is still asked for each time.</Note>
          <Button variant="secondary" onClick={onLock}>Lock Treasury now</Button>
        </Card>

        <SectionLabel>Import tracker data</SectionLabel>
        <Card>
          <Note>Choose the JSON export of the old tracker. Nothing is saved until you confirm, and the file itself is never kept.</Note>
          <input type="file" accept="application/json,.json" onChange={choose} style={{ ...text('field'), marginBottom: space.md, maxWidth: '100%' }} />
          {preview && (
            <>
              <Table head={['From', 'To', 'Records']} align={['left', 'left', 'right']}
                rows={preview.report.mapped.map(m => [m.key, m.to, m.count])} />
              {preview.report.superseded.length > 0 && (
                <Note>Not imported, replaced by a live source: {preview.report.superseded.map(s => `${s.key} (${s.reason})`).join('; ')}.</Note>
              )}
              {preview.report.unmapped.length > 0 && (
                <Banner tone="warning">
                  Could not map:
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {preview.report.unmapped.map(u => <li key={u.key}><b>{u.key}</b> — {u.reason}{u.preview ? ` (${u.preview})` : ''}</li>)}
                  </ul>
                </Banner>
              )}
              {preview.report.skipped.length > 0 && (
                <Banner tone="warning">
                  Records skipped:
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {preview.report.skipped.slice(0, 30).map((s, i) => <li key={i}>{s.key} #{s.index + 1 || ''} — {s.reason}</li>)}
                  </ul>
                </Banner>
              )}
              <Button onClick={async () => { const r = await call('import-commit', { json: file }); if (r) { setImported(r.added); setPreview(null); setFile(null) } }}>Import these</Button>
            </>
          )}
          {imported && <Banner>Imported: {Object.entries(imported).map(([k, n]) => `${k} ${n}`).join(', ')}. Records already present were not added twice.</Banner>}
        </Card>

        <SectionLabel>Access log</SectionLabel>
        <Table head={['When', 'Who', 'What', '']} align={['left', 'left', 'left', 'left']}
          rows={(audit.data?.entries || []).slice(0, 100).map(e => [
            when(e.at), e.email || 'signed out', `${e.action || ''}${e.page && e.page !== e.action ? ` · ${e.page}` : ''}`,
            e.ok ? 'ok' : <span key="r" style={{ color: colour.danger }}>refused{e.note ? ` (${e.note})` : ''}</span>
          ])} />
        <SmallButton onClick={() => audit.reload()}>Refresh log</SmallButton>
      </Body>
    </Page>
  )
}
