import React, { useState } from 'react'
import { Page, Header, Body, Card, SectionLabel, Banner } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import LineChart, { SERIES } from '../../treasury/LineChart.jsx'
import { usd, aud, pct } from '../../treasury/logic.js'
import { useTreasury, Segmented, Table, Note, Problem, Stale, SmallButton, treasuryCall, when, PriceBar } from './ui.jsx'

// ─── Bitcoin ─────────────────────────────────────────────────────────────────
// Four charts on one range control, the key levels as a table (which is also
// the charts' table view), and one plain-English line.

/** A plain-English line or two under each chart, for anyone not steeped in on-chain jargon. */
function Explain({ children }) {
  return <div style={{ ...text('caption'), color: colour.inkMuted, margin: `0 0 ${space.sm}px` }}>{children}</div>
}

const RANGES = [{ id: '3m', label: '3 months' }, { id: '1y', label: '1 year' }, { id: 'all', label: 'All' }]

const money = (v, axis) => axis
  ? (v >= 1000 ? `$${Math.round(v / 1000).toLocaleString('en-US')}k` : `$${Math.round(v)}`)
  : usd(v)
const ratio = v => (Number.isFinite(v) ? v.toFixed(2) : '—')

export default function Bitcoin({ user, onBack, onLocked }) {
  const [range, setRange] = useState('1y')
  const { data, error, reload } = useTreasury(user, 'bitcoin', { query: { range }, onLocked, page: 'bitcoin' })
  const [syncing, setSyncing] = useState(null)
  const s = data?.series || {}
  const L = data?.labels || {}

  async function sync() {
    setSyncing('Asking BGeometrics…')
    try {
      const r = await treasuryCall(user, 'onchain-sync', { method: 'POST' })
      setSyncing(r.fetched.length ? `Updated ${r.fetched.length} metric${r.fetched.length === 1 ? '' : 's'}. ${r.budgetLeft} request${r.budgetLeft === 1 ? '' : 's'} left this hour.` : 'The free allowance is used up for now — the scheduled run will catch up.')
      reload()
    } catch { setSyncing('Could not reach the on-chain source just now.') }
  }

  const oldest = data ? Object.values(data.meta || {}).filter(m => m?.lastDate).map(m => m.lastDate).sort()[0] : null

  return (
    <Page>
      <Header eyebrow="Treasury" title="Bitcoin" onBack={onBack}
        subtitle={data?.price ? `${aud(data.price.aud)} · ${usd(data.price.usd)} · ${data.price.source} ${when(data.price.at)}` : 'Loading…'}
        right={data?.price?.stale ? <Stale /> : null} />
      <Body>
        <PriceBar user={user} />
        <Problem>{error && 'Could not load the charts just now.'}</Problem>
        {data?.summary && (
          <Card style={{ background: colour.accentSoft, borderColor: 'transparent' }}>
            <div style={{ ...text('bodyStrong'), color: colour.accentDeep }}>{data.summary}</div>
          </Card>
        )}
        {Object.keys(data?.derived || {}).length > 0 && (
          <Banner tone="warning">
            The source stopped updating {Object.keys(data.derived).map(k => L[k]).join(', ')}; recent points are worked out from price and cost basis instead.
          </Banner>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, margin: `${space.md}px 0` }}>
          <Segmented options={RANGES} value={range} onChange={setRange} />
        </div>

        <SectionLabel style={{ marginTop: 0 }}>Price and cost bases (USD{range === 'all' ? ', log scale' : ''})</SectionLabel>
        <Explain>
          A <b>cost basis</b> is the average price a group of holders paid. <b>Realised price</b> is what every coin last changed
          hands at, roughly what the whole market paid. <b>Short-term holders (STH)</b> bought in about the last five months;
          <b> long-term holders (LTH)</b> have held longer. Price above the STH cost basis means recent buyers are in profit,
          and a fall below it has often meant a correction.
        </Explain>
        <Card>
          <LineChart title="Price against short-term, realised and long-term holder cost basis" log={range === 'all'} format={money}
            series={[
              { id: 'price', label: 'Price', data: s.price || [], color: SERIES[0] },
              { id: 'sth', label: L.sthRealizedPrice, data: s.sthRealizedPrice || [], color: SERIES[1] },
              { id: 'rp', label: L.realizedPrice, data: s.realizedPrice || [], color: SERIES[2] },
              { id: 'lth', label: L.lthRealizedPrice, data: s.lthRealizedPrice || [], color: SERIES[3] }
            ]} />
        </Card>

        <SectionLabel>STH-SOPR</SectionLabel>
        <Explain>
          Of the coins short-term holders sold that day, the sale price divided by what they paid. Above 1 they are selling at a
          profit; below 1 at a loss, which tends to happen near local lows as nervous buyers give up. Below 0.98 adds to the
          weekly DCA buy, and above 1.03 trims it.
        </Explain>
        <Card>
          <LineChart title="Short-term holder SOPR" format={ratio}
            refs={[{ y: 0.98, label: '0.98' }, { y: 1, label: '1.00' }, { y: 1.04, label: '1.04' }]}
            series={[{ id: 'sopr', label: 'STH-SOPR', data: s.sthSopr || [], color: colour.inkFainter, points: v => (v >= 1 ? colour.success : colour.danger) }]} />
          <Note>Green: short-term holders selling in profit. Red: selling at a loss.</Note>
        </Card>

        <SectionLabel>STH-MVRV</SectionLabel>
        <Explain>
          Today's price divided by the short-term holders' cost basis. At 1.0 recent buyers are breaking even. Above 1.2 they are
          comfortably in profit and the market is running hot, so the DCA buys a little less. Below 0.9 they are underwater, so
          it buys a little more.
        </Explain>
        <Card>
          <LineChart title="Short-term holder MVRV" format={ratio} refs={[{ y: 1, label: '1.0' }]}
            series={[{ id: 'sthmvrv', label: 'STH-MVRV', data: s.sthMvrv || [], color: SERIES[1] }]} />
        </Card>

        <SectionLabel>MVRV, Z-score and LTH-MVRV</SectionLabel>
        <Explain>
          <b>MVRV</b> is price against the realised price: how far the market sits above what everyone paid on average. Near 1 has
          been cheap; above about 3 has come late in past bull markets. <b>Z-score</b> is the same gap measured against how
          volatile it has been through Bitcoin's history. Below 0 has marked major lows and above 7 major tops, and it sets the
          main band of the DCA multiplier. <b>LTH-MVRV</b> is price against long-term holders' cost basis: the profit the patient
          money is sitting on. When it runs very high they have tended to start selling.
        </Explain>
        <Card>
          <LineChart title="MVRV ratio, MVRV Z-score and long-term holder MVRV" format={ratio}
            series={[
              { id: 'mvrv', label: 'MVRV', data: s.mvrv || [], color: SERIES[0] },
              { id: 'z', label: 'Z-score', data: s.mvrvZ || [], color: SERIES[1] },
              { id: 'lthmvrv', label: 'LTH-MVRV', data: s.lthMvrv || [], color: SERIES[2] }
            ]} />
        </Card>

        <SectionLabel>Key levels</SectionLabel>
        <Explain>Each cost basis in US dollars, and how far today's price is above (+) or below (−) it.</Explain>
        <Table head={['Level', 'USD', 'Price vs level']} align={['left', 'right', 'right']}
          rows={(data?.levels || []).map(l => [l.label, l.level ? usd(l.level) : '—', pct(l.pct)])} />

        <SectionLabel>Latest readings</SectionLabel>
        <Table head={['Metric', 'Value', 'As of']} align={['left', 'right', 'right']}
          rows={['mvrv', 'mvrvZ', 'sthMvrv', 'sthSopr', 'lthMvrv'].map(k => [L[k], ratio(data?.latest?.[k]), data?.dates?.[k] || '—'])} />

        <Note>
          On-chain data from BGeometrics, stored here daily{oldest ? `; oldest latest reading ${oldest}` : ''}.
          {data?.meta?.lastRun ? ` Last run ${when(data.meta.lastRun)}.` : ' Not fetched yet.'}
        </Note>
        <SmallButton onClick={sync} disabled={syncing === 'Asking BGeometrics…'}>Update on-chain data now</SmallButton>
        {syncing && <Note>{syncing}</Note>}
      </Body>
    </Page>
  )
}
