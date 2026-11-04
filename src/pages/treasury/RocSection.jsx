import React, { useState } from 'react'
import { Card, SectionLabel, Button, Banner } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud } from '../../treasury/logic.js'
import { Grid, Figure, Field, fieldBox, Table, Note, SmallButton } from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── Return of capital, on the Trust investments screen ──────────────────────
// What src/treasury/roc.js works out, said as carefully as it is known: the
// parcels and what each payment was paid on are checked facts; the US share of
// return of capital is known only where the record shows it; and whether
// Australian tax follows the US classification at all is Sam's call. Both
// readings are shown and neither is asserted.

const day = d => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const month = d => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const units = n => n.toLocaleString('en-AU', { maximumFractionDigits: 1 })
const usd = n => 'US' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)
const BASIS = { refunded: 'withholding refunded', payment: 'typed for the payment', final: 'final, typed', year: 'assumed, typed' }

export default function RocSection({ roc, cfg, today, onSave }) {
  const [showAll, setShowAll] = useState(false)
  const [edit, setEdit] = useState(null)
  if (!roc) return null
  const t = roc.totals
  const parcels = [...roc.parcels].sort((a, b) => String(a.nilOn || a.projectedNil || '9').localeCompare(String(b.nilOn || b.projectedNil || '9')) || a.date.localeCompare(b.date))
  const nextNil = parcels.find(p => p.base > 1e-6 && p.projectedNil)?.projectedNil
  const years = [...new Set([...roc.payments.map(p => p.date.slice(0, 4)), today.slice(0, 4), ...Object.keys(cfg.years || {})])].sort()
  const checks = roc.checks || { payments: 0, mismatches: [] }
  const unknown = roc.payments.filter(p => p.pct == null)
  const unknownUsd = unknown.reduce((s, p) => s + p.grossUsd, 0)
  const refunded = roc.payments.filter(p => p.basis === 'refunded')
  const typed = roc.payments.filter(p => p.basis && p.basis !== 'refunded')
  const range = list => (list.length ? `${day(list[0].date)} – ${day(list[list.length - 1].date)}` : '')

  function startEdit() {
    setEdit({
      years: Object.fromEntries(years.map(y => [y, cfg.years?.[y] != null ? String(cfg.years[y]) : ''])),
      final: [...(cfg.final || [])],
      overrides: Object.entries(cfg.overrides || {}).map(([date, pct]) => ({ date, pct: String(pct) })),
      newDate: '', newPct: ''
    })
  }

  return (
    <>
      <SectionLabel>{roc.ticker} return of capital</SectionLabel>
      <Banner tone={checks.mismatches.length ? 'warning' : 'info'}>
        {checks.mismatches.length
          ? <>Not every payment matches the parcels: {checks.mismatches.map(p => `${day(p.date)} paid on ${units(p.units)}, parcels ${units(p.eligibleUnits)}`).join('; ')}. A trade is missing or misread.</>
          : <>Checked: each of the {checks.payments} payments was paid on exactly the units the parcels add up to at its record date
            {(roc.consolidations || []).map(c => ` · 1-for-${c.ratio} consolidation on ${day(c.date)}${c.before ? ` (${units(c.before)} → ${units(c.after)})` : ''}`).join('')}.</>}
      </Banner>
      <Note>
        <b>Working figures for Sam, not a tax position.</b> Two things are not settled. First, how much of each payment the US treats as return of
        capital: known for {refunded.length + typed.length} of {roc.payments.length} payments
        {refunded.length ? ` (${refunded.length} had their US withholding refunded in full, ${range(refunded)})` : ''}
        {unknown.length ? `; the other ${unknown.length} (${usd(unknownUsd)}) are not known until the fund reports the year, and reduce nothing here` : ''}.
        Second, whether Australian tax follows the US classification at all — if it does not, every payment is assessable income and no cost base reduces.
      </Note>
      <Grid>
        <Figure label="Cost base, if US treatment" value={aud(t.baseAud)} sub={`of ${aud(t.costAud)} paid`} />
        <Figure label="Reduced so far" value={aud(t.rocAud)} sub="on payments with a known share" />
        <Figure label="Not yet classified" value={usd(unknownUsd)} sub={unknown.length ? `${unknown.length} payments` : 'none'} />
        <Figure label="Parcels at nil" value={`${t.atNil} of ${t.parcels}`} tone={t.atNil ? 'warning' : undefined}
          sub={t.atNil ? 'further return of capital on them is a gain' : 'no capital gain from this yet'} />
        {nextNil && <Figure label="Next to reach nil" value={month(nextNil)} sub={`at your ${roc.assumption.pct}% for ${today.slice(0, 4)}`} />}
      </Grid>

      <Table head={['Year', 'Paid (A$)', 'Base reduced', 'Gain', 'Unclassified']} align={['left', 'right', 'right', 'right', 'right']}
        rows={[
          ...roc.projected.filter(p => !roc.byFy.some(x => x.fy === p.fy) || p.fy > roc.byFy[0].fy).slice().reverse().map(p => [
            <span key="y">{p.fy}<span style={{ display: 'block', color: colour.inkFaint }}>projected</span></span>, '—', '—',
            <span key="g" style={{ color: colour.inkMuted }}>{aud(p.gainAud)}</span>, '—']),
          ...roc.byFy.map(x => [x.fy, aud(x.grossAud), aud(x.rocAud),
            <span key="g">{aud(x.gainAud)}{x.gainDiscount > 0 && <span style={{ display: 'block', color: colour.inkFaint }}>{aud(x.gainDiscount)} held 12m+</span>}</span>,
            x.unknownUsd ? usd(x.unknownUsd) : '—'])
        ]} />
      <Note>
        Paid is the gross of every payment in A$ at each day's rate, before US withholding — the income if Sam treats it all as assessable.
        Base reduced and Gain apply only if Australian tax follows the US return-of-capital share.
        {roc.assumption.pct != null
          ? ` Projection: US$${roc.assumption.avgPerUnitUsd.toFixed(4)} a unit a week (last ${Math.min(13, roc.payments.length)} payments) × your ${roc.assumption.pct}% at ${roc.assumption.rateNow.toFixed(3)} US$ per A$.`
          : ` No projection: there is no share for ${today.slice(0, 4)} to project with. Type one in below once YieldMax's notices give it.`}
      </Note>

      <SectionLabel>Parcels, in the order they reach nil</SectionLabel>
      <Table head={['Bought', 'Units', 'Cost', 'Left', 'Nil']} align={['left', 'right', 'right', 'right', 'right']}
        rows={(showAll ? parcels : parcels.slice(0, 8)).map(p => [
          day(p.date), units(p.units), aud(p.costAud),
          <span key="l" style={{ color: p.base <= 1e-6 ? colour.warning : colour.ink }}>{aud(p.base)}</span>,
          <span key="n" style={{ color: p.nilOn ? colour.warning : colour.inkMuted }}>{p.nilOn ? day(p.nilOn) : p.projectedNil ? `~${month(p.projectedNil)}` : '—'}</span>
        ])} />
      {parcels.length > 8 && <SmallButton onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${parcels.length} parcels`}</SmallButton>}

      <SectionLabel>Return-of-capital share</SectionLabel>
      <Card>
        <Table head={['Year', 'Payments', 'Share known from']} align={['left', 'right', 'left']}
          rows={years.filter(y => roc.payments.some(p => p.date.startsWith(y)) || cfg.years?.[y] != null).map(y => {
            const mine = roc.payments.filter(p => p.date.startsWith(y))
            const kinds = [...new Set(mine.map(p => (p.basis ? `${BASIS[p.basis]}${p.basis !== 'refunded' ? ` ${p.pct}%` : ''}` : 'not known yet')))]
            return [y, mine.length, kinds.join(' · ') || (cfg.years?.[y] != null ? `${cfg.years[y]}% ${(cfg.final || []).includes(y) ? 'final' : 'assumed'}` : '—')]
          })} />
        {Object.keys(cfg.overrides || {}).length > 0 && (
          <Note>Payment estimates: {Object.entries(cfg.overrides).sort().map(([d, v]) => `${day(d)} ${v}%`).join(' · ')}</Note>
        )}
        <Note>
          A refund of the US withholding on a payment shows the US did not treat it as an ordinary dividend. That is consistent with return of
          capital, but SelfWealth's Form 1042-S for the year is what confirms it. Otherwise the share comes from YieldMax's 19a-1 notice for the
          payment (an estimate) or the year's 1099-DIV (final). Type it in here; a payment with no share reduces nothing.
        </Note>
        {!edit && <SmallButton onClick={startEdit}>Change</SmallButton>}
        {edit && (
          <>
            {years.map(y => (
              <div key={y} style={{ display: 'flex', gap: space.sm, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Field label={`${y} (%)`}>
                    <input style={inputStyle} inputMode="decimal" value={edit.years[y] ?? ''} onChange={e => setEdit({ ...edit, years: { ...edit.years, [y]: e.target.value } })} />
                  </Field>
                </div>
                <label style={{ ...text('caption'), color: colour.inkMuted, display: 'flex', gap: 6, alignItems: 'center', marginBottom: space.md + 10 }}>
                  <input type="checkbox" style={{ width: 18, height: 18, fontSize: 16 }} checked={edit.final.includes(y)}
                    onChange={e => setEdit({ ...edit, final: e.target.checked ? [...edit.final, y] : edit.final.filter(x => x !== y) })} />
                  final
                </label>
              </div>
            ))}
            <div style={{ ...text('bodyStrong'), color: colour.ink, margin: `${space.sm}px 0` }}>A payment's own estimate</div>
            {edit.overrides.map((o, i) => (
              <div key={o.date} style={{ display: 'flex', justifyContent: 'space-between', ...text('body'), marginBottom: space.xs }}>
                <span>{day(o.date)} · {o.pct}%</span>
                <SmallButton tone="danger" onClick={() => setEdit({ ...edit, overrides: edit.overrides.filter((_, j) => j !== i) })}>Remove</SmallButton>
              </div>
            ))}
            <Field label="Payment">
              <select style={inputStyle} value={edit.newDate} onChange={e => setEdit({ ...edit, newDate: e.target.value })}>
                <option value="">Choose a payment…</option>
                {[...roc.payments].reverse().map(p => <option key={p.date} value={p.date}>{day(p.date)} · US${p.perUnitUsd} a unit</option>)}
              </select>
            </Field>
            <Field label="Return of capital (%)"><input style={inputStyle} inputMode="decimal" value={edit.newPct} onChange={e => setEdit({ ...edit, newPct: e.target.value })} /></Field>
            <SmallButton disabled={!edit.newDate || edit.newPct === ''} onClick={() => setEdit({
              ...edit, overrides: [...edit.overrides.filter(o => o.date !== edit.newDate), { date: edit.newDate, pct: edit.newPct }], newDate: '', newPct: ''
            })}>Add estimate</SmallButton>
            <div style={{ height: space.md }} />
            <Button onClick={async () => {
              const ok = await onSave({ years: edit.years, final: edit.final, overrides: Object.fromEntries(edit.overrides.map(o => [o.date, o.pct])) })
              if (ok) setEdit(null)
            }}>Save</Button>
            <div style={{ height: space.sm }} />
            <Button variant="quiet" onClick={() => setEdit(null)}>Cancel</Button>
          </>
        )}
      </Card>
      <SectionLabel>For Sam</SectionLabel>
      <Card>
        <ol style={{ ...text('body'), color: colour.ink, margin: 0, paddingLeft: space.lg }}>
          <li style={{ marginBottom: space.sm }}>
            <b>Does Australian tax follow the US return-of-capital classification?</b> If it does, the cost base figures above apply (CGT event G1 if
            {' '}{roc.ticker} is treated as a company, E4 if as a trust). If not, every payment is assessable foreign income — the Paid column by year.
          </li>
          {roc.refunds?.count > 0 && (
            <li style={{ marginBottom: space.sm }}>
              <b>US withholding of {usd(roc.refunds.usd)} was refunded</b> ({roc.refunds.count} payment{roc.refunds.count === 1 ? "" : "s"}, {roc.refunds.dates.map(day).join(', ')}),
              on payments in {roc.refunds.paymentFys.join(' and ')}. If a foreign income tax offset was claimed for that withholding, it may need reversing.
            </li>
          )}
          {(roc.consolidations || []).map(c => (
            <li key={c.date} style={{ marginBottom: space.sm }}>
              <b>1-for-{c.ratio} consolidation on {day(c.date)}</b>{c.before ? ` (${units(c.before)} → ${units(c.after)} units)` : ''}: confirm no CGT event,
              the cost base carries over, and the units keep their original purchase dates for the 12-month discount.
              {c.fraction > 0.001 ? ` ${units(c.fraction)} of a unit was lost to rounding; no cash for it appears in the statements.` : ''}
            </li>
          ))}
          <li style={{ marginBottom: space.sm }}>
            <b>The US classification itself:</b> SelfWealth's Form 1042-S for each year, and the fund's 1099-DIV, confirm it.
            {unknown.length ? ` ${unknown.length} payments (${usd(unknownUsd)}) are still unclassified.` : ''}
          </li>
          <li>
            Exchange rates here are daily market rates; the return may need RBA rates, which differ slightly.
          </li>
        </ol>
      </Card>
      {t.atNil > 0 && <Banner tone="warning">Some parcels are at nil on these figures: if Australian tax follows the US classification, further return of capital on them is a capital gain. Worth raising with Sam.</Banner>}
    </>
  )
}
