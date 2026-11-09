import React, { useState, useEffect, useCallback } from 'react'
import { connectXero } from './xeroConnect.js'
import { todayStr } from '../../clinicalPlan/week.js'
import { parsePastedLines, lineAmount } from '../../invoiceLines.js'

// ─── Invoices and quotes (Brent, 5 Nov 2026) ─────────────────────────────────
// Calvary's purchase orders from accounts@, read by Claude into lines that a
// person checks, then a DRAFT invoice in Xero. Or a draft quote from nothing.
// Nothing is approved or sent from here — Xero holds the draft for accounts.
// A PO number already on an invoice in Xero is refused by the server.

const NAVY = '#042746'
const ACCENT = '#189a85'
const card = { background: 'white', borderRadius: 10, padding: '11px 13px', marginBottom: 8, border: '1px solid rgba(26,43,74,0.08)' }
const input = { padding: '7px 9px', borderRadius: 7, border: '1px solid rgba(26,43,74,0.18)', fontSize: 16, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }
const btn = (primary) => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: primary ? 'none' : '1px solid rgba(26,43,74,0.15)',
  background: primary ? ACCENT : 'white', color: primary ? 'white' : NAVY
})
const money = n => `$${(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function when(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

function AllowInvoices({ user }) {
  const [err, setErr] = useState('')
  return (
    <div style={{ ...card, background: '#fff8e6', border: '1px solid #f0d58a' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, marginBottom: 4 }}>Xero needs permission for invoices</div>
      <div style={{ fontSize: 13, color: '#5a6478', marginBottom: 10 }}>
        One tap, once. It adds invoicing to the existing Xero connection — leave and timesheets carry on as they are.
      </div>
      <button type="button" style={btn(true)}
        onClick={() => connectXero(user?.token, { invoices: true }).catch(e => setErr(e.message))}>Allow invoices →</button>
      {err && <div style={{ fontSize: 13, color: '#c0392b', marginTop: 8 }}>{err}</div>}
    </div>
  )
}

export default function Invoices({ user }) {
  const [list, setList] = useState({ outstanding: [], invoiced: [], noNumber: [], unchecked: [] })
  const [xero, setXero] = useState('ok')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null) // { kind, order?, ... }
  const [reading, setReading] = useState(null)
  const [open, setOpen] = useState('') // which folded group is showing
  const [auto, setAuto] = useState(null) // the last automatic pass: { running } | result
  const [requests, setRequests] = useState(null) // { running } | { requests, errors } | { error }
  const [templates, setTemplates] = useState(null) // { running } | { templates } | { error }
  const [audit, setAudit] = useState(null) // the accounts@ check: { running } | result | { error }
  const [supplier, setSupplier] = useState(false) // supplier quotes → POs

  const headers = user?.token ? { Authorization: `Bearer ${user.token}` } : {}
  const api = useCallback(async (action, { query = '', body } = {}) => {
    const res = await fetch(`/api/xero/info?action=${action}${query}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    const data = await res.json().catch(() => ({ error: `The server answered ${res.status}` }))
    if (!res.ok || data.error) throw Object.assign(new Error(data.error || `The server answered ${res.status}`), { code: data.code, status: res.status })
    return data
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await api('po-list')
      setList({ outstanding: data.outstanding || [], invoiced: data.invoiced || [], noNumber: data.noNumber || [], unchecked: data.unchecked || [] })
      setXero(data.xero || 'ok')
    } catch (err) { setError(err.message) }
    setLoading(false)
  }, [api])

  // Opening the tab also runs the automatic pass, so a PO that arrived since
  // the 9am or 6pm run is drafted now rather than waiting for the next one.
  const runAuto = useCallback(async () => {
    setAuto({ running: true })
    try {
      const result = await api('po-auto', { body: {} })
      const quotes = await api('quote-auto', { body: {} }).catch(() => null)
      setAuto({ ...result, quotes })
      if (result.drafted?.length || result.held?.length || result.failed?.length) await load()
    } catch (err) {
      setAuto({ error: err.code === 'permission' ? null : err.message })
    }
  }, [api, load])

  useEffect(() => { load().then(() => runAuto()) }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  async function showRequests() {
    setRequests({ running: true })
    try { setRequests(await api('quote-requests')) } catch (err) { setRequests({ error: err.message }) }
  }

  async function showTemplates() {
    setTemplates({ running: true })
    try { setTemplates(await api('quote-templates')) } catch (err) {
      if (err.code === 'permission') setXero('permission')
      setTemplates({ error: err.message })
    }
  }

  async function checkAccounts() {
    setAudit({ running: true })
    try { setAudit(await api('accounts-audit')) } catch (err) { setAudit({ error: err.message }) }
  }

  async function retry(o) {
    try { await api('po-retry', { body: { po: o.poNumber } }); await runAuto() } catch (err) { setError(err.message) }
  }

  async function readOrder(o) {
    setReading(o.id); setError('')
    try {
      const { order } = await api('po-read', { query: `&id=${encodeURIComponent(o.id)}` })
      setDraft({ kind: 'invoice', order, source: o })
    } catch (err) { setError(err.message) }
    setReading(null)
  }

  if (draft) {
    return <Editor api={api} draft={draft} onClose={(made) => { setDraft(null); if (made) load() }} />
  }
  if (supplier) return <SupplierPos api={api} onClose={() => setSupplier(false)} onPermission={() => setXero('permission')} />

  const muted = { fontSize: 13, color: '#5a6478' }
  const fold = (id, label, rows, render) => rows.length > 0 && (
    <div style={{ marginTop: 10 }}>
      <button style={{ ...btn(false), width: '100%', textAlign: 'left' }} onClick={() => setOpen(v => v === id ? '' : id)}>
        {open === id ? '▾' : '▸'} {label} ({rows.length})
      </button>
      {open === id && <div style={{ marginTop: 8 }}>{rows.map(render)}</div>}
    </div>
  )
  const orderCard = (o, { action, badge } = {}) => (
    <div key={o.id} style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{o.poNumber || 'No PO number found'}</div>
        <div style={{ fontSize: 12, color: '#5a6478' }}>{when(o.receivedAt)}</div>
        {o.copies > 1 && <span style={{ fontSize: 11, color: '#5a6478' }}>sent {o.copies} times</span>}
        {badge}
      </div>
      <div style={{ fontSize: 13, color: '#5a6478', marginTop: 3 }}>{o.subject}</div>
      <div style={{ fontSize: 12, color: '#8a93a6', marginTop: 2 }}>{o.from}{o.files?.length ? ` · ${o.files.join(', ')}` : ''}</div>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
  const readButton = (o, primary = true) => (
    <button style={btn(primary)} disabled={reading === o.id} onClick={() => readOrder(o)}>
      {reading === o.id ? 'Reading the order…' : 'Read PO'}
    </button>
  )

  return (
    <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      {/* The page title is in the admin header; the actions wrap into a grid,
          so they never push the page wider than a phone. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, marginBottom: 12 }}>
          <button style={btn(true)} onClick={() => setSupplier(true)}>Supplier quotes → PO</button>
          <button style={btn(false)} onClick={showRequests} disabled={requests?.running}>{requests?.running ? 'Looking…' : 'Quote requests'}</button>
          <button style={btn(false)} onClick={showTemplates} disabled={templates?.running}>{templates?.running ? 'Reading templates…' : 'Quote templates'}</button>
          <button style={btn(false)} onClick={checkAccounts} disabled={audit?.running}>{audit?.running ? 'Checking accounts@…' : 'Check accounts@'}</button>
          <button style={btn(false)} onClick={load}>Refresh</button>
          <button style={btn(true)} onClick={() => setDraft({ kind: 'invoice', blank: true })}>New invoice</button>
          <button style={btn(true)} onClick={() => setDraft({ kind: 'quote' })}>New quote</button>
      </div>
      <div style={{ ...muted, marginBottom: 12 }}>
        Calvary purchase orders in accounts@ are turned into <b>draft</b> invoices in Xero by themselves —
        at 9am and 6pm, and whenever this page is opened. Approve and send them in Xero as usual.
        Only a PO that could not be done the usual way is left here, with the reason.
      </div>

      {requests && !requests.running && <QuoteRequests data={requests} onClose={() => setRequests(null)} onRetry={async id => { try { await api('quote-retry', { body: { id } }); await api('quote-auto', { body: {} }); await showRequests() } catch (err) { setError(err.message) } }} />}
      {templates && !templates.running && <QuoteTemplates data={templates} onClose={() => setTemplates(null)} />}
      {audit && !audit.running && <AccountsAudit audit={audit} onClose={() => setAudit(null)} />}
      {xero === 'permission' && <AllowInvoices user={user} />}
      {xero === 'error' && <div style={{ ...card, color: '#b42318', fontSize: 13 }}>Xero could not be checked just now, so no purchase order is offered — one may already be invoiced. Try Refresh.</div>}
      {error && <div style={{ ...card, color: '#b42318', fontSize: 13 }}>{error}</div>}
      {loading && <div style={muted}>Looking in accounts@ and checking Xero…</div>}
      {auto?.running && <div style={{ ...muted, margin: '4px 0 8px' }}>Making draft invoices for any new purchase orders…</div>}
      {auto?.drafted?.length > 0 && (
        <div style={{ ...card, background: '#e6f4f1', border: '1px solid #bfe3db', fontSize: 13, color: NAVY }}>
          Drafted in Xero just now: {auto.drafted.map(d => `${d.invoice} for ${d.po}`).join(', ')}. Approve them in Xero.
        </div>
      )}
      {(auto?.quotes?.drafted?.length > 0 || auto?.quotes?.followed?.length > 0) && (
        <div style={{ ...card, background: '#e6f4f1', border: '1px solid #bfe3db', fontSize: 13, color: NAVY }}>
          {auto.quotes.drafted?.length > 0 && <div>Self-funding quotes drafted in Xero: {auto.quotes.drafted.map(d => d.quote).join(', ')}. Check and send them from Xero.</div>}
          {auto.quotes.followed?.length > 0 && <div>Sent quotes filed and distributors told: {auto.quotes.followed.map(f => f.quote).join(', ')}.</div>}
        </div>
      )}
      {auto?.paused && (
        <div style={{ ...card, fontSize: 13, color: '#4b5b68' }}>
          Automatic PO invoicing is paused — nothing is drafted by itself. Read a PO and draft it by hand if needed.
        </div>
      )}
      {auto?.error && <div style={{ ...card, color: '#b42318', fontSize: 13 }}>The automatic pass did not finish: {auto.error}</div>}

      {!loading && xero === 'ok' && (
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: '6px 0 8px' }}>
          {list.outstanding.length ? `Needs you (${list.outstanding.length})` : 'Nothing waiting — every purchase order with a PO number is invoiced in Xero.'}
        </div>
      )}
      {list.outstanding.map(o => orderCard(o, {
        badge: o.auto?.status === 'held' || o.auto?.status === 'failed'
          ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#fff4e5', color: '#b54708' }}>{o.auto.status === 'held' ? 'Held' : 'Could not be read'}</span>
          : <span style={{ fontSize: 11, color: '#5a6478' }}>not drafted yet</span>,
        action: <>
          {o.auto?.reason && <div style={{ fontSize: 13, color: '#b54708', marginBottom: 6 }}>{o.auto.reason}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {o.auto && <button style={btn(true)} disabled={auto?.running} onClick={() => retry(o)}>Try again</button>}
            {readButton(o, !o.auto)}
          </div>
        </>
      }))}

      {fold('none', 'No PO number found — check by hand', list.noNumber, o => orderCard(o, { action: readButton(o, false) }))}
      {fold('done', 'Already invoiced in Xero', list.invoiced, o => orderCard(o, {
        badge: <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#e6f4f1', color: ACCENT }}>
          {o.invoices.map(i => `${i.number || 'draft'} (${String(i.status).toLowerCase()})`).join(', ')}
          {o.auto?.status === 'drafted' && !o.auto.note ? ' · drafted automatically' : ''}
        </span>
      }))}
      {fold('unchecked', 'Not checked against Xero', list.unchecked, o => orderCard(o))}
    </div>
  )
}

// Read-only: CNS's self-funding quote requests in bookings@ and brenton@.
function QuoteRequests({ data, onClose, onRetry }) {
  if (data.error) return <div style={{ ...card, color: '#b42318', fontSize: 13 }}>Could not read the mailboxes: {data.error}</div>
  const list = data.requests || []
  const row = { fontSize: 12, color: '#5a6478' }
  return (
    <div style={{ ...card, border: '1px solid rgba(24,154,133,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Quote requests from CNS — last 60 days ({list.length})</div>
        <button style={{ ...btn(false), marginLeft: 'auto', padding: '4px 10px' }} onClick={onClose}>Close</button>
      </div>
      {(data.errors || []).map(e => <div key={e.mailbox} style={{ fontSize: 12, color: '#b42318' }}>{e.mailbox}: {e.error}</div>)}
      {!list.length && <div style={row}>None found in bookings@ or brenton@.</div>}
      {list.map(r => (
        <div key={r.id} style={{ borderTop: '1px solid rgba(26,43,74,0.08)', paddingTop: 6, marginTop: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{when(r.receivedAt)} · {r.subject || '(no subject)'}</div>
          <div style={row}>{r.from} · in {r.mailboxes.join(' and ')}</div>
          <div style={row}>{[r.levels && `Levels ${r.levels}`, r.mbs.length && `MBS ${r.mbs.join(', ')}`, r.uninsured && 'uninsured'].filter(Boolean).join(' · ') || 'No levels or MBS items read'}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: r.auto?.status === 'held' ? '#b54708' : ACCENT, marginTop: 2 }}>
            {!r.auto ? 'Not drafted yet'
              : r.auto.status === 'held' ? `Held: ${r.auto.reason}`
                : r.auto.status === 'drafted' ? `Draft ${r.auto.quoteNumber} in Xero (${r.auto.template}) — send it from Xero; the distributors are told after`
                  : r.auto.status === 'already' ? `${r.auto.reason} — nothing new drafted`
                  : r.auto.status === 'sent' ? `Sent · ${r.auto.filed ? 'filed in Dropbox' : 'not filed'} · told: ${(r.auto.notified || []).join(', ') || 'no distributor found on the quote'}`
                    : r.auto.reason || r.auto.status}
          </div>
          {r.auto?.status === 'drafted' && r.auto.priceList && <div style={row}>Prices from {r.auto.priceList}</div>}
          {r.auto?.status === 'drafted' && (r.auto.flags || []).map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: '#b54708' }}>Check: {[f.code, f.description].filter(Boolean).join(' ')}{f.price != null ? ` at $${Number(f.price).toFixed(2)}` : ''} — {f.reason}</div>
          ))}
          {r.auto?.status === 'held' && onRetry && <button style={{ ...btn(false), marginTop: 4, padding: '4px 10px' }} onClick={() => onRetry(r.id)}>Try again</button>}
        </div>
      ))}
    </div>
  )
}

// Read-only: the quotes kept in Xero as templates, line by line.
function QuoteTemplates({ data, onClose }) {
  if (data.error) return <div style={{ ...card, color: '#b42318', fontSize: 13 }}>Could not read the templates: {data.error}</div>
  const list = data.templates || []
  return (
    <div style={{ ...card, border: '1px solid rgba(24,154,133,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Quote templates in Xero ({list.length})</div>
        <button style={{ ...btn(false), marginLeft: 'auto', padding: '4px 10px' }} onClick={onClose}>Close</button>
      </div>
      {!list.length && <div style={{ fontSize: 13, color: '#5a6478' }}>No quotes found for a contact named "DRAFT QUOTE TEMPLATE".</div>}
      {list.map(q => (
        <div key={q.id} style={{ borderTop: '1px solid rgba(26,43,74,0.08)', paddingTop: 8, marginTop: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{q.title || q.reference || q.number} <span style={{ fontWeight: 400, color: '#5a6478', fontSize: 12 }}>{q.number} · {String(q.status).toLowerCase()} · {money(q.total)}</span></div>
          {q.summary && <div style={{ fontSize: 12, color: '#5a6478', whiteSpace: 'pre-wrap' }}>{q.summary}</div>}
          {q.lines.map((l, i) => (
            <div key={i} style={{ fontSize: 13, color: '#1f2a3d' }}>
              {l.quantity} × {l.code ? `${l.code} ` : ''}{l.description} · {money(l.unitPrice)}{l.discount ? ` · ${l.discount}% off` : ''}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Read-only: what Calvary has sent accounts@ and where each is filed.
function AccountsAudit({ audit, onClose }) {
  if (audit.error) return <div style={{ ...card, color: '#b42318', fontSize: 13 }}>Could not read accounts@: {audit.error}</div>
  const row = { fontSize: 13, color: '#5a6478', margin: '2px 0' }
  return (
    <div style={{ ...card, border: '1px solid rgba(24,154,133,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>accounts@ — last {audit.days} days from Calvary</div>
        <button style={{ ...btn(false), marginLeft: 'auto', padding: '4px 10px' }} onClick={onClose}>Close</button>
      </div>
      <div style={row}>
        {Object.entries(audit.counts || {}).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(' · ') || 'Nothing from Calvary.'}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginTop: 10 }}>How it is filed now</div>
      {Object.entries(audit.filing || {}).map(([kind, by]) => (
        <div key={kind} style={row}><b>{kind}:</b> {Object.entries(by).map(([l, n]) => `${l} (${n})`).join(', ')}</div>
      ))}
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginTop: 10 }}>Remittances ({audit.remittances.length})</div>
      {!audit.remittances.length && <div style={row}>None found — Calvary may not be emailing remittances to accounts@.</div>}
      {audit.remittances.map(r => (
        <div key={r.id} style={{ ...row, borderTop: '1px solid rgba(26,43,74,0.08)', paddingTop: 6, marginTop: 6 }}>
          <div style={{ color: NAVY, fontWeight: 600 }}>{when(r.receivedAt)} · {r.subject || '(no subject)'}</div>
          <div>{r.files.length ? r.files.join(', ') : 'no attachment'} · filed under: {r.filedUnder.join(', ') || 'not filed'}{r.inbox ? ' · still in inbox' : ''}</div>
          <div>{r.invoices.length ? `Our invoices named: ${r.invoices.join(', ')}` : 'No invoice numbers in the email text (may be in the attachment)'}</div>
        </div>
      ))}
      {audit.others?.length > 0 && <>
        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginTop: 10 }}>Other Calvary mail ({audit.others.length})</div>
        {audit.others.map(o => <div key={o.id} style={row}>{when(o.receivedAt)} · {o.subject} · {o.filedUnder.join(', ') || 'not filed'}</div>)}
      </>}
      <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginTop: 10 }}>All folders in accounts@</div>
      <div style={row}>{audit.labels.join(' · ') || 'No folders.'}</div>
    </div>
  )
}

const blankLine = () => ({ code: '', description: '', quantity: 1, unitPrice: '', discount: '' })

function Editor({ api, draft, onClose }) {
  const isInvoice = draft.kind === 'invoice'
  const order = draft.order || {}
  // An invoice from a PO is for Calvary; a new one (commissions, fees) can be for anyone.
  const [search, setSearch] = useState(isInvoice && !draft.blank ? 'Calvary' : '')
  const [dueDate, setDueDate] = useState('')
  const [accountCode, setAccountCode] = useState('200')
  const [contacts, setContacts] = useState([])
  const [items, setItems] = useState([])
  const [contactId, setContactId] = useState('')
  const [reference, setReference] = useState(order.poNumber || '')
  const [date, setDate] = useState(order.date || todayStr())
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [paste, setPaste] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [lines, setLines] = useState(order.lines?.length ? order.lines.map(l => ({ ...l, unitPrice: l.unitPrice || '' })) : [blankLine()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [permission, setPermission] = useState(false)
  const [made, setMade] = useState(null)

  const lookup = useCallback(async (q) => {
    try {
      const data = await api('sales-lookup', { query: `&q=${encodeURIComponent(q)}` })
      setContacts(data.contacts || []); setItems(data.items || [])
      setContactId(id => id || (data.contacts?.length === 1 ? data.contacts[0].id : id))
      setPermission(false)
    } catch (err) {
      if (err.code === 'permission') setPermission(true)
      else setError(err.message)
    }
  }, [api])

  useEffect(() => { lookup(search) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const itemFor = code => items.find(i => String(i.code).toUpperCase() === String(code || '').toUpperCase())
  const setLine = (n, patch) => setLines(ls => ls.map((l, i) => i === n ? { ...l, ...patch } : l))
  const total = lines.reduce((s, l) => s + lineAmount(l), 0)
  function addPasted() {
    const got = parsePastedLines(paste)
    if (!got.length) { setError('No lines found — copy the rows (code, description, quantity, price, discount) from the spreadsheet and paste them here.'); return }
    setError('')
    setLines(ls => [...ls.filter(l => l.code || l.description || l.unitPrice !== ''), ...got])
    setPaste('')
  }

  async function submit() {
    setBusy(true); setError('')
    try {
      const body = { contactId, reference, date, ...(isInvoice ? { dueDate: dueDate || undefined, accountCode } : {}), lines: lines.map(l => ({ ...l, unitPrice: l.unitPrice === '' ? NaN : Number(l.unitPrice), discount: Number(l.discount) || 0 })) }
      if (isInvoice) {
        const { invoice } = await api('invoice-create', { body })
        setMade({ ...invoice, what: 'invoice' })
      } else {
        const { quote } = await api('quote-create', { body: { ...body, title, summary, expiryDate } })
        setMade({ ...quote, what: 'quote' })
      }
    } catch (err) {
      if (err.code === 'permission') setPermission(true)
      setError(err.message)
    }
    setBusy(false)
  }

  if (made) {
    return (
      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 6 }}>Draft {made.what} made in Xero</div>
        <div style={{ fontSize: 14, color: '#5a6478', marginBottom: 12 }}>
          {made.number ? `${made.number} · ` : ''}{money(made.total)} incl. GST · waiting in Xero as a draft for checking and approval.
        </div>
        <button style={btn(true)} onClick={() => onClose(true)}>Done</button>
      </div>
    )
  }

  const label = { fontSize: 12, fontWeight: 600, color: '#5a6478', marginBottom: 3, display: 'block' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button style={btn(false)} onClick={() => onClose(false)}>← Back</button>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{isInvoice ? (draft.blank ? 'New invoice' : `Invoice for ${order.poNumber || 'this order'}`) : 'New quote'}</div>
      </div>

      {permission && <AllowInvoices user={user} />}

      {isInvoice && !draft.blank && (
        <div style={{ ...card, fontSize: 13, color: '#5a6478' }}>
          Read from the order by Claude — check every line against the PDF before making the draft.
          {order.requestedBy && <div>Requested by: {order.requestedBy}</div>}
          {order.deliverTo && <div>Deliver to: {order.deliverTo}</div>}
          {order.reference && <div>The order asks to quote: <b>{order.reference}</b></div>}
          {order.totalExGst > 0 && <div>Order total (ex GST): {money(order.totalExGst)}</div>}
          {order.notes && <div>Notes: {order.notes}</div>}
        </div>
      )}

      <div style={card}>
        <label style={label}>Customer</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input style={input} value={search} placeholder="Search Xero contacts" onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') lookup(search) }} />
          <button style={btn(false)} onClick={() => lookup(search)}>Search</button>
        </div>
        <select style={input} value={contactId} onChange={e => setContactId(e.target.value)}>
          <option value="">{contacts.length ? 'Choose the customer…' : 'No matching contacts'}</option>
          {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 10 }}>
          <div><label style={label}>{isInvoice && !draft.blank ? 'Reference (PO number)' : 'Reference'}</label>
            <input style={input} value={reference} onChange={e => setReference(e.target.value)} /></div>
          <div><label style={label}>Date</label>
            <input style={input} type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          {isInvoice && <>
            <div><label style={label}>Due</label>
              <input style={input} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
            <div><label style={label}>Account (lines without a code)</label>
              <input style={input} value={accountCode} onChange={e => setAccountCode(e.target.value)} /></div>
          </>}
          {!isInvoice && <>
            <div><label style={label}>Expires</label>
              <input style={input} type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></div>
            <div><label style={label}>Title</label>
              <input style={input} value={title} onChange={e => setTitle(e.target.value)} /></div>
          </>}
        </div>
        {!isInvoice && <div style={{ marginTop: 10 }}>
          <label style={label}>Summary (shown at the top of the quote)</label>
          <textarea style={{ ...input, minHeight: 80 }} value={summary} placeholder={'Surgeon: …\nPatient: …\nProcedure: …\nKit/System: …'} onChange={e => setSummary(e.target.value)} />
        </div>}
      </div>

      <div style={card}>
        <label style={label}>Paste lines from a spreadsheet</label>
        <textarea style={{ ...input, minHeight: 60 }} value={paste} placeholder="Copy the rows (code, description, quantity, price, discount) and paste here"
          onChange={e => setPaste(e.target.value)} />
        <button style={{ ...btn(false), marginTop: 6 }} disabled={!paste.trim()} onClick={addPasted}>Add these lines</button>
      </div>

      <datalist id="xero-items">
        {items.map(i => <option key={i.code} value={i.code}>{i.name}</option>)}
      </datalist>

      {lines.map((l, n) => {
        const item = itemFor(l.code)
        const xeroPrice = item && Number.isFinite(item.price) ? item.price : null
        return (
          <div key={n} style={card}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 64px auto', gap: 6, alignItems: 'end' }}>
              <div><label style={label}>Code</label>
                <input style={input} list="xero-items" value={l.code} onChange={e => {
                  const code = e.target.value
                  const it = itemFor(code)
                  setLine(n, { code, ...(it && !l.description ? { description: it.description || it.name } : {}), ...(it && l.unitPrice === '' && Number.isFinite(it.price) ? { unitPrice: it.price } : {}) })
                }} /></div>
              <div><label style={label}>Qty</label>
                <input style={input} type="number" min="0" step="1" value={l.quantity} onChange={e => setLine(n, { quantity: e.target.value })} /></div>
              <div><label style={label}>Unit ex GST</label>
                <input style={input} type="number" min="0" step="0.01" value={l.unitPrice} onChange={e => setLine(n, { unitPrice: e.target.value })} /></div>
              <div><label style={label}>Disc %</label>
                <input style={input} type="number" min="0" max="100" step="1" value={l.discount ?? ''} onChange={e => setLine(n, { discount: e.target.value })} /></div>
              <button style={{ ...btn(false), padding: '7px 10px' }} aria-label="Remove line" onClick={() => setLines(ls => ls.filter((_, i) => i !== n))}>✕</button>
            </div>
            <input style={{ ...input, marginTop: 6 }} placeholder="Description" value={l.description} onChange={e => setLine(n, { description: e.target.value })} />
            <div style={{ fontSize: 12, marginTop: 4, color: item ? ACCENT : '#b54708' }}>
              {!l.code ? 'No code — goes on as a description only.'
                : item ? `Xero item: ${item.name}${xeroPrice != null ? ` · ${money(xeroPrice)}` : ''}`
                  : 'Not a Xero item — the code goes into the description.'}
              {xeroPrice != null && l.unitPrice !== '' && Math.abs(Number(l.unitPrice) - xeroPrice) > 0.005 && (
                <> · <button style={{ border: 'none', background: 'none', color: ACCENT, textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 12 }}
                  onClick={() => setLine(n, { unitPrice: xeroPrice })}>use Xero's {money(xeroPrice)}</button></>
              )}
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button style={btn(false)} onClick={() => setLines(ls => [...ls, blankLine()])}>+ Add a line</button>
        <div style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: NAVY }}>{money(total)} ex GST</div>
      </div>

      {error && <div style={{ ...card, color: '#b42318', fontSize: 13 }}>{error}</div>}

      <button style={{ ...btn(true), width: '100%', padding: '11px 14px', fontSize: 14, opacity: busy || !contactId ? 0.6 : 1 }}
        disabled={busy || !contactId} onClick={submit}>
        {busy ? 'Making the draft in Xero…' : isInvoice ? 'Create draft invoice in Xero' : 'Create draft quote in Xero'}
      </button>
    </div>
  )
}

// ─── Supplier quotes → purchase orders (Brent, 9 Nov 2026) ───────────────────
// "Build a module in the portal so I can just tap check for POs in email …
// read a quote and generate a PO." Check finds supplier emails in brenton@ and
// admin@ with a quote attached or a PO asked for; Read quote fills the lines;
// the person checks them and saves a DRAFT PO in Xero — or, when the email
// names one of ours (Cody: "updated PO-0147"), replaces that PO's lines.
// Nothing is approved or sent from here: send the PO from Xero.
export function SupplierPos({ api, onClose, onPermission }) {
  const [list, setList] = useState(null) // { running } | { requests, errors } | { error }
  const [open, setOpen] = useState(null) // the request being read / edited
  const [read, setRead] = useState(null) // { running } | reading | { error }
  const [form, setForm] = useState(null) // { contactId, lines, freight, reference }
  const [saving, setSaving] = useState('')
  const [done, setDone] = useState(null)
  const [showDone, setShowDone] = useState(false)

  const check = useCallback(async () => {
    setList({ running: true })
    try { setList(await api('supplier-quotes')) } catch (err) { setList({ error: err.message }) }
  }, [api])
  useEffect(() => { check() }, [check])

  async function readQuote(r) {
    setOpen(r); setRead({ running: true }); setDone(null); setForm(null)
    try {
      const data = await api('supplier-quote-read', { query: `&id=${encodeURIComponent(r.id)}&mailbox=${encodeURIComponent(r.mailbox)}` })
      setRead(data)
      setForm({
        contactId: data.existing?.contact?.id || data.contacts?.[0]?.id || '',
        lines: data.quote.lines.length ? data.quote.lines : [{ code: '', description: '', quantity: 1, unitPrice: '' }],
        freight: data.quote.freight || 0,
        reference: data.existing ? '' : (data.quote.lines[0]?.description || '').slice(0, 60)
      })
    } catch (err) {
      if (err.code === 'permission') onPermission()
      setRead({ error: err.message })
    }
  }

  async function save(update) {
    setSaving(update ? 'update' : 'new')
    try {
      const result = await api('supplier-po-save', { body: {
        messageId: open.id, contactId: form.contactId, update: update || null,
        lines: form.lines, freight: Number(form.freight) || 0,
        reference: form.reference, quoteNumber: read.quote.quoteNumber
      } })
      setDone(result)
      check()
    } catch (err) {
      if (err.code === 'permission') onPermission()
      setRead(r => ({ ...r, saveError: err.message }))
    }
    setSaving('')
  }

  async function dismiss(r) {
    try { await api('supplier-quote-dismiss', { body: { messageId: r.id } }); check() } catch (err) { setList(l => ({ ...l, error: err.message })) }
  }

  const muted = { fontSize: 13, color: '#5a6478' }
  const setLine = (i, key, value) => setForm(f => ({ ...f, lines: f.lines.map((l, n) => (n === i ? { ...l, [key]: value } : l)) }))
  const subTotal = form ? form.lines.reduce((t, l) => t + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0) + (Number(form.freight) || 0) : 0

  if (open) {
    const existing = read?.existing
    const canUpdate = existing && !['BILLED', 'DELETED'].includes(existing.status)
    return (
      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }} data-supplier-po>
        <button style={{ ...btn(false), marginBottom: 10 }} onClick={() => { setOpen(null); setRead(null); setDone(null) }}>← Supplier quotes</button>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{open.subject}</div>
          <div style={muted}>{open.from} · {when(open.receivedAt)}{open.files?.length ? ` · ${open.files.join(', ')}` : ''}</div>
        </div>
        {read?.running && <div style={muted}>Reading the quote and looking in Xero…</div>}
        {read?.error && <div style={{ ...card, color: '#b42318', fontSize: 13 }}>{read.error}</div>}
        {done && (
          <div style={{ ...card, background: '#e6f4f1', border: '1px solid #bfe3db', fontSize: 14, color: NAVY }} data-po-done>
            <b>{done.po.number}</b> {done.record.status === 'updated' ? 'updated' : 'drafted'} in Xero — {money(done.po.total)} inc GST.
            <div style={{ ...muted, marginTop: 4 }}>Check it and send it to the supplier from Xero.</div>
            {done.po.id && <a href={`https://go.xero.com/Accounts/Payable/PurchaseOrders/View/${done.po.id}`} target="_blank" rel="noreferrer" style={{ ...btn(true), display: 'inline-block', marginTop: 8, textDecoration: 'none' }}>Open in Xero</a>}
          </div>
        )}
        {read && !read.running && !read.error && form && !done && (
          <>
            <div style={card}>
              <div style={{ fontSize: 13, color: NAVY }}>
                <b>{read.quote.supplier || 'Supplier'}</b>{read.quote.quoteNumber ? ` · quote ${read.quote.quoteNumber}` : ''}{read.quote.quoteDate ? ` · ${when(read.quote.quoteDate)}` : ''}
              </div>
              {read.quote.checks.length > 0 && (
                <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#fff4e5', color: '#b54708', fontSize: 13 }} data-quote-checks>
                  <b>Check before ordering:</b>
                  {read.quote.checks.map((c, i) => <div key={i}>• {c}</div>)}
                </div>
              )}
              {existing && (
                <div style={{ marginTop: 8, fontSize: 13, color: NAVY }}>
                  The email asks about <b>{existing.number}</b> ({String(existing.status).toLowerCase()}, {existing.contact.name}): now {money(existing.total)} inc GST
                  {existing.lines.map((l, i) => <div key={i} style={muted}>{l.quantity} × {l.description} @ {money(l.unitPrice)}</div>)}
                </div>
              )}
              {read.quote.poNumber && !existing && <div style={{ ...muted, marginTop: 8 }}>The email mentions {read.quote.poNumber}, but Xero has no PO with that number.</div>}
            </div>

            <div style={card}>
              <label style={{ ...muted, display: 'block', marginBottom: 4 }}>Supplier in Xero</label>
              <select style={input} value={form.contactId} onChange={e => setForm(f => ({ ...f, contactId: e.target.value }))} disabled={Boolean(canUpdate)}>
                <option value="">{read.contacts.length ? 'Choose…' : 'No match found in Xero — add the supplier in Xero first'}</option>
                {read.contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {!canUpdate && (
                <>
                  <label style={{ ...muted, display: 'block', margin: '8px 0 4px' }}>Reference</label>
                  <input style={input} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
                </>
              )}
            </div>

            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 6 }}>Lines (ex GST)</div>
              {form.lines.map((l, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid rgba(26,43,74,0.08)' }} data-po-line>
                  <input style={input} placeholder="Code" value={l.code} onChange={e => setLine(i, 'code', e.target.value)} />
                  <input style={input} placeholder="Description" value={l.description} onChange={e => setLine(i, 'description', e.target.value)} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'center' }}>
                    <input style={input} inputMode="numeric" aria-label="Quantity" value={l.quantity ?? ''} onChange={e => setLine(i, 'quantity', e.target.value)} />
                    <input style={input} inputMode="decimal" aria-label="Unit price" value={l.unitPrice ?? ''} onChange={e => setLine(i, 'unitPrice', e.target.value)} />
                    <button style={btn(false)} onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, n) => n !== i) }))} aria-label="Remove line">✕</button>
                  </div>
                </div>
              ))}
              <button style={btn(false)} onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { code: '', description: '', quantity: 1, unitPrice: '' }] }))}>Add a line</button>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, alignItems: 'center', marginTop: 8 }}>
                <span style={muted}>Freight (ex GST)</span>
                <input style={input} inputMode="decimal" value={form.freight} onChange={e => setForm(f => ({ ...f, freight: e.target.value }))} />
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: NAVY }} data-po-total>
                {money(subTotal)} + GST {money(subTotal * 0.1)} = <b>{money(subTotal * 1.1)}</b>
                {read.quote.totalExGst != null && Math.abs(read.quote.totalExGst - subTotal) > 0.01 && (
                  <div style={{ fontSize: 13, color: '#b54708' }}>The quote's total is {money(read.quote.totalExGst)} ex GST — check the lines.</div>
                )}
              </div>
            </div>

            {read.saveError && <div style={{ ...card, color: '#b42318', fontSize: 13 }}>{read.saveError}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {canUpdate && <button style={btn(true)} disabled={Boolean(saving)} onClick={() => save(existing.number)}>{saving === 'update' ? 'Updating…' : `Update ${existing.number} in Xero`}</button>}
              <button style={btn(!canUpdate)} disabled={Boolean(saving) || !form.contactId} onClick={() => save(null)}>{saving === 'new' ? 'Drafting…' : 'Draft a new PO in Xero'}</button>
            </div>
            <div style={{ ...muted, marginTop: 8 }}>A new PO is saved as a <b>draft</b>. Updating keeps the PO's status and number. Nothing is sent to the supplier — send it from Xero.</div>
          </>
        )}
      </div>
    )
  }

  const waiting = (list?.requests || []).filter(r => !r.done)
  const handled = (list?.requests || []).filter(r => r.done)
  const row = r => (
    <div key={r.id} style={card} data-supplier-quote>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{r.subject || '(no subject)'}</div>
        {r.poNumber && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#eef3fb', color: NAVY }}>{r.poNumber}</span>}
        {r.done && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#e6f4f1', color: ACCENT }}>{r.done.status === 'dismissed' ? 'Not a PO request' : `${r.done.po} ${r.done.status}`}</span>}
      </div>
      <div style={muted}>{r.from} · {when(r.receivedAt)} · {r.mailbox.split('@')[0]}@</div>
      {r.files?.length > 0 && <div style={{ fontSize: 12, color: '#8a93a6' }}>{r.files.join(', ')}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button style={btn(!r.done)} onClick={() => readQuote(r)}>Read quote</button>
        {!r.done && <button style={btn(false)} onClick={() => dismiss(r)}>Not a PO request</button>}
      </div>
    </div>
  )
  return (
    <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button style={btn(false)} onClick={onClose}>← Invoices</button>
        <button style={btn(true)} onClick={check} disabled={list?.running}>{list?.running ? 'Checking email…' : 'Check email for supplier quotes'}</button>
      </div>
      <div style={{ ...muted, marginBottom: 10 }}>Supplier emails in brenton@ and admin@ with a quote attached or a PO asked for. Read one to turn it into a purchase order in Xero.</div>
      {list?.error && <div style={{ ...card, color: '#b42318', fontSize: 13 }}>{list.error}</div>}
      {list?.errors?.map(e => <div key={e.mailbox} style={{ ...card, color: '#b54708', fontSize: 13 }}>{e.mailbox} could not be read: {e.error}</div>)}
      {list && !list.running && !list.error && waiting.length === 0 && <div style={muted}>Nothing waiting.</div>}
      {waiting.map(row)}
      {handled.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button style={{ ...btn(false), width: '100%', textAlign: 'left' }} onClick={() => setShowDone(v => !v)}>{showDone ? '▾' : '▸'} Done ({handled.length})</button>
          {showDone && <div style={{ marginTop: 8 }}>{handled.map(row)}</div>}
        </div>
      )}
    </div>
  )
}
