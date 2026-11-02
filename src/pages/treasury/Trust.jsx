import React, { useMemo, useState } from 'react'
import { Page, Header, Body, Card, SectionLabel, Button } from '../../design/Shell.jsx'
import { colour, text, space } from '../../design/tokens.js'
import { aud, fyLabel, trustTotals, trustCsv } from '../../treasury/logic.js'
import { useTreasury, Field, fieldBox, Table, Note, Problem, SmallButton, treasuryCall, Locked, Grid, Figure } from './ui.jsx'

const inputStyle = { ...fieldBox, ...text('field') }

// ─── Family trust ledger ─────────────────────────────────────────────────────
// Dated entries; totals for a financial year by category and party; a CSV for
// the accountant, built on the phone from what is on screen.

export default function Trust({ user, onBack, onLocked }) {
  const { data, error, reload } = useTreasury(user, 'trust', { onLocked, page: 'trust' })
  const [fy, setFy] = useState(null)
  const [entry, setEntry] = useState(null)
  const [msg, setMsg] = useState(null)
  const entries = useMemo(() => data?.entries || [], [data])
  const years = useMemo(() => [...new Set([data?.today && fyLabel(data.today), ...entries.map(e => fyLabel(e.date))].filter(Boolean))].sort().reverse(), [entries, data])
  const year = fy || years[0]
  const totals = trustTotals(entries, year)
  const shown = entries.filter(e => fyLabel(e.date) === year)

  async function call(action, body, done) {
    setMsg(null)
    try { await treasuryCall(user, action, { method: 'POST', body }); setMsg(done); reload(); return true } catch (err) {
      if (err instanceof Locked) onLocked(); else setMsg(err.message)
      return false
    }
  }

  function download() {
    const blob = new Blob([trustCsv(entries, year)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `family-trust-ledger-${year}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  return (
    <Page>
      <Header eyebrow="Treasury" title="Family trust ledger" onBack={onBack} subtitle={year ? `${year} · 1 July to 30 June` : ''} />
      <Body>
        <Problem>{error && 'Could not load the ledger just now.'}</Problem>
        <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', alignItems: 'center', marginBottom: space.md }}>
          {years.length > 0 && (
            <select aria-label="Financial year" style={{ ...inputStyle, width: 'auto' }} value={year} onChange={e => setFy(e.target.value)}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          <SmallButton onClick={download} disabled={!shown.length}>Export CSV for the accountant</SmallButton>
        </div>

        <Grid>
          <Figure label={`${year || ''} total`} value={aud(totals.total, { cents: true })} sub={`${totals.count} entries`} />
        </Grid>
        <SectionLabel>By category</SectionLabel>
        <Table head={['Category', 'A$']} align={['left', 'right']} rows={totals.byCategory.map(c => [c.name, aud(c.total, { cents: true })])} />
        <SectionLabel>By party</SectionLabel>
        <Table head={['Party', 'A$']} align={['left', 'right']} rows={totals.byParty.map(c => [c.name, aud(c.total, { cents: true })])} />

        <SectionLabel>Entries</SectionLabel>
        {!entry && <div style={{ marginBottom: space.md }}><SmallButton onClick={() => setEntry({ date: data?.today || '', category: 'Distribution', party: '', amount: '', note: '' })}>Add an entry</SmallButton></div>}
        {entry && (
          <Card>
            <Field label="Date"><input style={inputStyle} type="date" value={entry.date} onChange={e => setEntry({ ...entry, date: e.target.value })} /></Field>
            <Field label="Category">
              <select style={inputStyle} value={entry.category} onChange={e => setEntry({ ...entry, category: e.target.value })}>
                {[...new Set([...(data?.categories || []), entry.category])].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Party"><input style={inputStyle} value={entry.party} onChange={e => setEntry({ ...entry, party: e.target.value })} /></Field>
            <Field label="A$"><input style={inputStyle} inputMode="decimal" value={entry.amount} onChange={e => setEntry({ ...entry, amount: e.target.value })} /></Field>
            <Field label="Note"><input style={inputStyle} value={entry.note} onChange={e => setEntry({ ...entry, note: e.target.value })} /></Field>
            <Button onClick={async () => { if (await call('trust-save', { entry }, 'Saved.')) setEntry(null) }}>Save</Button>
            <div style={{ height: space.sm }} />
            {entry.id && <><Button variant="danger" onClick={async () => { if (window.confirm('Delete this entry?') && await call('trust-delete', { id: entry.id }, 'Deleted.')) setEntry(null) }}>Delete</Button><div style={{ height: space.sm }} /></>}
            <Button variant="quiet" onClick={() => setEntry(null)}>Cancel</Button>
          </Card>
        )}
        {msg && <Note>{msg}</Note>}
        {shown.map(e => (
          <Card key={e.id} onClick={() => setEntry({ ...e, amount: String(e.amount) })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: space.sm }}>
              <span style={{ ...text('bodyStrong'), color: colour.ink }}>{e.category}{e.party ? ` · ${e.party}` : ''}</span>
              <span style={{ ...text('bodyStrong'), color: colour.ink, whiteSpace: 'nowrap' }}>{aud(e.amount, { cents: true })}</span>
            </div>
            <div style={{ ...text('caption'), color: colour.inkFaint }}>{e.date}{e.note ? ` · ${e.note}` : ''}</div>
          </Card>
        ))}
        {!shown.length && data && <Note>No entries for {year} yet.</Note>}
      </Body>
    </Page>
  )
}
