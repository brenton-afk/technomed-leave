import React, { useState } from 'react'
import { Page, Header, Body, Card, SectionLabel, Button, Banner } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud } from '../../treasury/logic.js'
import { useTreasury, Field, fieldBox, Table, Note, Problem, SmallButton, treasuryCall, Locked, Grid, Figure, when } from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── ATO and cash ────────────────────────────────────────────────────────────
// The ATO schedule, editable; payroll and one-off items; and thirteen weeks of
// cash from the Xero balance forward.

const short = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function Cash({ user, onBack, onLocked }) {
  const { data, error, busy, reload } = useTreasury(user, 'cash', { onLocked, page: 'cash' })
  const [ato, setAto] = useState(null)
  const [item, setItem] = useState(null)
  const [payroll, setPayroll] = useState(null)
  const [msg, setMsg] = useState(null)

  async function call(action, body, done) {
    setMsg(null)
    try { await treasuryCall(user, action, { method: 'POST', body }); setMsg(done); reload(); return true } catch (err) {
      if (err instanceof Locked) onLocked(); else setMsg(err.message)
      return false
    }
  }

  const f = data?.forecast
  const src = data?.openingSource

  return (
    <Page>
      <Header eyebrow="Treasury" title="ATO and cash" onBack={onBack}
        right={<SmallButton onClick={() => reload({ refresh: '1' })} disabled={busy}>Refresh</SmallButton>} />
      <Body>
        <Problem>{error && 'Could not load this just now.'}</Problem>
        {data && (
          <Grid>
            <Figure label="Next ATO payment" value={aud(data.outlook.next?.amount)} sub={data.outlook.next ? `${data.outlook.next.label} · ${short(data.outlook.next.due)}` : 'Nothing scheduled'} />
            <Figure label="ATO, 30 days" value={aud(data.outlook.due30)} />
            <Figure label="ATO, 90 days" value={aud(data.outlook.due90)} />
          </Grid>
        )}
        {data?.outlook?.overdue?.length > 0 && <Banner tone="danger">{data.outlook.overdue.length} ATO payment{data.outlook.overdue.length === 1 ? ' is' : 's are'} past due and not marked paid.</Banner>}

        <SectionLabel>ATO schedule</SectionLabel>
        <Table head={['Due', 'What', 'A$', '']} align={['left', 'left', 'right', 'right']}
          rows={(data?.ato || []).map(a => [
            short(a.due), <span key="l" style={{ color: a.status === 'paid' ? colour.inkFaint : colour.ink }}>{a.label}{a.status === 'paid' ? ' · paid' : ''}</span>, aud(a.amount),
            <span key="b" style={{ display: 'inline-flex', gap: 6 }}>
              {a.status !== 'paid' && <SmallButton onClick={() => call('ato-save', { item: { ...a, status: 'paid' } }, 'Marked paid.')}>Paid</SmallButton>}
              <SmallButton onClick={() => setAto({ ...a, amount: String(a.amount) })}>Edit</SmallButton>
            </span>
          ])} />
        {!ato && <SmallButton onClick={() => setAto({ label: '', due: '', amount: '', status: 'due' })}>Add an ATO payment</SmallButton>}
        {ato && (
          <Card>
            <Field label="What"><input style={inputStyle} value={ato.label} placeholder="BAS Q2, PAYGW, income tax…" onChange={e => setAto({ ...ato, label: e.target.value })} /></Field>
            <Field label="Due"><input style={inputStyle} type="date" value={ato.due} onChange={e => setAto({ ...ato, due: e.target.value })} /></Field>
            <Field label="A$"><input style={inputStyle} inputMode="decimal" value={ato.amount} onChange={e => setAto({ ...ato, amount: e.target.value })} /></Field>
            <Field label="Status">
              <select style={inputStyle} value={ato.status} onChange={e => setAto({ ...ato, status: e.target.value })}>
                <option value="due">Due</option><option value="paid">Paid</option>
              </select>
            </Field>
            <Button onClick={async () => { if (await call('ato-save', { item: ato }, 'Saved.')) setAto(null) }}>Save</Button>
            <div style={{ height: space.sm }} />
            {ato.id && <><Button variant="danger" onClick={async () => { if (window.confirm('Delete this ATO entry?') && await call('ato-delete', { id: ato.id }, 'Deleted.')) setAto(null) }}>Delete</Button><div style={{ height: space.sm }} /></>}
            <Button variant="quiet" onClick={() => setAto(null)}>Cancel</Button>
          </Card>
        )}
        {msg && <Note>{msg}</Note>}

        <SectionLabel>13 weeks of cash</SectionLabel>
        {f && (
          <>
            <Note>
              Opening {aud(f.opening)} — {src ? (src.from === 'Xero' ? `Xero bank balance, ${when(src.at)}${src.stale ? ' (stale)' : ''}` : `entered by hand ${src.at || ''}`) : 'no bank balance yet; connect Xero or enter one in Settings'}.
              Receipts are invoices by due date; bills, ATO, payroll and one-offs come off.
            </Note>
            <Table head={['Week of', 'In', 'Out', 'Closing']} align={['left', 'right', 'right', 'right']}
              rows={f.weeks.map(w => [
                short(w.from), aud(w.receipts + Math.max(0, w.other)),
                aud(w.bills + w.ato + w.payroll + Math.max(0, -w.other)),
                <span key="c" style={{ ...text('bodyStrong'), color: w.closing < 0 ? colour.danger : colour.ink }}>{aud(w.closing)}</span>
              ])} />
            {f.overdueReceivables > 0 && <Note>{aud(f.overdueReceivables)} of overdue invoices is left out of every week, because when it will arrive is unknown.</Note>}
            {!data.xeroStatus.connected && <Banner tone="warning">Xero is not connected, so receipts and bills are missing from the weeks.</Banner>}
          </>
        )}

        <SectionLabel>Payroll</SectionLabel>
        {data && !payroll && (
          <Card onClick={() => setPayroll({ amount: String(data.settings.payroll?.amount || ''), nextDate: data.settings.payroll?.nextDate || '' })}>
            <div style={{ ...text('bodyStrong'), color: colour.ink }}>{aud(data.settings.payroll?.amount)} a fortnight</div>
            <div style={{ ...text('caption'), color: colour.inkFaint }}>{data.settings.payroll?.nextDate ? `Next pay ${short(data.settings.payroll.nextDate)} · tap to change` : 'Tap to set the amount and next pay date'}</div>
          </Card>
        )}
        {payroll && (
          <Card>
            <Field label="Fortnightly payroll, all-in (A$)"><input style={inputStyle} inputMode="decimal" value={payroll.amount} onChange={e => setPayroll({ ...payroll, amount: e.target.value })} /></Field>
            <Field label="Next pay date"><input style={inputStyle} type="date" value={payroll.nextDate} onChange={e => setPayroll({ ...payroll, nextDate: e.target.value })} /></Field>
            <Button onClick={async () => { if (await call('settings-save', { settings: { payroll } }, 'Payroll saved.')) setPayroll(null) }}>Save</Button>
            <div style={{ height: space.sm }} />
            <Button variant="quiet" onClick={() => setPayroll(null)}>Cancel</Button>
          </Card>
        )}

        <SectionLabel>One-off items</SectionLabel>
        <Table head={['Date', 'What', 'A$', '']} align={['left', 'left', 'right', 'right']}
          rows={(data?.items || []).map(i => [short(i.date), i.label, aud(i.amount),
            <SmallButton key="e" onClick={() => setItem({ ...i, amount: String(i.amount) })}>Edit</SmallButton>])} />
        {!item && <SmallButton onClick={() => setItem({ date: '', label: '', amount: '' })}>Add a one-off</SmallButton>}
        {item && (
          <Card>
            <Field label="What"><input style={inputStyle} value={item.label} onChange={e => setItem({ ...item, label: e.target.value })} /></Field>
            <Field label="Date"><input style={inputStyle} type="date" value={item.date} onChange={e => setItem({ ...item, date: e.target.value })} /></Field>
            <Field label="A$" hint="Money in is positive, money out negative."><input style={inputStyle} inputMode="decimal" value={item.amount} onChange={e => setItem({ ...item, amount: e.target.value })} /></Field>
            <Button onClick={async () => { if (await call('cashitem-save', { item }, 'Saved.')) setItem(null) }}>Save</Button>
            <div style={{ height: space.sm }} />
            {item.id && <><Button variant="danger" onClick={async () => { if (await call('cashitem-delete', { id: item.id }, 'Deleted.')) setItem(null) }}>Delete</Button><div style={{ height: space.sm }} /></>}
            <Button variant="quiet" onClick={() => setItem(null)}>Cancel</Button>
          </Card>
        )}
      </Body>
    </Page>
  )
}
