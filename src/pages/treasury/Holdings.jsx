import React, { useState } from 'react'
import { Page, Header, Body, Card, SectionLabel, Button } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud, btc, pct, ENTITIES, parseBtc, parseMoney, satsToBtcText, isLargeBtc, LARGE_BTC } from '../../treasury/logic.js'
import { useTreasury, Field, fieldBox, Table, Note, Problem, SmallButton, treasuryCall, Locked, Grid, Figure, BuyForm } from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── Holdings ────────────────────────────────────────────────────────────────
// BTC by entity. Cold storage and the exchange balance are typed in — there is
// no API for either — and cost base is what was paid in. Logging a DCA buy adds
// to the entity it went to; everything else here is set by hand.

// What a BTC field says it understood, under the field, before anything is
// saved — so a decimal point read the wrong way is caught by eye, not later.
function ReadBack({ text: typed }) {
  const { sats, error } = parseBtc(typed)
  if (error) return <span style={{ color: colour.danger }}>{error}</span>
  if (!String(typed || '').trim()) return null
  if (isLargeBtc(sats)) return <span style={{ color: colour.warning }}>Saves as {btc(sats)} — over {LARGE_BTC} BTC, is that right?</span>
  return <span>Saves as {btc(sats)}</span>
}

export default function Holdings({ user, onBack, onLocked }) {
  const { data, error, reload } = useTreasury(user, 'holdings', { onLocked, page: 'holdings' })
  const [edit, setEdit] = useState(null)
  const [entry, setEntry] = useState(null)
  const [msg, setMsg] = useState(null)
  const view = data?.view

  async function call(action, body, done) {
    setMsg(null)
    try { await treasuryCall(user, action, { method: 'POST', body }); setMsg(done); reload(); return true } catch (err) {
      if (err instanceof Locked) onLocked(); else setMsg(err.message)
      return false
    }
  }

  function startEdit() {
    setEdit(Object.fromEntries(ENTITIES.map(e => {
      const h = data.holdings?.[e.id] || {}
      const row = data.view?.rows?.find(r => r.id === e.id)
      return [e.id, {
        exchange: satsToBtcText(h.exchangeSats), cold: satsToBtcText(h.coldSats),
        cost: h.costAud ? String(h.costAud) : '', amber: row?.amberAud ? String(row.amberAud) : ''
      }]
    })))
  }

  const invalid = Boolean(edit) && ENTITIES.some(e => parseBtc(edit[e.id].exchange).error
    || parseBtc(edit[e.id].cold).error || parseMoney(edit[e.id].cost) == null || parseMoney(edit[e.id].amber) == null)

  async function saveEdit() {
    const holdings = Object.fromEntries(ENTITIES.map(e => [e.id, {
      exchangeSats: parseBtc(edit[e.id].exchange).sats, coldSats: parseBtc(edit[e.id].cold).sats,
      costAud: parseMoney(edit[e.id].cost), amberAud: parseMoney(edit[e.id].amber)
    }]))
    const large = ENTITIES.filter(e => isLargeBtc(holdings[e.id].exchangeSats) || isLargeBtc(holdings[e.id].coldSats))
    if (large.length && !window.confirm(`${large.map(e => e.label).join(' and ')}: more than ${LARGE_BTC} BTC in one field. Save anyway?`)) return
    if (await call('holdings-save', { holdings }, 'Holdings saved.')) setEdit(null)
  }

  return (
    <Page>
      <Header eyebrow="Treasury" title="Holdings" onBack={onBack}
        subtitle={data?.price ? `At ${aud(data.price.aud)} a coin${data.price.stale ? ' (stale price)' : ''}` : 'Loading…'} />
      <Body>
        <Problem>{error && 'Could not load holdings just now.'}</Problem>
        {view && (
          <Grid>
            <Figure label="Total BTC" value={btc(view.total.sats)} sub={aud(view.total.value)} />
            <Figure label="Unrealised P/L" value={aud(view.total.pl)} tone={view.total.pl < 0 ? 'danger' : undefined} sub={`Cost ${aud(view.total.costAud)}`} />
            <Figure label="Amber cash, all entities" value={aud(view.total.amberAud, { cents: true })} sub="Waiting to buy BTC" />
          </Grid>
        )}

        <SectionLabel>By entity</SectionLabel>
        {view && !edit && (
          <>
            <Table head={['Entity', 'BTC', 'A$ value', 'Cost', 'P/L']} align={['left', 'right', 'right', 'right', 'right']}
              rows={view.rows.map(r => [
                <span key="n">{r.label}
                  {r.coldSats ? <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block' }}>{btc(r.coldSats)} cold</span> : null}
                  {r.amberAud ? <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block' }}>{aud(r.amberAud, { cents: true })} cash on Amber</span> : null}
                </span>,
                btc(r.sats), aud(r.value), aud(r.costAud),
                <span key="p" style={{ color: r.pl < 0 ? colour.danger : colour.ink }}>{aud(r.pl)}<span style={{ display: 'block', color: colour.inkFaint }}>{pct(r.plPct)}</span></span>
              ])} />
            <SmallButton onClick={startEdit}>Edit balances and cold storage</SmallButton>
          </>
        )}
        {edit && (
          <Card>
            {ENTITIES.map(e => (
              <div key={e.id} style={{ marginBottom: space.md }}>
                <div style={{ ...text('bodyStrong'), color: colour.ink, marginBottom: space.sm }}>{e.label}</div>
                <Field label="On exchange / Amber (BTC)" hint={<ReadBack text={edit[e.id].exchange} />}>
                  <input style={inputStyle} inputMode="decimal" value={edit[e.id].exchange} onChange={ev => setEdit({ ...edit, [e.id]: { ...edit[e.id], exchange: ev.target.value } })} />
                </Field>
                <Field label="Cold storage (BTC)" hint={<ReadBack text={edit[e.id].cold} />}>
                  <input style={inputStyle} inputMode="decimal" value={edit[e.id].cold} onChange={ev => setEdit({ ...edit, [e.id]: { ...edit[e.id], cold: ev.target.value } })} />
                </Field>
                <Field label="Amber cash (A$)" hint={parseMoney(edit[e.id].amber) == null
                  ? <span style={{ color: colour.danger }}>Not a dollar amount</span>
                  : data.view?.rows?.find(r => r.id === e.id)?.dcaCash ? 'Cash waiting to buy BTC. This is also the Amber cash on the DCA screen.' : 'Cash waiting to buy BTC — dollars, not BTC.'}>
                  <input style={inputStyle} inputMode="decimal" value={edit[e.id].amber} onChange={ev => setEdit({ ...edit, [e.id]: { ...edit[e.id], amber: ev.target.value } })} />
                </Field>
                <Field label="Cost base (A$)" hint={parseMoney(edit[e.id].cost) == null ? <span style={{ color: colour.danger }}>Not a dollar amount</span> : null}>
                  <input style={inputStyle} inputMode="decimal" value={edit[e.id].cost} onChange={ev => setEdit({ ...edit, [e.id]: { ...edit[e.id], cost: ev.target.value } })} />
                </Field>
              </div>
            ))}
            <Button onClick={saveEdit} disabled={invalid}>Save holdings</Button>
            {invalid && <Note>Fix the amounts marked in red first.</Note>}
            <div style={{ height: space.sm }} />
            <Button variant="quiet" onClick={() => setEdit(null)}>Cancel</Button>
          </Card>
        )}
        {msg && <Note>{msg}</Note>}

        <SectionLabel>DCA purchase log</SectionLabel>
        <Note>Tap Edit to correct a buy. One recorded from the DCA screen also moved sats into holdings and cash out of Amber, and editing or removing it keeps those right.</Note>
        <Table head={['Date', 'A$', 'Sats', 'Price', '']} align={['left', 'right', 'right', 'right', 'right']}
          rows={[...(data?.dca || [])].sort((a, b) => b.date.localeCompare(a.date)).map(d => [
            d.date, aud(d.aud), d.sats == null ? '—' : d.sats.toLocaleString('en-AU'), aud(d.priceAud),
            <SmallButton key="e" onClick={() => setEntry({
              id: d.id, manual: d.manual, date: d.date, aud: String(d.aud), sats: d.sats == null ? '' : String(d.sats),
              priceAud: d.priceAud == null ? '' : String(Math.round(d.priceAud)), entity: d.entity || data?.settings?.dcaEntity || 'company', note: d.note || ''
            })}>Edit</SmallButton>
          ])} />
        {!entry && <SmallButton onClick={() => setEntry({ date: '', aud: '', sats: '', priceAud: '', entity: data?.settings?.dcaEntity || 'company', note: '' })}>Add a past buy</SmallButton>}
        {entry && (
          <BuyForm key={entry.id || 'new'} entities={ENTITIES} initial={entry}
            title={entry.id ? 'Edit buy' : 'Add a past buy'}
            note={entry.id
              ? (entry.manual ? 'Entered by hand, so it is in the log only.' : 'Recorded from the DCA screen: holdings and Amber cash follow any change here.')
              : 'A past buy goes in the log only. Holdings and Amber cash are set above.'}
            submitLabel={entry.id ? 'Save changes' : 'Add to log'}
            onCancel={() => setEntry(null)}
            onSubmit={async b => { if (await call(entry.id ? 'dca-edit' : 'dca-entry', b, entry.id ? 'Buy updated.' : 'Added to the log.')) setEntry(null) }}
            onDelete={entry.id ? async () => {
              if (window.confirm(`Remove the ${entry.date} buy of ${aud(Number(entry.aud))}?${entry.manual ? '' : ' Its sats come off holdings and the A$ goes back on Amber cash.'}`)
                && await call('dca-delete', { id: entry.id }, 'Removed.')) setEntry(null)
            } : null} />
        )}
      </Body>
    </Page>
  )
}
