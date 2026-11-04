import React, { useState } from 'react'
import { Page, Header, Body, Card, SectionLabel, Button, Banner } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud, pct } from '../../treasury/logic.js'
import { useTreasury, Grid, Figure, Field, fieldBox, Table, Note, Problem, SmallButton, treasuryCall, Locked, when } from './ui.jsx'
import { readCashReport } from './readCashReport.js'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── Trust investments ───────────────────────────────────────────────────────
// The family trust's SelfWealth account, from its cash reports: holdings with
// cost and value, distributions by financial year with withholding, fees and
// refunds, and money moved between the dollars. Amounts are US$ as the account
// holds them, with A$ at today's rate where a total is shown.
//
// A cash report cannot show units held before it starts, or a consolidation
// (no cash moves). The distributions reveal both, so the screen offers them.

const usd = (n, cents) => (n == null || !Number.isFinite(n) ? '—' : 'US' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 }).format(n))
const day = d => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const KIND = {
  distribution: 'Distribution', withholding: 'Withholding tax', divfee: 'Distribution fee', refund: 'Tax refund',
  buy: 'Buy', sell: 'Sell', brokerage: 'Brokerage', to_aud: 'To A$', from_aud: 'From A$', other: 'Other'
}

export default function Investments({ user, onBack, onLocked }) {
  const { data, error, reload } = useTreasury(user, 'investments', { onLocked, page: 'investments' })
  const [msg, setMsg] = useState(null)
  const [importMsg, setImportMsg] = useState(null)
  const [previews, setPreviews] = useState([])
  const [busy, setBusy] = useState(false)
  const [priceEdit, setPriceEdit] = useState(null)
  const [opening, setOpening] = useState(null)
  const [action, setAction] = useState(null)

  async function post(action, body, done) {
    setMsg(null)
    try { const r = await treasuryCall(user, action, { method: 'POST', body }); if (done) setMsg(done); reload(); return r || true } catch (err) {
      if (err instanceof Locked) onLocked(); else setMsg(err.message)
      return null
    }
  }

  async function choose(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setImportMsg(null); setPreviews([]); setBusy(true)
    try {
      const out = []
      for (const f of files) {
        const items = await readCashReport(f)
        const preview = await treasuryCall(user, 'sw-preview', { method: 'POST', body: { items } })
        out.push({ name: f.name, items, preview })
      }
      setPreviews(out)
    } catch (err) {
      if (err instanceof Locked) onLocked(); else setImportMsg(err.message || 'That file could not be read.')
    } finally { setBusy(false) }
  }

  async function importAll() {
    setBusy(true); setImportMsg(null)
    try {
      let added = 0
      for (const p of previews) added += (await treasuryCall(user, 'sw-commit', { method: 'POST', body: { items: p.items } })).added
      setPreviews([]); setImportMsg(`Imported ${added} new line${added === 1 ? '' : 's'}.`); reload()
    } catch (err) {
      if (err instanceof Locked) onLocked(); else setImportMsg(err.message)
    } finally { setBusy(false) }
  }

  const fx = data?.fx
  const prices = data?.prices || {}
  const rows = (data?.holdings || []).filter(h => h.units > 0).map(h => {
    const p = prices[h.ticker]?.price
    const value = p ? p * h.units : null
    return { ...h, price: p, priceAt: prices[h.ticker]?.at, value, gain: value == null ? null : value - h.costUsd }
  })
  const totalValue = rows.every(r => r.value != null) ? rows.reduce((s, r) => s + r.value, 0) : null
  const totalCost = rows.reduce((s, r) => s + r.costUsd, 0)
  const thisFy = data?.income?.filter(x => x.fy === data.income[0]?.fy) || []
  const fyNet = thisFy.reduce((s, x) => s + x.net, 0)

  return (
    <Page>
      <Header eyebrow="Treasury" title="Trust investments" onBack={onBack}
        subtitle={data?.reports?.length ? `SelfWealth · ${day(data.reports[0].from)} to ${day(data.reports[data.reports.length - 1].to)}` : 'SelfWealth'} />
      <Body>
        <Problem>{error && 'Could not load the investments just now.'}</Problem>
        {msg && <Note>{msg}</Note>}

        {(data?.suggestedOpenings || []).map(o => (
          <Banner key={`o${o.ticker}`} action={<SmallButton onClick={() => setOpening({ ticker: o.ticker, units: String(o.units), costUsd: '', date: o.date || '' })}>Add opening position</SmallButton>}>
            The distributions show <b>{o.units.toLocaleString('en-AU')} {o.ticker}</b> already held when the first report starts, which no trade in the reports explains.
          </Banner>
        ))}
        {(data?.suggestedConsolidations || []).map(c => (
          <Banner key={`c${c.ticker}`} action={<SmallButton onClick={() => post('inv-action-save', { action: { ticker: c.ticker, date: c.date, ratio: c.ratio } }, 'Consolidation added.')}>Add 1-for-{c.ratio} consolidation</SmallButton>}>
            <b>{c.ticker}</b> looks to have consolidated 1-for-{c.ratio} around {day(c.date)}: distributions were paid on {c.after.toLocaleString('en-AU')} units where {c.before.toLocaleString('en-AU')} were held, with no sale between.
          </Banner>
        ))}

        {data && rows.length > 0 && (
          <Grid>
            <Figure label="Value" value={totalValue == null ? 'Add prices' : usd(totalValue)} sub={totalValue != null && fx ? `${aud(totalValue / fx)} at today's rate` : 'Tap a price below'} />
            <Figure label="Cost" value={usd(totalCost)} sub={fx ? aud(totalCost / fx) + ' at today\'s rate' : ''} />
            {totalValue != null && <Figure label="Unrealised" value={usd(totalValue - totalCost)} sub={pct(totalCost ? (totalValue / totalCost - 1) * 100 : null)} tone={totalValue < totalCost ? 'danger' : undefined} />}
            <Figure label={`Income ${data.income[0]?.fy || ''}`} value={usd(fyNet)} sub="net of withholding and fees, with refunds" />
            {data.cash && <Figure label="Cash in account" value={usd(data.cash.usd, true)} sub={`at ${day(data.cash.at)}`} />}
          </Grid>
        )}

        <SectionLabel>Holdings</SectionLabel>
        <Table head={['Ticker', 'Units', 'Avg cost', 'Price', 'Value']} align={['left', 'right', 'right', 'right', 'right']}
          rows={rows.map(h => [
            <span key="t"><b>{h.ticker}</b>{h.unitsGap ? <span style={{ display: 'block', ...text('caption'), color: colour.warning }}>SelfWealth paid on {h.lastDistUnits.toLocaleString('en-AU')}</span> : null}</span>,
            h.units.toLocaleString('en-AU'), usd(h.averageUsd, true),
            <SmallButton key="p" onClick={() => setPriceEdit({ ticker: h.ticker, price: h.price ? String(h.price) : '' })}>{h.price ? usd(h.price, true) : 'Set'}</SmallButton>,
            <span key="v">{usd(h.value)}<span style={{ display: 'block', color: h.gain < 0 ? colour.danger : colour.inkFaint }}>{h.gain == null ? '' : `${h.gain >= 0 ? '+' : ''}${usd(h.gain)}`}</span></span>
          ])} />
        {priceEdit && (
          <Card>
            <Field label={`${priceEdit.ticker} price (US$)`} hint="Typed in for now. A quote service can fill this in automatically once connected.">
              <input style={inputStyle} inputMode="decimal" value={priceEdit.price} onChange={e => setPriceEdit({ ...priceEdit, price: e.target.value })} />
            </Field>
            <Button onClick={async () => { if (await post('inv-price-save', priceEdit, 'Price saved.')) setPriceEdit(null) }}>Save price</Button>
            <div style={{ height: space.sm }} />
            <Button variant="quiet" onClick={() => setPriceEdit(null)}>Cancel</Button>
          </Card>
        )}
        {rows.some(r => r.priceAt) && <Note>Prices as entered; oldest {when(rows.filter(r => r.priceAt).map(r => r.priceAt).sort()[0])}.</Note>}

        <SectionLabel>Before the first report</SectionLabel>
        <Note>Units held before the first imported report, and consolidations. A cash report shows neither, because no cash moves.</Note>
        <Table head={['', 'Ticker', 'Detail', '']} align={['left', 'left', 'left', 'right']}
          rows={[
            ...(data?.openings || []).map(o => ['Opening', o.ticker, `${o.units.toLocaleString('en-AU')} units · cost ${usd(o.costUsd)}`,
              <SmallButton key="d" tone="danger" onClick={() => window.confirm(`Remove the ${o.ticker} opening position?`) && post('inv-opening-delete', { id: o.id }, 'Removed.')}>Remove</SmallButton>]),
            ...(data?.actions || []).map(a => ['Consolidation', a.ticker, `1-for-${a.ratio} on ${day(a.date)}`,
              <SmallButton key="d" tone="danger" onClick={() => window.confirm(`Remove the ${a.ticker} consolidation?`) && post('inv-action-delete', { id: a.id }, 'Removed.')}>Remove</SmallButton>])
          ]} />
        <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
          {!opening && <SmallButton onClick={() => setOpening({ ticker: '', units: '', costUsd: '', date: '' })}>Add opening position</SmallButton>}
          {!action && <SmallButton onClick={() => setAction({ ticker: '', date: '', ratio: '' })}>Add consolidation</SmallButton>}
        </div>
        {opening && (
          <Card style={{ marginTop: space.sm }}>
            <Field label="Ticker"><input style={inputStyle} value={opening.ticker} onChange={e => setOpening({ ...opening, ticker: e.target.value })} /></Field>
            <Field label="Units held" hint="As they were then, before any later consolidation."><input style={inputStyle} inputMode="decimal" value={opening.units} onChange={e => setOpening({ ...opening, units: e.target.value })} /></Field>
            <Field label="What they cost (US$, incl. brokerage)"><input style={inputStyle} inputMode="decimal" value={opening.costUsd} onChange={e => setOpening({ ...opening, costUsd: e.target.value })} /></Field>
            <Button onClick={async () => { if (await post('inv-opening-save', { opening }, 'Opening position saved.')) setOpening(null) }}>Save</Button>
            <div style={{ height: space.sm }} />
            <Button variant="quiet" onClick={() => setOpening(null)}>Cancel</Button>
          </Card>
        )}
        {action && (
          <Card style={{ marginTop: space.sm }}>
            <Field label="Ticker"><input style={inputStyle} value={action.ticker} onChange={e => setAction({ ...action, ticker: e.target.value })} /></Field>
            <Field label="Date"><input style={inputStyle} type="date" value={action.date} onChange={e => setAction({ ...action, date: e.target.value })} /></Field>
            <Field label="Ratio" hint="5 for 1-for-5: every 5 units became 1."><input style={inputStyle} inputMode="numeric" value={action.ratio} onChange={e => setAction({ ...action, ratio: e.target.value })} /></Field>
            <Button onClick={async () => { if (await post('inv-action-save', { action }, 'Consolidation saved.')) setAction(null) }}>Save</Button>
            <div style={{ height: space.sm }} />
            <Button variant="quiet" onClick={() => setAction(null)}>Cancel</Button>
          </Card>
        )}

        <SectionLabel>Income by financial year (US$)</SectionLabel>
        <Table head={['Year', 'Gross', 'Withheld', 'Refunds', 'Net']} align={['left', 'right', 'right', 'right', 'right']}
          rows={(data?.income || []).map(x => [
            <span key="y">{x.fy}<span style={{ display: 'block', color: colour.inkFaint }}>{x.ticker} · {x.payments} paid</span></span>,
            usd(x.gross), usd(x.withholding), usd(x.refunds), <b key="n">{usd(x.net)}</b>])} />
        <Note>Net is gross less US withholding and SelfWealth's distribution fees ({usd((data?.income || []).reduce((t, x) => t + x.fees, 0), true)} in all), plus refunds of withholding, counted in the year they arrived.</Note>

        <SectionLabel>Money between the dollars</SectionLabel>
        <Table head={['Year', 'To A$', 'To US$']} align={['left', 'right', 'right']}
          rows={(data?.conversions || []).map(c => [c.fy,
            <span key="a">{aud(c.toAudAud)}<span style={{ display: 'block', color: colour.inkFaint }}>from {usd(c.toAudUsd)}</span></span>,
            <span key="u">{usd(c.fromAudUsd)}<span style={{ display: 'block', color: colour.inkFaint }}>from {aud(c.fromAudAud)}</span></span>])} />

        <SectionLabel>Latest activity</SectionLabel>
        <Table head={['Date', 'What', 'US$']} align={['left', 'left', 'right']}
          rows={(data?.recent || []).slice(0, 25).map(r => [day(r.date), <span key="w">{KIND[r.kind] || r.kind}{r.ticker ? ` · ${r.ticker}` : ''}{r.units && (r.kind === 'buy' || r.kind === 'sell') ? ` · ${r.units}` : ''}</span>,
            <span key="a" style={{ color: r.amount < 0 ? colour.inkMuted : colour.ink }}>{r.amount >= 0 ? '+' : '−'}{usd(Math.abs(r.amount), true).replace('US', '')}</span>])} />

        <SectionLabel>Import SelfWealth cash reports</SectionLabel>
        <Card>
          <Note>
            In SelfWealth, download the Cash Report for each financial year as a PDF and choose them here (several at once is fine).
            The PDF is read on this phone; only its lines are sent, and a report already imported adds nothing twice.
            Each report is checked: its opening balance plus every line must come to its closing balance.
          </Note>
          {importMsg && <Problem>{importMsg}</Problem>}
          <input type="file" accept="application/pdf,.pdf" multiple onChange={choose} disabled={busy} style={{ ...text('field'), maxWidth: '100%', marginBottom: space.md }} />
          {busy && <Note>Reading…</Note>}
          {previews.map(({ name, preview: p }) => (
            <div key={name} style={{ marginBottom: space.md }}>
              <Table head={[name.length > 32 ? `${name.slice(0, 30)}…` : name, '']} align={['left', 'right']} rows={[
                ['Period', `${day(p.from)} – ${day(p.to)}`],
                ['Lines', p.rows],
                ['Opening → closing', `${usd(p.opening, true)} → ${usd(p.closing, true)}`],
                ['Adds up', p.reconciles ? 'Yes, to the cent' : p.reconciles === false ? 'No — will not import' : 'No closing balance to check'],
                ['New, not already imported', p.added]
              ]} />
              {p.others?.length > 0 && <Banner tone="warning">Lines not recognised (kept, shown as Other): {p.others.join('; ')}</Banner>}
            </div>
          ))}
          {previews.length > 0 && (
            <Button disabled={busy || previews.some(p => p.preview.reconciles === false) || !previews.some(p => p.preview.added)} onClick={importAll}>
              {previews.some(p => p.preview.added) ? 'Import' : 'Nothing new to import'}
            </Button>
          )}
          {data?.reports?.length > 0 && !previews.length && (
            <div style={{ marginTop: space.sm }}>
              <SmallButton tone="danger" onClick={() => window.confirm('Remove every imported SelfWealth line? Import the reports again afterwards.') && post('sw-clear', {}, 'Removed.')}>Remove the import</SmallButton>
            </div>
          )}
        </Card>
      </Body>
    </Page>
  )
}
