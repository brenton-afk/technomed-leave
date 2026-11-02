import React, { useState } from 'react'
import { Page, Header, Body, SectionLabel, Card } from '../../design/Shell.jsx'
import { aud, btc } from '../../treasury/logic.js'
import LineChart, { SERIES } from '../../treasury/LineChart.jsx'
import { useTreasury, Table, Note, Problem, SmallButton, treasuryCall, Locked, when } from './ui.jsx'

// ─── Snapshots ───────────────────────────────────────────────────────────────
// The headline numbers once a month, taken by the first scheduled run of the
// month, or by hand. Taking one by hand replaces that month's.

const money = (v, axis) => (axis ? `$${Math.round(v / 1000).toLocaleString('en-AU')}k` : aud(v))

export default function Snapshots({ user, onBack, onLocked }) {
  const { data, error, reload } = useTreasury(user, 'snapshots', { onLocked, page: 'snapshots' })
  const [msg, setMsg] = useState(null)
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
        <Table head={['Month', 'Cash', 'Owed', 'Profit FY', 'BTC', 'BTC A$']} align={['left', 'right', 'right', 'right', 'right', 'right']}
          rows={[...list].reverse().map(s => [s.month, aud(s.cash), aud(s.receivables), aud(s.profitFy), s.totalSats == null ? '—' : btc(s.totalSats), aud(s.btcValueAud)])} />
        {!list.length && data && <Note>No snapshots yet. The first scheduled run of each month takes one.</Note>}
        {list.length > 0 && <Note>Latest taken {when(list[list.length - 1].takenAt)}.</Note>}
      </Body>
    </Page>
  )
}
