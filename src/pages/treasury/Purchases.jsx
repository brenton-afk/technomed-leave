import React, { useCallback, useMemo, useState } from 'react'
import { Card, SectionLabel, Button, Banner } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud, btc, pct, SATS, satsToBtcText } from '../../treasury/logic.js'
import { purchaseSummary, monthlyTable, purchaseDots, cumulativeSteps } from '../../treasury/amber.js'
import PurchaseChart from '../../treasury/PurchaseChart.jsx'
import LineChart, { SERIES } from '../../treasury/LineChart.jsx'
import {
  useTreasury, Grid, Figure, Field, fieldBox, Table, Note, Problem, SmallButton, Segmented,
  treasuryCall, Locked, Stale, when
} from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── TechnoMed's treasury: purchases and transfers in ────────────────────────
// A section of the Holdings screen. From the Amber export: every purchase on
// the price line. Coins that arrived without being bought — the trust's
// repayment in BTC — are transfers in, marked differently, and part of the
// treasury: its BTC, its cost (their value on arrival) and the blended
// average. Amber's own rows are the record — imported, not retyped.

const day = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function PurchasesSection({ user, onLocked, onChanged }) {
  const { data, error, reload } = useTreasury(user, 'purchases', { onLocked, page: 'purchases' })
  const [currency, setCurrency] = useState('AUD')
  const [log, setLog] = useState(false)
  const [group, setGroup] = useState('none')
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [csv, setCsv] = useState(null)
  const [transfer, setTransfer] = useState(null)

  const rows = useMemo(() => data?.rows || [], [data])
  const transfers = useMemo(() => data?.transfers || [], [data])
  const priceAud = data?.price?.aud
  const summary = data ? purchaseSummary(rows, transfers, priceAud, data.today) : null

  // A$ → the chosen currency on a given day, from that day's two closes.
  const fx = useMemo(() => {
    const a = new Map(data?.history?.aud || [])
    const u = new Map(data?.history?.usd || [])
    const days = [...a.keys()].filter(d => u.has(d)).sort()
    return { a, u, days }
  }, [data])
  const toCur = useCallback((value, date) => {
    if (currency === 'AUD') return value
    let d = date
    if (!fx.a.has(d) || !fx.u.has(d)) d = fx.days.filter(x => x <= date).pop() || fx.days[0]
    return d ? value * (fx.u.get(d) / fx.a.get(d)) : null
  }, [currency, fx])

  const prices = currency === 'AUD' ? data?.history?.aud || [] : data?.history?.usd || []
  const dots = useMemo(() => purchaseDots(rows, group), [rows, group])
  const current = currency === 'AUD' ? priceAud : data?.price?.usd
  // The line is the treasury's average: purchases plus transfers in at their
  // value on arrival. In US$, each A$ amount is converted on its own day.
  const averageCost = summary?.blendedCost == null ? null
    : currency === 'AUD' ? summary.blendedCost
      : (rows.filter(r => r.type !== 'send_to_cold_storage').reduce((t, r) => t + (toCur(r.aud, r.date) || 0), 0)
        + transfers.reduce((t, x) => t + (toCur(Number(x.valueAud) || 0, x.date) || 0), 0)) / (summary.heldSats / SATS)

  async function post(action, body, done) {
    setMsg(null)
    try { const r = await treasuryCall(user, action, { method: 'POST', body }); if (done) setMsg(done); reload(); onChanged?.(); return r } catch (err) {
      if (err instanceof Locked) onLocked(); else setMsg(err.message)
      return null
    }
  }

  async function choose(e) {
    setPreview(null); setMsg(null)
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const content = await f.text()
    setCsv(content)
    setPreview(await post('amber-preview', { csv: content }))
  }

  const hasTransfers = transfers.length > 0
  return (
    <>
        <SectionLabel>TechnoMed treasury</SectionLabel>
        <Note>{data?.importedAt ? `Purchases from the Amber export, imported ${when(data.importedAt)}, and transfers in.` : 'Purchases from the Amber export, and transfers in.'}</Note>
        <Problem>{error && 'Could not load purchases just now.'}</Problem>
        {msg && <Note>{msg}</Note>}

        {(data?.suggestions || []).map(sug => (
          <Banner key={sug.date} action={<SmallButton onClick={() => post('transfer-save', { transfer: sug }, 'Transfer added to the treasury.')}>Add to the treasury</SmallButton>}>
            The trust ledger shows <b>₿{sug.btc}</b> reaching TechnoMed on {day(sug.date)}{sug.valueAud ? <>, valued at <b>{aud(sug.valueAud)}</b></> : ''} ({sug.note || 'from the trust'}). It is not on the chart yet.
          </Banner>
        ))}

        {data && !rows.length && (
          <Banner>No Amber export imported yet. Choose the CSV at the bottom of this screen.</Banner>
        )}

        {summary && rows.length > 0 && (
          <Grid>
            {hasTransfers && <Figure label="Treasury BTC" value={btc(summary.heldSats)} sub="bought plus transferred in" />}
            {hasTransfers && <Figure label="Treasury cost" value={aud(summary.cost)} sub={`${aud(summary.invested)} bought + ${aud(summary.transferCost)} transferred in`} />}
            {hasTransfers && <Figure label="Average cost, all" value={aud(summary.blendedCost)} sub="per BTC, incl. transfers" />}
            {hasTransfers && <Figure label="Treasury value" value={aud(summary.valueAll)} />}
            {hasTransfers && <Figure label="Unrealised gain, all" value={aud(summary.gainAll)} sub={pct(summary.gainAllPct)} tone={summary.gainAll < 0 ? 'danger' : undefined} />}
            <Figure label="BTC bought" value={btc(summary.boughtSats)} sub={`${summary.purchases} purchases since ${day(summary.firstPurchase)}`} />
            <Figure label="A$ invested" value={aud(summary.invested)} />
            <Figure label={hasTransfers ? 'Average cost, buys' : 'Average cost'} value={aud(summary.averageCost)} sub="per BTC" />
            {!hasTransfers && <Figure label="Value now" value={aud(summary.value)} />}
            <Figure label={hasTransfers ? 'Gain on buys' : 'Unrealised gain'} value={aud(summary.gain)} sub={pct(summary.gainPct)} tone={summary.gain < 0 ? 'danger' : undefined} />
            <Figure label="Largest purchase" value={aud(summary.largest?.aud)} sub={summary.largest ? day(summary.largest.date) : ''} />
            <Figure label="Last 30 days" value={btc(summary.last30Sats)} sub="bought" />
            <Figure label="Still at Amber" value={btc(summary.atAmberSats)} sub={`${btc(summary.sentSats)} sent to cold storage`} />
            {hasTransfers && <Figure label="Transferred in" value={btc(summary.transferSats)} sub={`${aud(summary.transferCost)} on arrival · ${aud(summary.transferValue)} now`} />}
          </Grid>
        )}

        {rows.length > 0 && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm }}>
              <Segmented options={[{ id: 'AUD', label: 'A$' }, { id: 'USD', label: 'US$' }]} value={currency} onChange={setCurrency} />
              <Segmented options={[{ id: 'lin', label: 'Linear' }, { id: 'log', label: 'Log' }]} value={log ? 'log' : 'lin'} onChange={v => setLog(v === 'log')} />
              <Segmented options={[{ id: 'none', label: 'Each buy' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]} value={group} onChange={setGroup} />
            </div>
            <div style={{ marginBottom: space.sm }}>
              {data.history?.stale && <div style={{ marginBottom: space.sm }}><Stale problem="Kraken did not answer; prices are from the last fetch" /></div>}
              <PurchaseChart prices={prices} dots={dots} transfers={transfers} toCur={toCur}
                averageCost={averageCost} current={current} currency={currency} log={log} />
              {summary.gainAll != null && (
                <Note>
                  Now {aud(priceAud)} against an average cost of {aud(summary.blendedCost)}{hasTransfers ? ' (purchases and transfers in)' : ''}:
                  {' '}{summary.gainAll >= 0 ? 'up' : 'down'} {aud(Math.abs(summary.gainAll))} ({pct(summary.gainAllPct)}) on the treasury.
                </Note>
              )}
            </div>

            <SectionLabel>BTC held over time</SectionLabel>
            <Card>
              <LineChart title="Cumulative BTC from purchases and transfers in" format={(v, axis) => (axis ? `₿${v.toFixed(v < 10 ? 1 : 0)}` : `₿${v.toFixed(8)}`)}
                series={[{ id: 'held', label: 'BTC held', data: cumulativeSteps(rows, transfers), color: SERIES[1] }]} />
              <Note>Purchases and transfers in. Sends to cold storage are moves, not sales, so they do not lower this.</Note>
            </Card>

            <SectionLabel>By month</SectionLabel>
            <Table head={['Month', 'A$ invested', 'BTC', 'Avg price', 'Buys']} align={['left', 'right', 'right', 'right', 'right']}
              rows={monthlyTable(rows).map(m => [m.month, aud(m.invested), btc(m.sats), aud(m.averagePrice), m.buys])} />
          </>
        )}

        <SectionLabel>Transfers in</SectionLabel>
        <Note>Coins received rather than bought, such as a loan repaid in BTC. Shown as a separate marker and never counted as invested.</Note>
        <Table head={['Date', 'BTC', 'Price', 'From', '']} align={['left', 'right', 'right', 'left', 'right']}
          rows={transfers.map(t => [t.date, btc(t.sats), aud(t.priceAud), t.from || '—',
            <SmallButton key="e" onClick={() => setTransfer({ ...t, btc: satsToBtcText(t.sats), priceAud: t.priceAud ? String(Math.round(t.priceAud * 100) / 100) : '', valueAud: t.valueAud ? String(Math.round(t.valueAud)) : '' })}>Edit</SmallButton>])} />
        {!transfer && <SmallButton onClick={() => setTransfer({ date: '', btc: '', priceAud: '', valueAud: '', from: '', note: '' })}>Add a transfer in</SmallButton>}
        {transfer && (
          <Card>
            <Field label="Date"><input style={inputStyle} type="date" value={transfer.date} onChange={e => setTransfer({ ...transfer, date: e.target.value })} /></Field>
            <Field label="BTC received"><input style={inputStyle} inputMode="decimal" value={transfer.btc} onChange={e => setTransfer({ ...transfer, btc: e.target.value })} /></Field>
            <Field label="Price (A$ per BTC)" hint="Or leave blank and give the value."><input style={inputStyle} inputMode="decimal" value={transfer.priceAud} onChange={e => setTransfer({ ...transfer, priceAud: e.target.value })} /></Field>
            <Field label="Value (A$)"><input style={inputStyle} inputMode="decimal" value={transfer.valueAud} onChange={e => setTransfer({ ...transfer, valueAud: e.target.value })} /></Field>
            <Field label="From"><input style={inputStyle} value={transfer.from} placeholder="e.g. Family trust" onChange={e => setTransfer({ ...transfer, from: e.target.value })} /></Field>
            <Field label="Note"><input style={inputStyle} value={transfer.note} onChange={e => setTransfer({ ...transfer, note: e.target.value })} /></Field>
            <Button onClick={async () => { if (await post('transfer-save', { transfer }, 'Saved.')) setTransfer(null) }}>Save</Button>
            <div style={{ height: space.sm }} />
            {transfer.id && <><Button variant="danger" onClick={async () => { if (window.confirm('Delete this transfer?') && await post('transfer-delete', { id: transfer.id }, 'Deleted.')) setTransfer(null) }}>Delete</Button><div style={{ height: space.sm }} /></>}
            <Button variant="quiet" onClick={() => setTransfer(null)}>Cancel</Button>
          </Card>
        )}

        <SectionLabel>Import Amber transactions</SectionLabel>
        <Card>
          <Note>
            Choose Amber's CSV export. Only settled rows are read; a newer export adds only what is new.
            The file itself is not kept, and no wallet address is ever stored.
          </Note>
          <input type="file" accept=".csv,text/csv" onChange={choose} style={{ ...text('field'), maxWidth: '100%', marginBottom: space.md }} />
          {preview && (
            <>
              <Table head={['In this file', '']} align={['left', 'right']} rows={[
                ['Rows read', preview.file.rows],
                ['Purchases', `${preview.file.purchases} · ${aud(preview.file.invested, { cents: true })} · ${btc(preview.file.boughtSats)}`],
                ['Average cost', aud(preview.file.averageCost)],
                ['First purchase', preview.file.firstPurchase ? day(preview.file.firstPurchase) : '—'],
                ['Sent to cold storage', `${preview.file.sends} · ${btc(preview.file.sentSats)}`],
                ['Cash deposits', `${preview.file.deposits} · ${aud(preview.file.depositedAud)}`],
                ['New, not already imported', preview.added]
              ]} />
              {preview.skippedCount > 0 && (
                <Banner tone="warning">
                  {preview.skippedCount} row{preview.skippedCount === 1 ? '' : 's'} set aside:
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {preview.skipped.map(s => <li key={s.line}>line {s.line}: {s.reason}</li>)}
                  </ul>
                </Banner>
              )}
              <Button disabled={!preview.added} onClick={async () => {
                const r = await post('amber-commit', { csv })
                if (r) { setMsg(`Imported ${r.added} new row${r.added === 1 ? '' : 's'}.`); setPreview(null); setCsv(null) }
              }}>{preview.added ? `Import ${preview.added} new row${preview.added === 1 ? '' : 's'}` : 'Nothing new to import'}</Button>
            </>
          )}
          {rows.length > 0 && !preview && (
            <div style={{ marginTop: space.sm }}>
              <SmallButton tone="danger" onClick={async () => {
                if (window.confirm('Remove every imported Amber row? Import the export again afterwards.')) await post('amber-clear', {}, 'Amber rows removed.')
              }}>Remove the import</SmallButton>
            </div>
          )}
        </Card>
        <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.sm }}>
          TechnoMed's BTC on Amber, on Holdings, now comes from this import: bought less sent to cold storage.
        </div>
    </>
  )
}
