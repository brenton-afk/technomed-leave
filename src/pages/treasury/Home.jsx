import React from 'react'
import { Page, Header, Body, NavCard, SectionLabel, Banner } from '../../design/Shell.jsx'
import { colour, text } from '../../design/tokens.js'
import { IconChart, IconBitcoin, IconWallet, IconCalendar, IconFile, IconLock, IconClock } from '../../design/icons.jsx'
import { aud, usd, btc } from '../../treasury/logic.js'
import { useTreasury, Figure, Grid, Problem, SmallButton, when } from './ui.jsx'

// ─── Treasury home ───────────────────────────────────────────────────────────
// The headline numbers, each with where it came from and when, and the way
// into every other screen. A figure a source would not give shows its last
// stored value with a Stale badge, never an error.

const dueLabel = d => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''

export default function TreasuryHome({ user, onBack, go, onLocked }) {
  const { data, error, busy, reload } = useTreasury(user, 'home', { onLocked, page: 'home' })
  const f = data?.xero?.figures || {}
  const fig = name => f[name] || null
  const connected = data?.xero?.status?.connected
  const bank = fig('bank')
  const manual = data?.settings?.manualCash
  const plan = data?.dca?.plan

  return (
    <Page>
      <Header eyebrow="Private" title="Treasury" onBack={onBack}
        subtitle={data ? 'Only you can see this. Each figure shows when it was last updated.' : 'Loading…'}
        right={<SmallButton onClick={() => reload({ refresh: '1' })} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh now'}</SmallButton>} />
      <Body>
        <Problem>{error && 'Could not load the figures just now. Tap Refresh now, or try again shortly.'}</Problem>
        {data && !connected && (
          <Banner tone="warning" action={<SmallButton onClick={() => go('settings')}>Connect Xero</SmallButton>}>
            Xero is not connected, so the company figures are blank or from the last time it was.
          </Banner>
        )}
        {plan?.stale && <Banner tone="warning">On-chain data is {plan.ageDays} days old. The DCA multiplier may be out of date.</Banner>}

        <SectionLabel style={{ marginTop: 0 }}>Company</SectionLabel>
        <Grid>
          <Figure label="Cash at bank"
            value={bank?.data ? aud(bank.data.total) : manual ? aud(manual.amount) : '—'}
            sub={bank?.data ? `Xero · ${when(bank.fetchedAt)}` : manual ? `Entered ${manual.at || ''}` : 'Not available'}
            stale={bank?.stale} problem={bank?.problem} onClick={() => go('cash')} />
          <Figure label="Customers owe" value={aud(fig('receivables')?.data?.total)}
            sub={fig('receivables')?.data ? `${fig('receivables').data.count} invoices · ${when(fig('receivables').fetchedAt)}` : 'Not available'}
            stale={fig('receivables')?.stale} problem={fig('receivables')?.problem} />
          <Figure label="Overdue" value={aud(fig('receivables')?.data?.overdue)}
            tone={fig('receivables')?.data?.overdue > 0 ? 'warning' : undefined}
            sub={fig('receivables')?.data ? `${fig('receivables').data.overdueCount} invoices · due next 30 days ${aud(fig('receivables').data.due30)}` : ''}
            stale={fig('receivables')?.stale} />
          <Figure label="Bills due, 30 days" value={aud(fig('payables')?.data?.due30)}
            sub={fig('payables')?.data ? `${aud(fig('payables').data.overdue)} overdue · ${aud(fig('payables').data.total)} owing` : ''}
            stale={fig('payables')?.stale} />
          <Figure label="Profit FY to date" value={aud(fig('profit')?.data?.netProfit)}
            sub={fig('profit')?.data ? `Since ${dueLabel(fig('profit').data.from)} · ${when(fig('profit').fetchedAt)}` : 'Not available'}
            stale={fig('profit')?.stale} problem={fig('profit')?.problem}
            tone={fig('profit')?.data?.netProfit < 0 ? 'danger' : undefined} />
          <Figure label="Invoiced this month" value={aud(fig('raised')?.data?.thisMonth?.total)}
            sub={fig('raised')?.data ? `Last month ${aud(fig('raised').data.lastMonth.total)}` : ''}
            stale={fig('raised')?.stale} />
        </Grid>

        <SectionLabel>ATO</SectionLabel>
        <Grid>
          <Figure label="Next ATO payment" value={aud(data?.ato?.next?.amount)}
            sub={data?.ato?.next ? `${data.ato.next.label} · due ${dueLabel(data.ato.next.due)}` : 'Nothing scheduled'}
            tone={data?.ato?.overdue?.length ? 'danger' : undefined} onClick={() => go('cash')} />
          <Figure label="ATO, next 30 days" value={aud(data?.ato?.due30)} />
          <Figure label="ATO, next 90 days" value={aud(data?.ato?.due90)} />
        </Grid>

        <SectionLabel>Bitcoin</SectionLabel>
        <Grid>
          <Figure label="BTC price" value={aud(data?.price?.aud)}
            sub={data?.price ? `${usd(data.price.usd)} · ${data.price.source} ${when(data.price.at)}` : 'Not available'}
            stale={data?.price?.stale} onClick={() => go('bitcoin')} />
          <Figure label="BTC held, all entities" value={btc(data?.holdings?.total?.sats)}
            sub={data?.holdings?.total?.value != null ? aud(data.holdings.total.value) : ''} onClick={() => go('holdings')} />
          <Figure label="This week's DCA buy" value={plan?.ready ? aud(plan.total) : '—'}
            sub={plan?.ready ? `×${plan.multiplier.toFixed(2)}${data.dca.loggedThisWeek ? ' · logged' : ''}` : (plan?.reason || '')}
            stale={plan?.stale} onClick={() => go('dca')} />
        </Grid>
        {data?.onchain?.lastRun && (
          <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: 8 }}>On-chain data fetched {when(data.onchain.lastRun)}</div>
        )}

        <SectionLabel>Sections</SectionLabel>
        <NavCard icon={IconBitcoin} label="Bitcoin" detail="Cost bases, SOPR, MVRV and key levels" onClick={() => go('bitcoin')} />
        <NavCard icon={IconWallet} label="Holdings" detail="BTC by entity and the purchase log" onClick={() => go('holdings')} />
        <NavCard icon={IconChart} label="Dynamic DCA" detail="This week's buy and the settings behind it" onClick={() => go('dca')} />
        <NavCard icon={IconCalendar} label="ATO and cash" detail="Payment schedule and 13 weeks ahead" onClick={() => go('cash')} />
        <NavCard icon={IconFile} label="Family trust ledger" detail="Distributions, loans, transfers · CSV" onClick={() => go('trust')} />
        <NavCard icon={IconClock} label="Snapshots" detail="Month-end headline numbers" onClick={() => go('snapshots')} />
        <NavCard icon={IconLock} label="Settings, import and audit" detail="Xero, Amber cash, the old tracker, access log" onClick={() => go('settings')} />
      </Body>
    </Page>
  )
}
