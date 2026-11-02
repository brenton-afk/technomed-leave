import React, { useState } from 'react'
import { Page, Header, Body, Card, SectionLabel, Banner, Button } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud, btc, ENTITIES } from '../../treasury/logic.js'
import { useTreasury, Grid, Figure, Field, fieldBox, Table, Note, Problem, treasuryCall, Locked, BuyForm, SmallButton } from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── Dynamic DCA ─────────────────────────────────────────────────────────────
// The rules, applied to the latest stored readings. Logging asks first, with
// the amounts as actually bought — the plan's figure is only the starting
// point — and can be undone straight after.

const show = n => (n > 0 ? `+${n}` : n === 0 ? '0' : `${n}`)

export default function Dca({ user, onBack, onLocked }) {
  const { data, error, reload } = useTreasury(user, 'dca', { onLocked, page: 'dca' })
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [justLogged, setJustLogged] = useState(null)
  const plan = data?.plan
  const s = data?.settings

  const settings = form || (s && { baseWeekly: s.baseWeekly, dailyAuto: s.dailyAuto, amberCash: s.amberCash, dcaEntity: s.dcaEntity })

  async function run(action, body, done) {
    setBusy(true); setMsg(null)
    try { await treasuryCall(user, action, { method: 'POST', body }); setMsg(done); setForm(null); reload() } catch (err) {
      if (err instanceof Locked) onLocked(); else setMsg(err.message)
    } finally { setBusy(false) }
  }

  return (
    <Page>
      <Header eyebrow="Treasury" title="Dynamic DCA" onBack={onBack} subtitle={data ? `Week of ${data.week}` : 'Loading…'} />
      <Body>
        <Problem>{error && 'Could not load the plan just now.'}</Problem>
        {plan && !plan.ready && <Banner tone="warning">{plan.reason}. It arrives with the next scheduled run, or use “Update on-chain data now” on the Bitcoin screen.</Banner>}
        {plan?.ready && !(s?.amberCash > 0) && <Banner tone="warning">Amber cash is A$0, so the buy is capped at nothing. Enter the Amber balance in Settings below.</Banner>}
        {plan?.stale && <Banner tone="warning">The on-chain readings are {plan.ageDays} days old (as of {plan.asOf}). Check before buying.</Banner>}

        {plan?.ready && (
          <>
            <Grid>
              <Figure label="This week's buy" value={aud(plan.total)} sub={plan.capped ? `Capped at Amber cash (rules said ${aud(plan.target)})` : `Base ${aud(s.baseWeekly)} × ${plan.multiplier.toFixed(2)}`} />
              <Figure label="Multiplier" value={`×${plan.multiplier.toFixed(2)}`} sub={plan.parts.raw !== plan.multiplier ? `Rules gave ${plan.parts.raw.toFixed(2)}, capped 0–2.5` : 'Within 0–2.5'} />
              <Figure label="Manual top-up" value={aud(plan.topUp)} sub={`After 7 × ${aud(s.dailyAuto)} auto-buy`} />
              <Figure label="Amber cash left" value={aud(s.amberCash)} sub={plan.weeksLeft == null ? '—' : `${plan.weeksLeft.toFixed(1)} weeks at this rate`}
                tone={plan.weeksLeft != null && plan.weeksLeft < 4 ? 'warning' : undefined} />
            </Grid>
            {plan.autoExceeds > 0 && <Banner tone="warning">The daily auto-buy alone spends {aud(plan.autoExceeds)} more than this week's target. Consider pausing it.</Banner>}

            <SectionLabel>How it was worked out</SectionLabel>
            <Table head={['Reading', 'Value', 'Adds']} align={['left', 'right', 'right']} rows={[
              ['MVRV Z-score band', data.readings.mvrvZ?.toFixed(2), show(plan.parts.band)],
              ['STH-SOPR', data.readings.sthSopr?.toFixed(3), show(plan.parts.sopr)],
              ['STH-MVRV', data.readings.sthMvrv?.toFixed(2), show(plan.parts.sth)],
              ['Multiplier', '', `×${plan.multiplier.toFixed(2)}`]
            ]} />
            <Note>Readings as of {plan.asOf}. Buy rounded to A$50 and never more than the Amber cash entered.</Note>

            {justLogged && (
              <Banner action={<SmallButton disabled={busy} onClick={async () => {
                await run('dca-delete', { id: justLogged.id }, 'Undone. Amber cash and holdings are back as they were.')
                setJustLogged(null)
              }}>Undo</SmallButton>}>
                Logged {aud(justLogged.aud)} on {justLogged.date}. Amber cash reduced and the sats added to holdings.
              </Banner>
            )}
            {data.loggedThisWeek && !justLogged && (
              <Banner>This week's buy is logged: {aud(data.loggedThisWeek.aud)} on {data.loggedThisWeek.date}. To change or remove it, use the purchase log on Holdings.</Banner>
            )}
            {!data.loggedThisWeek && !confirming && (
              <Button disabled={busy || !(plan.total > 0)} onClick={() => setConfirming(true)}>
                I've made this week's buy — record it
              </Button>
            )}
            {confirming && (
              <BuyForm entities={ENTITIES} title="Record this week's buy"
                note="Only once the purchase has gone through on Amber. Enter what was actually bought — it may differ from the plan."
                initial={{ date: data.today, aud: String(plan.total), sats: '', priceAud: data.price?.aud ? String(Math.round(data.price.aud)) : '', entity: s.dcaEntity || 'company', note: '' }}
                submitLabel="Record it" onCancel={() => setConfirming(false)}
                onSubmit={async b => {
                  setMsg(null)
                  try {
                    const r = await treasuryCall(user, 'dca-log', { method: 'POST', body: b })
                    setJustLogged(r.entry); setConfirming(false); reload()
                  } catch (err) { if (err instanceof Locked) onLocked(); else setMsg(err.message) }
                }} />
            )}
          </>
        )}
        {msg && <Note>{msg}</Note>}

        <SectionLabel>Settings</SectionLabel>
        {settings && (
          <Card>
            <Field label="Base weekly buy (A$)">
              <input style={inputStyle} inputMode="decimal" value={settings.baseWeekly} onChange={e => setForm({ ...settings, baseWeekly: e.target.value })} />
            </Field>
            <Field label="Daily auto-buy (A$)">
              <input style={inputStyle} inputMode="decimal" value={settings.dailyAuto} onChange={e => setForm({ ...settings, dailyAuto: e.target.value })} />
            </Field>
            <Field label="Amber cash (A$)" hint={s.amberCashAt ? `Last set ${s.amberCashAt.slice(0, 10)}` : 'No API for Amber — enter it by hand.'}>
              <input style={inputStyle} inputMode="decimal" value={settings.amberCash} onChange={e => setForm({ ...settings, amberCash: e.target.value })} />
            </Field>
            <Field label="Buys go to">
              <select style={inputStyle} value={settings.dcaEntity} onChange={e => setForm({ ...settings, dcaEntity: e.target.value })}>
                {ENTITIES.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </Field>
            <Button disabled={!form || busy} onClick={() => run('settings-save', {
              settings: { ...form, ...(String(form.amberCash) === String(s.amberCash) ? { amberCash: undefined } : {}) }
            }, 'Saved.')}>Save settings</Button>
          </Card>
        )}

        <SectionLabel>Purchase log</SectionLabel>
        <Table head={['Date', 'A$', 'Sats', 'Price']} align={['left', 'right', 'right', 'right']}
          rows={(data?.log || []).map(d => [d.date, aud(d.aud), d.sats == null ? '—' : btc(d.sats), aud(d.priceAud)])} />
        <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.xs }}>Edit, remove or add buys on the Holdings screen.</div>
      </Body>
    </Page>
  )
}
