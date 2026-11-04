import React, { useState } from 'react'
import { Card, SectionLabel, Button, Banner } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud } from '../../treasury/logic.js'
import { Grid, Figure, Field, fieldBox, Table, Note, SmallButton } from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── Return of capital, on the Trust investments screen ──────────────────────
// What src/treasury/roc.js works out: each parcel's cost base after the return
// of capital paid on it, which parcels are at nil (from which point return of
// capital is a capital gain), and when the rest get there. Estimates for Sam.

const day = d => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const month = d => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const units = n => n.toLocaleString('en-AU', { maximumFractionDigits: 1 })

export default function RocSection({ roc, cfg, today, onSave }) {
  const [showAll, setShowAll] = useState(false)
  const [edit, setEdit] = useState(null)
  if (!roc) return null
  const t = roc.totals
  const parcels = [...roc.parcels].sort((a, b) => String(a.projectedNil).localeCompare(String(b.projectedNil)))
  const nextNil = parcels.find(p => p.base > 1e-6)?.projectedNil
  const fyNow = roc.byFy[0]
  const years = [...new Set([...roc.payments.map(p => p.date.slice(0, 4)), today.slice(0, 4), ...Object.keys(cfg.years || {})])].sort()

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
      <Note>
        Return of capital reduces each parcel's cost base. Once a parcel reaches nil, every further return of capital on it is a
        capital gain in the year it is paid. In A$ at each day's rate — estimates for Sam to confirm.
      </Note>
      <Grid>
        <Figure label="Cost base now" value={aud(t.baseAud)} sub={`of ${aud(t.costAud)} paid`} />
        <Figure label="Returned so far" value={aud(t.rocAud)} sub="cost base reduced" />
        <Figure label="Parcels at nil" value={`${t.atNil} of ${t.parcels}`} tone={t.atNil ? 'warning' : undefined}
          sub={t.atNil ? 'their return of capital is now a gain' : 'none yet'} />
        <Figure label="Next to reach nil" value={nextNil ? month(nextNil) : '—'} sub="at the recent rate" />
        {fyNow && <Figure label={`Gain ${fyNow.fy} so far`} value={aud(fyNow.gainAud)} sub={fyNow.gainAud ? `${aud(fyNow.gainDiscount)} held over 12 months` : 'from return of capital'} />}
      </Grid>

      <Table head={['Year', 'Cost base reduced', 'Capital gain', 'Of it, held 12m+']} align={['left', 'right', 'right', 'right']}
        rows={[
          ...roc.projected.filter(p => !roc.byFy.some(x => x.fy === p.fy) || p.fy > roc.byFy[0].fy).slice().reverse().map(p => [
            <span key="y">{p.fy}<span style={{ display: 'block', color: colour.inkFaint }}>projected</span></span>, '—',
            <span key="g" style={{ color: colour.inkMuted }}>{aud(p.gainAud)}</span>, <span key="d" style={{ color: colour.inkMuted }}>{aud(p.gainDiscount)}</span>]),
          ...roc.byFy.map(x => [x.fy, aud(x.rocAud), <b key="g">{aud(x.gainAud)}</b>, aud(x.gainDiscount)])
        ]} />
      <Note>
        Projection: US${roc.assumption.avgPerUnitUsd.toFixed(4)} a unit a week (average of the last {Math.min(13, roc.payments.length)} payments)
        × {roc.assumption.pct}% return of capital at {roc.assumption.rateNow.toFixed(3)} US$ per A$, on the units held now.
        Parcels bought later start their own count.
      </Note>

      <SectionLabel>Parcels, in the order they reach nil</SectionLabel>
      <Table head={['Bought', 'Units', 'Cost', 'Left', 'Nil']} align={['left', 'right', 'right', 'right', 'right']}
        rows={(showAll ? parcels : parcels.slice(0, 8)).map(p => [
          day(p.date), units(p.units), aud(p.costAud),
          <span key="l" style={{ color: p.base <= 1e-6 ? colour.warning : colour.ink }}>{aud(p.base)}</span>,
          <span key="n" style={{ color: p.nilOn ? colour.warning : colour.inkMuted }}>{p.nilOn ? day(p.nilOn) : `~${month(p.projectedNil)}`}</span>
        ])} />
      {parcels.length > 8 && <SmallButton onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${parcels.length} parcels`}</SmallButton>}

      <SectionLabel>Return-of-capital share</SectionLabel>
      <Card>
        <Table head={['Year', 'Share', '']} align={['left', 'right', 'left']}
          rows={years.filter(y => cfg.years?.[y] != null).map(y => [y, `${cfg.years[y]}%`, (cfg.final || []).includes(y) ? 'final' : 'assumed'])} />
        {Object.keys(cfg.overrides || {}).length > 0 && (
          <Note>Payment estimates: {Object.entries(cfg.overrides).sort().map(([d, v]) => `${day(d)} ${v}%`).join(' · ')}</Note>
        )}
        <Note>The fund publishes each year's final split early the next year (YieldMax's 19a notices give estimates per payment). Update it here when it does.</Note>
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
      {t.atNil > 0 && <Banner tone="warning">Some parcels are at nil: their return of capital is now taxed as a capital gain each year. Worth raising with Sam before the next return.</Banner>}
    </>
  )
}
