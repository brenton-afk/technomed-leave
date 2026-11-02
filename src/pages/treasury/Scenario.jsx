import React, { useMemo, useState } from 'react'
import { Page, Header, Body, Card, SectionLabel } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud, btc, pct, addDays, runScenario, weeksBetween, PATHS, parseMoney, ENTITIES } from '../../treasury/logic.js'
import { todayStr } from '../../clinicalPlan/week.js'
import { useTreasury, Grid, Figure, Field, fieldBox, Table, Note, Problem, Segmented, PriceBar } from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── What if ─────────────────────────────────────────────────────────────────
// Today's holdings and cost bases, as Holdings has them, carried to a price on
// a date with weekly buying in between. Everything is worked out on the phone
// from the live figures; nothing here is saved, so it can be played with.

const usd = n => (n == null || !Number.isFinite(n) ? '—' : 'US' + new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n))
const longDay = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export default function Scenario({ user, onBack, onLocked }) {
  const { data, error } = useTreasury(user, 'holdings', { onLocked, page: 'scenario' })
  const today = todayStr()
  const nowFx = data?.price?.aud > 0 && data?.price?.usd > 0 ? data.price.usd / data.price.aud : null

  const [form, setForm] = useState({ target: '126000', date: addDays(today, 365), weekly: '1000', fx: '', buyer: '', path: 'steady' })
  const set = k => e => setForm({ ...form, [k]: e.target.value })
  const fx = parseMoney(form.fx) || (nowFx ? Math.round(nowFx * 1000) / 1000 : null)
  const buyer = form.buyer || data?.settings?.dcaEntity || 'company'
  const weeks = /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? weeksBetween(today, form.date) : 0

  const input = useMemo(() => ({
    rows: data?.view?.rows || [], priceAudNow: data?.price?.aud,
    targetUsd: parseMoney(form.target), weekly: parseMoney(form.weekly) || 0, weeks, path: form.path, buyer
  }), [data, form.target, form.weekly, form.path, weeks, buyer])
  const result = fx > 0 ? runScenario({ ...input, fx }) : null
  const sensitivity = fx > 0 ? [fx - 0.05, fx, fx + 0.05].map(f => ({ fx: f, r: runScenario({ ...input, fx: f }) })) : []

  return (
    <Page>
      <Header eyebrow="Treasury" title="What if" onBack={onBack} subtitle="Your holdings at a price, on a date, with weekly buying" />
      <Body>
        <PriceBar user={user} />
        <Problem>{error && 'Could not load holdings just now.'}</Problem>

        <Card>
          <Field label="BTC price (US$)"><input style={inputStyle} inputMode="decimal" value={form.target} onChange={set('target')} /></Field>
          <Field label="By"><input style={inputStyle} type="date" value={form.date} onChange={set('date')} /></Field>
          <Field label="Weekly buy (A$)" hint={weeks ? `${weeks} weeks of buying — ${aud((parseMoney(form.weekly) || 0) * weeks)} in all` : 'Pick a date in the future to add weekly buying.'}>
            <input style={inputStyle} inputMode="decimal" value={form.weekly} onChange={set('weekly')} />
          </Field>
          <Field label="Bought by">
            <select style={inputStyle} value={buyer} onChange={set('buyer')}>
              {ENTITIES.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </Field>
          <Field label="AUD/USD on that date" hint={nowFx ? `US$ per A$1. Today ${nowFx.toFixed(3)}.` : 'US$ per A$1.'}>
            <input style={inputStyle} inputMode="decimal" placeholder={nowFx ? nowFx.toFixed(3) : '0.70'} value={form.fx} onChange={set('fx')} />
          </Field>
          <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.xs }}>How the price gets there</div>
          <Segmented options={Object.entries(PATHS).map(([id, label]) => ({ id, label: label.replace(', then', ',').replace('Flat, a late rally', 'Late rally') }))}
            value={form.path} onChange={v => setForm({ ...form, path: v })} />
          <Note>
            The path only changes what the weekly buys get: a flat year or a dip buys more coin than a steady climb to the same price.
          </Note>
        </Card>

        {result && (
          <>
            <SectionLabel>At {usd(parseMoney(form.target))} ({aud(result.targetAud)}) on {longDay(form.date)}</SectionLabel>
            <Grid>
              <Figure label="Value" value={aud(result.total.valueAt)} sub={`${aud(result.total.valueAt - result.total.valueNow)} more than today`} />
              <Figure label="Gain on cost" value={aud(result.total.gain)} sub={`${pct(result.total.gainPct)} · today ${aud(result.total.gainNow)}`}
                tone={result.total.gain < 0 ? 'danger' : undefined} />
              <Figure label="BTC then" value={btc(result.total.sats)} sub={result.addedSats ? `${btc(result.addedSats)} bought along the way` : 'no buying'} />
              <Figure label="Cost then" value={aud(result.total.cost)} sub={result.spend ? `incl. ${aud(result.spend)} of buys` : ''} />
              {result.averageBuyAud && <Figure label="Average buy price" value={aud(result.averageBuyAud)} sub={`${result.weeks} weekly buys`} />}
              <Figure label="Break-even, all" value={aud(result.total.breakEvenAud)} sub={fx ? usd(result.total.breakEvenAud * fx) : ''} />
            </Grid>

            <SectionLabel>By entity</SectionLabel>
            <Table head={['Entity', 'BTC then', 'Value', 'Gain']} align={['left', 'right', 'right', 'right']}
              rows={[...result.entities.map(e => [
                e.label, btc(e.sats), aud(e.valueAt),
                <span key="g" style={{ color: e.gain < 0 ? colour.danger : colour.ink }}>{aud(e.gain)}<span style={{ display: 'block', color: colour.inkFaint }}>{pct(e.gainPct)}</span></span>
              ]), [<b key="t">Total</b>, btc(result.total.sats), <b key="v">{aud(result.total.valueAt)}</b>, <b key="g">{aud(result.total.gain)}</b>]]} />

            <SectionLabel>Cost and break-even</SectionLabel>
            <Table head={['Entity', 'Cost then', 'Break-even']} align={['left', 'right', 'right']}
              rows={[...result.entities.map(e => [
                e.label, aud(e.cost),
                <span key="b">{aud(e.breakEvenAud)}<span style={{ display: 'block', color: colour.inkFaint }}>{usd(e.breakEvenAud * fx)}</span></span>
              ]), [<b key="t">Total</b>, aud(result.total.cost), aud(result.total.breakEvenAud)]]} />
            <Note>Break-even is the price per BTC at which value equals cost, in A$ and in US$ at your exchange rate.</Note>

            <SectionLabel>If the exchange rate moves</SectionLabel>
            <Note>The same US$ price is worth fewer Australian dollars if the dollar strengthens — it often does when bitcoin rallies.</Note>
            <Table head={['AUD/USD', 'A$/BTC', 'Value', 'Gain']} align={['left', 'right', 'right', 'right']}
              rows={sensitivity.filter(s => s.r).map(s => [
                s.fx.toFixed(3) + (Math.abs(s.fx - fx) < 1e-9 ? ' (yours)' : ''), aud(s.r.targetAud), aud(s.r.total.valueAt),
                `${aud(s.r.total.gain)} (${pct(s.r.total.gainPct)})`
              ])} />

            <Note>
              From your holdings and cost bases as entered on Holdings, and today's price. Cash on Amber is left out, as a price move does not change it.
              Arithmetic on assumptions, not a forecast; selling would bring in capital gains tax, which differs by entity.
            </Note>
          </>
        )}
      </Body>
    </Page>
  )
}
