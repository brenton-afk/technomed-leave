import React, { useState, useEffect, useCallback } from 'react'
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

function AllowInvoices() {
  return (
    <div style={{ ...card, background: '#fff8e6', border: '1px solid #f0d58a' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, marginBottom: 4 }}>Xero needs permission for invoices</div>
      <div style={{ fontSize: 13, color: '#5a6478', marginBottom: 10 }}>
        One tap, once. It adds invoicing to the existing Xero connection — leave and timesheets carry on as they are.
      </div>
      <a href="/api/xero/connect?invoices=1" style={{ ...btn(true), display: 'inline-block', textDecoration: 'none' }}>Allow invoices →</a>
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

  useEffect(() => { load() }, [load])

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
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Invoices &amp; quotes</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={btn(false)} onClick={load}>Refresh</button>
          <button style={btn(true)} onClick={() => setDraft({ kind: 'quote' })}>New quote</button>
        </div>
      </div>
      <div style={{ ...muted, marginBottom: 12 }}>
        Calvary purchase orders in accounts@ that have <b>no invoice in Xero yet</b>. Read one, check its lines,
        and a <b>draft</b> invoice is made in Xero — nothing is approved or sent from here.
      </div>

      {xero === 'permission' && <AllowInvoices />}
      {xero === 'error' && <div style={{ ...card, color: '#b42318', fontSize: 13 }}>Xero could not be checked just now, so no purchase order is offered — one may already be invoiced. Try Refresh.</div>}
      {error && <div style={{ ...card, color: '#b42318', fontSize: 13 }}>{error}</div>}
      {loading && <div style={muted}>Looking in accounts@ and checking Xero…</div>}

      {!loading && xero === 'ok' && (
        <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: '6px 0 8px' }}>
          {list.outstanding.length ? `Waiting to be invoiced (${list.outstanding.length})` : 'Every purchase order with a PO number is already invoiced.'}
        </div>
      )}
      {list.outstanding.map(o => orderCard(o, { action: readButton(o) }))}

      {fold('none', 'No PO number found — check by hand', list.noNumber, o => orderCard(o, { action: readButton(o, false) }))}
      {fold('done', 'Already invoiced in Xero', list.invoiced, o => orderCard(o, {
        badge: <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#e6f4f1', color: ACCENT }}>
          {o.invoices.map(i => `${i.number || 'draft'} (${String(i.status).toLowerCase()})`).join(', ')}
        </span>
      }))}
      {fold('unchecked', 'Not checked against Xero', list.unchecked, o => orderCard(o))}
    </div>
  )
}

const blankLine = () => ({ code: '', description: '', quantity: 1, unitPrice: '', discount: '' })

function Editor({ api, draft, onClose }) {
  const isInvoice = draft.kind === 'invoice'
  const order = draft.order || {}
  const [search, setSearch] = useState(isInvoice ? 'Calvary' : '')
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
      const body = { contactId, reference, date, lines: lines.map(l => ({ ...l, unitPrice: l.unitPrice === '' ? NaN : Number(l.unitPrice), discount: Number(l.discount) || 0 })) }
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
        <div style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>{isInvoice ? `Invoice for ${order.poNumber || 'this order'}` : 'New quote'}</div>
      </div>

      {permission && <AllowInvoices />}

      {isInvoice && (
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
          <div><label style={label}>{isInvoice ? 'Reference (PO number)' : 'Reference'}</label>
            <input style={input} value={reference} onChange={e => setReference(e.target.value)} /></div>
          <div><label style={label}>Date</label>
            <input style={input} type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
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
