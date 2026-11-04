import React, { useState } from 'react'
import { Page, Header, Body, Card, SectionLabel, Button, Banner } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud, pct } from '../../treasury/logic.js'
import { useTreasury, Grid, Figure, Field, fieldBox, Table, Note, Problem, SmallButton, Segmented, treasuryCall, Locked, when } from './ui.jsx'
import { readCashReport } from './readCashReport.js'
import RocSection from './RocSection.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── Trust investments ───────────────────────────────────────────────────────
// The family trust's SelfWealth account. SelfWealth's annual statements are
// the record (trades, consolidations, distributions with record dates, the
// holdings at each year's start and end); the current year's cash report fills
// in after the last statement. Each holding is in its own currency — US$ for
// the USA market, A$ for the ASX — and totals are in A$ at today's rate.
//
// Without statements, a cash report cannot show units held before it starts,
// or a consolidation (no cash moves); the screen offers both from the
// distributions, and hand entries for them.

const usd = (n, cents) => (n == null || !Number.isFinite(n) ? '—' : 'US' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 }).format(n))
const money = (n, cur, cents) => (cur === 'AUD' ? (n == null || !Number.isFinite(n) ? '—' : 'A' + new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 }).format(n)) : usd(n, cents))
const SOURCE = { live: 'live', stale: 'last quote', typed: 'typed in', statement: 'statement' }
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
  // In A$: a US$ amount at today's rate, an A$ one as it is.
  const inAud = (n, cur) => (n == null ? null : cur === 'AUD' ? n : fx ? n / fx : null)
  const unknownCost = new Set((data?.autoOpenings || []).map(o => o.ticker))
  const rows = (data?.holdings || []).filter(h => h.units > 0).map(h => {
    const q = prices[h.ticker]
    const p = q?.price
    const value = p ? p * h.units : null
    const costKnown = !unknownCost.has(h.ticker)
    return { ...h, price: p, priceAt: q?.at, priceSource: q?.stale ? 'stale' : q?.source, value, costKnown, gain: value == null || !costKnown ? null : value - h.costUsd }
  })
  const totalValue = rows.every(r => r.value != null) ? rows.reduce((s, r) => s + (inAud(r.value, r.currency) ?? 0), 0) : null
  const known = rows.filter(r => r.costKnown)
  const totalCost = known.reduce((s, r) => s + (inAud(r.costUsd, r.currency) ?? 0), 0)
  const knownValue = known.every(r => r.value != null) ? known.reduce((s, r) => s + (inAud(r.value, r.currency) ?? 0), 0) : null
  const thisFy = data?.income?.filter(x => x.fy === data.income[0]?.fy) || []
  const fyNet = thisFy.reduce((s, x) => s + (inAud(x.net, x.currency) ?? 0), 0)
  const checks = data?.checks || []
  const mismatches = checks.filter(c => !c.matches)
  const statements = data?.statements || []
  const ignored = [...(data?.ignored?.openings || []), ...(data?.ignored?.actions || [])]

  return (
    <Page>
      <Header eyebrow="Treasury" title="Trust investments" onBack={onBack}
        subtitle={statements.length ? `SelfWealth · ${statements.length} annual statement${statements.length === 1 ? '' : 's'}${data?.reports?.length ? ' + cash report' : ''}`
          : data?.reports?.length ? `SelfWealth · ${day(data.reports[0].from)} to ${day(data.reports[data.reports.length - 1].to)}` : 'SelfWealth'} />
      <Body>
        <Problem>{error && 'Could not load the investments just now.'}</Problem>
        {msg && <Note>{msg}</Note>}

        {checks.length > 0 && (mismatches.length
          ? <Banner tone="warning">
              {mismatches.map(c => `${c.ticker} on ${day(c.date)}: SelfWealth says ${c.statement.toLocaleString('en-AU')}, the ledger ${c.ledger.toLocaleString('en-AU')}`).join(' · ')}.
              A line is missing or misread — import the statement or cash report that covers it.
            </Banner>
          : <Banner>Checked against SelfWealth: every holding matches its statement at each year's start and end ({checks.length} check{checks.length === 1 ? '' : 's'}).</Banner>)}
        {ignored.length > 0 && (
          <Banner tone="warning">
            The statements now cover {[...new Set(ignored.map(x => x.ticker))].join(', ')}, so the opening position or consolidation typed in by hand for {ignored.length === 1 ? 'it is' : 'them is'} no
            longer used. Remove {ignored.length === 1 ? 'it' : 'them'} below to tidy up.
          </Banner>
        )}
        {(data?.autoOpenings || []).length > 0 && (
          <Note>
            Held when the earliest statement starts, with the cost not in any imported document: {data.autoOpenings.map(o => `${o.units.toLocaleString('en-AU')} ${o.ticker}`).join(', ')}.
            Import the year before to bring in what they cost.
          </Note>
        )}

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
            <Figure label="Value" value={totalValue == null ? 'Add prices' : aud(totalValue)} sub={totalValue != null ? 'A$, US$ holdings at today\'s rate' : 'Tap a price below'} />
            <Figure label="Cost" value={aud(totalCost)} sub={known.length < rows.length ? `of the ${known.length} with a known cost` : 'incl. brokerage'} />
            {knownValue != null && <Figure label="Unrealised" value={aud(knownValue - totalCost)} sub={pct(totalCost ? (knownValue / totalCost - 1) * 100 : null)} tone={knownValue < totalCost ? 'danger' : undefined} />}
            <Figure label={`Income ${data.income[0]?.fy || ''}`} value={aud(fyNet)} sub="net of withholding and fees, in A$ at today's rate" />
            {data.cash && <Figure label="Cash in account" value={usd(data.cash.usd, true)} sub={`at ${day(data.cash.at)}`} />}
          </Grid>
        )}

        <SectionLabel>Holdings</SectionLabel>
        <Table head={['Ticker', 'Units', 'Avg cost', 'Price', 'Value']} align={['left', 'right', 'right', 'right', 'right']}
          rows={rows.map(h => [
            <span key="t"><b>{h.ticker}</b>{h.unitsGap ? <span style={{ display: 'block', ...text('caption'), color: colour.warning }}>SelfWealth paid on {h.lastDistUnits.toLocaleString('en-AU')}</span> : null}</span>,
            h.units.toLocaleString('en-AU'), h.costKnown ? money(h.averageUsd, h.currency, true) : 'not known',
            <span key="p"><SmallButton onClick={() => setPriceEdit({ ticker: h.ticker, currency: h.currency, price: h.price ? String(h.price) : '' })}>{h.price ? money(h.price, h.currency, true) : 'Set'}</SmallButton>
              {h.priceSource && <span style={{ display: 'block', ...text('caption'), color: colour.inkFaint }}>{SOURCE[h.priceSource] || h.priceSource}{h.priceAt && h.priceSource !== 'live' ? ` · ${day(h.priceAt.slice(0, 10))}` : ''}</span>}</span>,
            <span key="v">{money(h.value, h.currency)}<span style={{ display: 'block', color: h.gain < 0 ? colour.danger : colour.inkFaint }}>{h.gain == null ? '' : `${h.gain >= 0 ? '+' : ''}${money(h.gain, h.currency)}`}</span></span>
          ])} />
        {priceEdit && (
          <Card>
            <Field label={`${priceEdit.ticker} price (${priceEdit.currency === 'AUD' ? 'A$' : 'US$'})`} hint="Prices fill in from a quote service where it answers; a price typed here is used when it does not.">
              <input style={inputStyle} inputMode="decimal" value={priceEdit.price} onChange={e => setPriceEdit({ ...priceEdit, price: e.target.value })} />
            </Field>
            <Button onClick={async () => { if (await post('inv-price-save', priceEdit, 'Price saved.')) setPriceEdit(null) }}>Save price</Button>
            <div style={{ height: space.sm }} />
            <Button variant="quiet" onClick={() => setPriceEdit(null)}>Cancel</Button>
          </Card>
        )}
        {rows.some(r => r.priceSource && r.priceSource !== 'live') && <Note>Not every price is live; oldest {when(rows.filter(r => r.priceAt && r.priceSource !== 'live').map(r => r.priceAt).sort()[0])}.</Note>}

        {(data?.actions || []).filter(a => a.source === 'annual').length > 0 && (
          <Note>Consolidations from the statements: {data.actions.filter(a => a.source === 'annual').map(a => `${a.ticker} 1-for-${a.ratio} on ${day(a.date)}`).join(' · ')}.</Note>
        )}

        <SectionLabel>Entered by hand</SectionLabel>
        <Note>
          A holding SelfWealth's documents do not show — bought since the last one imported, held elsewhere, or bullion — and, before any
          statement is imported, units held before the first report and consolidations. The annual statements replace these for any holding they cover.
        </Note>
        <Table head={['', 'Ticker', 'Detail', '']} align={['left', 'left', 'left', 'right']}
          rows={[
            ...(data?.openings || []).map(o => ['Holding', o.ticker, `${o.units.toLocaleString('en-AU')} units · cost ${money(o.costUsd, o.currency)}${o.date ? ` · ${day(o.date)}` : ''}`,
              <SmallButton key="d" tone="danger" onClick={() => window.confirm(`Remove the ${o.ticker} holding?`) && post('inv-opening-delete', { id: o.id }, 'Removed.')}>Remove</SmallButton>]),
            ...(data?.actions || []).map(a => ['Consolidation', a.ticker, `1-for-${a.ratio} on ${day(a.date)}`,
              <SmallButton key="d" tone="danger" onClick={() => window.confirm(`Remove the ${a.ticker} consolidation?`) && post('inv-action-delete', { id: a.id }, 'Removed.')}>Remove</SmallButton>])
          ]} />
        <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
          {!opening && <SmallButton onClick={() => setOpening({ ticker: '', units: '', costUsd: '', date: '', currency: 'AUD' })}>Add a holding</SmallButton>}
          {!action && <SmallButton onClick={() => setAction({ ticker: '', date: '', ratio: '' })}>Add consolidation</SmallButton>}
        </div>
        {opening && (
          <Card style={{ marginTop: space.sm }}>
            <Field label="Ticker or name" hint="The ASX or US code (ETPMAG, SLV) gets a live price; anything else, e.g. SILVER-OZ, takes a price you type."><input style={inputStyle} value={opening.ticker} onChange={e => setOpening({ ...opening, ticker: e.target.value })} /></Field>
            <Field label="Currency">
              <Segmented options={[{ id: 'AUD', label: 'A$' }, { id: 'USD', label: 'US$' }]} value={opening.currency || 'USD'} onChange={v => setOpening({ ...opening, currency: v })} />
            </Field>
            <Field label="Units held" hint="Shares, or ounces for bullion. As held then, before any later consolidation."><input style={inputStyle} inputMode="decimal" value={opening.units} onChange={e => setOpening({ ...opening, units: e.target.value })} /></Field>
            <Field label={`What they cost (${opening.currency === 'AUD' ? 'A$' : 'US$'}, incl. brokerage)`}><input style={inputStyle} inputMode="decimal" value={opening.costUsd} onChange={e => setOpening({ ...opening, costUsd: e.target.value })} /></Field>
            <Field label="Bought on"><input style={inputStyle} type="date" value={opening.date} onChange={e => setOpening({ ...opening, date: e.target.value })} /></Field>
            <Button onClick={async () => { if (await post('inv-opening-save', { opening }, 'Holding saved.')) setOpening(null) }}>Save</Button>
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

        {(data?.roc || []).map(r => (
          <RocSection key={r.ticker} roc={r} cfg={data.rocCfg} today={data.today}
            onSave={roc => post('roc-save', { roc }, 'Return-of-capital share saved.')} />
        ))}

        <SectionLabel>Income by financial year</SectionLabel>
        <Table head={['Year', 'Gross', 'Withheld', 'Refunds', 'Net']} align={['left', 'right', 'right', 'right', 'right']}
          rows={(data?.income || []).map(x => [
            <span key="y">{x.fy}<span style={{ display: 'block', color: colour.inkFaint }}>{x.ticker} · {x.payments} paid</span></span>,
            money(x.gross, x.currency), money(x.withholding, x.currency), money(x.refunds, x.currency), <b key="n">{money(x.net, x.currency)}</b>])} />
        <Note>Net is gross less US withholding and SelfWealth's distribution fees ({usd((data?.income || []).filter(x => x.currency !== 'AUD').reduce((t, x) => t + x.fees, 0), true)} in all), plus refunds of withholding, counted in the year they arrived.</Note>

        <SectionLabel>Money between the dollars</SectionLabel>
        <Table head={['Year', 'To A$', 'To US$']} align={['left', 'right', 'right']}
          rows={(data?.conversions || []).map(c => [c.fy,
            <span key="a">{aud(c.toAudAud)}<span style={{ display: 'block', color: colour.inkFaint }}>from {usd(c.toAudUsd)}</span></span>,
            <span key="u">{usd(c.fromAudUsd)}<span style={{ display: 'block', color: colour.inkFaint }}>from {aud(c.fromAudAud)}</span></span>])} />

        <SectionLabel>Latest activity</SectionLabel>
        <Table head={['Date', 'What', 'Amount']} align={['left', 'left', 'right']}
          rows={(data?.recent || []).slice(0, 25).map(r => [day(r.date), <span key="w">{KIND[r.kind] || r.kind}{r.ticker ? ` · ${r.ticker}` : ''}{r.units && (r.kind === 'buy' || r.kind === 'sell') ? ` · ${r.units}` : ''}</span>,
            <span key="a" style={{ color: r.amount < 0 ? colour.inkMuted : colour.ink }}>{r.amount >= 0 ? '+' : '−'}{money(Math.abs(r.amount), r.currency, true)}</span>])} />

        <SectionLabel>Import from SelfWealth</SectionLabel>
        <Card>
          <Note>
            Choose SelfWealth's <b>annual statements</b> (one per financial year and market — USA and Australia) for every finished year,
            and the <b>Cash Report</b> for the year under way. Several PDFs at once is fine. Each is read on this phone; only its lines are sent.
            A statement replaces the same one imported before; a cash report adds nothing twice, and must add up to its closing balance.
          </Note>
          {statements.length > 0 && <Note>Imported: {statements.map(a => `${a.market} ${a.from.slice(0, 4)}–${a.to.slice(2, 4)}`).join(' · ')}{data?.reports?.length ? ` · cash report to ${day(data.reports[data.reports.length - 1].to)}` : ''}.</Note>}
          {importMsg && <Problem>{importMsg}</Problem>}
          <input type="file" accept="application/pdf,.pdf" multiple onChange={choose} disabled={busy} style={{ ...text('field'), maxWidth: '100%', marginBottom: space.md }} />
          {busy && <Note>Reading…</Note>}
          {previews.map(({ name, preview: p }) => p.type === 'annual' ? (
            <div key={name} style={{ marginBottom: space.md }}>
              <Table head={[name.length > 32 ? `${name.slice(0, 30)}…` : name, '']} align={['left', 'right']} rows={[
                ['Annual statement', `${p.market} · ${p.currency === 'AUD' ? 'A$' : 'US$'}`],
                ['Period', `${day(p.from)} – ${day(p.to)}`],
                ['Trades', p.counts.trades],
                ['Distributions', p.counts.distributions],
                ['Conversions', p.counts.conversions],
                ['Consolidations', p.consolidations.length ? p.consolidations.map(c => `${c.ticker} 1-for-${c.ratio}`).join(', ') : 'None'],
                ['Holdings at year end', p.counts.holdings],
                ['Matches its own holdings', p.checks.every(c => c.matches) ? 'Yes' : `No — ${p.checks.filter(c => !c.matches).map(c => c.ticker).join(', ')}`],
                ...(p.replaces ? [['Already imported', 'Will be replaced']] : [])
              ]} />
            </div>
          ) : (
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
            <Button disabled={busy || previews.some(p => p.preview.reconciles === false) || !previews.some(p => p.preview.added || p.preview.type === 'annual')} onClick={importAll}>
              {previews.some(p => p.preview.added || p.preview.type === 'annual') ? 'Import' : 'Nothing new to import'}
            </Button>
          )}
          {(data?.reports?.length > 0 || statements.length > 0) && !previews.length && (
            <div style={{ marginTop: space.sm }}>
              <SmallButton tone="danger" onClick={() => window.confirm('Remove every imported SelfWealth statement and report? Import them again afterwards.') && post('sw-clear', {}, 'Removed.')}>Remove the import</SmallButton>
            </div>
          )}
        </Card>
      </Body>
    </Page>
  )
}
