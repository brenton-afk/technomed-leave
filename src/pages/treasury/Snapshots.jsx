import React, { useState } from 'react'
import { Page, Header, Body, SectionLabel, Card, Button } from '../../design/Shell.jsx'
import { aud, btc, satsToBtcText } from '../../treasury/logic.js'
import { text, space } from '../../design/tokens.js'
import LineChart, { SERIES } from '../../treasury/LineChart.jsx'
import { useTreasury, Table, Note, Problem, SmallButton, treasuryCall, Locked, when, Field, fieldBox } from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// Every figure a snapshot holds, as it is labelled on screen.
const FIELDS = [
  ['cash', 'Cash at bank (A$)'], ['receivables', 'Customers owe (A$)'], ['overdue', 'Overdue (A$)'],
  ['payables', 'Bills owing (A$)'], ['profitFy', 'Profit FY to date (A$)'], ['btcAud', 'BTC price (A$)'],
  ['btcValueAud', 'BTC held, A$ value'], ['amberCash', 'Amber cash (A$)'], ['ato90', 'ATO due in 90 days (A$)'],
  ['netWorth', 'Net assets (A$)']
]

// ─── Snapshots ───────────────────────────────────────────────────────────────
// The headline numbers once a month, taken by the first scheduled run of the
// month, or by hand. Taking one by hand replaces that month's.

const money = (v, axis) => (axis ? `$${Math.round(v / 1000).toLocaleString('en-AU')}k` : aud(v))

export default function Snapshots({ user, onBack, onLocked }) {
  const { data, error, reload } = useTreasury(user, 'snapshots', { onLocked, page: 'snapshots' })
  const [msg, setMsg] = useState(null)
  const [edit, setEdit] = useState(null)

  async function post(action, body, done) {
    setMsg(null)
    try { await treasuryCall(user, action, { method: 'POST', body }); setMsg(done); reload(); return true } catch (err) {
      if (err instanceof Locked) onLocked(); else setMsg(err.message)
      return false
    }
  }

  function startEdit(snap) {
    setEdit({ month: snap.month, totalBtc: satsToBtcText(snap.totalSats),
      ...Object.fromEntries(FIELDS.map(([k]) => [k, snap[k] == null ? '' : String(Math.round(snap[k] * 100) / 100)])) })
  }
  const list = data?.list || []
  const asSeries = key => list.filter(s => s[key] != null).map(s => [`${s.month}-01`, s[key]])

  async function take() {
    setMsg('Taking a snapshot…')
    try { await treasuryCall(user, 'snapshot-now', { method: 'POST' }); setMsg('Saved for this month.'); reload() } catch (err) {
      if (err instanceof Locked) onLocked(); else setMsg(err.message)
    }
  }

  return (
    <Page>
      <Header eyebrow="Treasury" title="Snapshots" onBack={onBack} right={<SmallButton onClick={take}>Snapshot now</SmallButton>} />
      <Body>
        <Problem>{error && 'Could not load snapshots just now.'}</Problem>
        {msg && <Note>{msg}</Note>}
        {list.length > 1 && (
          <>
            <SectionLabel style={{ marginTop: 0 }}>Cash at bank</SectionLabel>
            <Card><LineChart title="Cash at bank by month" format={money} series={[{ id: 'cash', label: 'Cash', data: asSeries('cash'), color: SERIES[0] }]} /></Card>
            <SectionLabel>Bitcoin held, A$ value</SectionLabel>
            <Card><LineChart title="Bitcoin value by month" format={money} series={[{ id: 'btc', label: 'BTC value', data: asSeries('btcValueAud'), color: SERIES[1] }]} /></Card>
          </>
        )}
        <SectionLabel>History</SectionLabel>
        <Table head={['Month', 'Cash', 'Owed', 'Profit FY', 'BTC', 'BTC A$', '']} align={['left', 'right', 'right', 'right', 'right', 'right', 'right']}
          rows={[...list].reverse().map(s => [s.month, aud(s.cash), aud(s.receivables), aud(s.profitFy), s.totalSats == null ? '—' : btc(s.totalSats), aud(s.btcValueAud),
            <SmallButton key="e" onClick={() => startEdit(s)}>Edit</SmallButton>])} />
        {edit && (
          <Card>
            <div style={{ ...text('heading'), marginBottom: space.sm }}>Snapshot {edit.month}</div>
            <Note>Leave a figure blank to clear it.</Note>
            <Field label="Total BTC"><input style={inputStyle} inputMode="decimal" value={edit.totalBtc} onChange={e => setEdit({ ...edit, totalBtc: e.target.value })} /></Field>
            {FIELDS.map(([k, label]) => (
              <Field key={k} label={label}><input style={inputStyle} inputMode="decimal" value={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.value })} /></Field>
            ))}
            <Button onClick={async () => { if (await post('snapshot-save', { snapshot: edit }, 'Snapshot updated.')) setEdit(null) }}>Save changes</Button>
            <div style={{ height: space.sm }} />
            <Button variant="danger" onClick={async () => {
              if (window.confirm(`Delete the ${edit.month} snapshot?`) && await post('snapshot-delete', { month: edit.month }, 'Snapshot deleted.')) setEdit(null)
            }}>Delete this snapshot</Button>
            <div style={{ height: space.sm }} />
            <Button variant="quiet" onClick={() => setEdit(null)}>Cancel</Button>
          </Card>
        )}
        {!list.length && data && <Note>No snapshots yet. The first scheduled run of each month takes one.</Note>}
        {list.length > 0 && <Note>Latest taken {when(list[list.length - 1].takenAt)}.</Note>}
      </Body>
    </Page>
  )
}
