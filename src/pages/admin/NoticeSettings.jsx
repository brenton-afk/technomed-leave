import React, { useState, useEffect } from 'react'

// ─── Admin → Notices ─────────────────────────────────────────────────────────
// Who suppliers are, and when they are told about a booking. "Editable in
// settings; never hard-code them." The first copy came from the confirmed list
// and from the addresses the team already writes to; saving here replaces it.

const EVENT_LABELS = { new: 'New', changed: 'Changed', moved: 'Moved', cancelled: 'Cancelled' }
const DISTRIBUTORS = [['signus', 'Signus systems'], ['kt', 'KT Medical systems'], ['e4', 'E4 systems'],
  ['globus', 'Globus / NuVasive'], ['device', 'Device Technologies']]

const isEmail = v => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i.test(String(v || '').trim())

/**
 * One address per row, each with its own remove button, and a box to add one.
 *
 * This was a single text box holding every address joined by commas, rebuilt
 * from the list on every keystroke — so a comma or space typed to start the
 * next address vanished as it was typed, and taking one person out meant
 * picking their address out of a long line on a phone. Reported as "really
 * tricky to edit" when Kaye needed removing from Device.
 */
function AddressList({ label, addresses, onChange, who }) {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState('')
  const add = () => {
    const found = draft.split(/[,;\s]+/).map(a => a.trim()).filter(Boolean)
    if (!found.length) return
    const bad = found.find(a => !isEmail(a))
    if (bad) { setProblem(`"${bad}" is not an email address`); return }
    const have = new Set(addresses.map(a => a.toLowerCase()))
    onChange([...addresses, ...found.filter(a => !have.has(a.toLowerCase()))])
    setDraft(''); setProblem('')
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12.5, color: '#6b7a8d' }}>{label}</div>
      {addresses.length === 0 && <div style={{ fontSize: 13, color: '#6b7a8d', padding: '4px 0' }}>Nobody</div>}
      {addresses.map(a => (
        <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #eef1f5' }}>
          <span style={{ flex: 1, fontSize: 14, color: '#042746', overflowWrap: 'anywhere' }}>{a}</span>
          <button type="button" onClick={() => onChange(addresses.filter(x => x !== a))}
            aria-label={`Remove ${a} from ${who} ${label}`}
            style={{ padding: '4px 10px', borderRadius: 14, border: '1px solid #f0c9c4', background: 'white', color: '#c0392b', fontSize: 13, cursor: 'pointer' }}>
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input value={draft} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
          placeholder="Add an address" aria-label={`Add to ${who} ${label}`}
          onChange={e => { setDraft(e.target.value); setProblem('') }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid #dfe5ec', borderRadius: 8, fontSize: 16, boxSizing: 'border-box', minWidth: 0 }} />
        <button type="button" onClick={add} disabled={!draft.trim()}
          style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#042746', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Add
        </button>
      </div>
      {problem && <div role="alert" style={{ color: '#c0392b', fontSize: 12.5, marginTop: 4 }}>{problem}</div>}
    </div>
  )
}

export default function NoticeSettings({ user }) {
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const headers = { Authorization: `Bearer ${user?.token || ''}` }

  useEffect(() => {
    fetch('/api/calendar/today?action=noticesettings', { headers })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setSettings(d) })
      .catch(err => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])

  async function save() {
    setSaving(true); setError(''); setSaved('')
    try {
      const res = await fetch('/api/calendar/today?action=noticesettings', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Not saved')
      setSettings(data); setSaved('Saved. The next email uses these addresses.')
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const setContact = (i, patch) => setSettings(s => ({ ...s, contacts: s.contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  const setRule = (i, patch) => setSettings(s => ({ ...s, rules: s.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))

  const card = { background: 'white', borderRadius: 12, padding: 14, marginBottom: 10 }
  const input = { width: '100%', padding: '8px 10px', border: '1px solid #dfe5ec', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }
  const label = { display: 'block', fontSize: 12.5, color: '#6b7a8d', marginTop: 6 }

  if (error && !settings) return <div role="alert" style={{ ...card, color: '#c0392b' }}>{error}</div>
  if (!settings) return <div style={{ textAlign: 'center', padding: 40, color: '#6b7a8d' }}>Loading…</div>

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#042746', margin: '4px 0 8px' }}>Rules</div>
      {settings.rules.map((r, i) => {
        const contact = settings.contacts.find(c => c.id === r.contactId)
        return (
          <div key={r.id} style={card}>
            <strong style={{ color: '#042746' }}>{contact?.name || r.contactId}</strong>
            <label style={label}>When a booking has
              <select value={r.distributor} onChange={e => setRule(i, { distributor: e.target.value })} style={input}>
                {DISTRIBUTORS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label style={label}>At
              <select value={r.hospital} onChange={e => setRule(i, { hospital: e.target.value })} style={input}>
                <option value="">Any hospital</option><option value="RHH">RHH only</option><option value="CLV">Calvary only</option>
              </select>
            </label>
            <div style={{ ...label, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {Object.entries(EVENT_LABELS).map(([id, name]) => (
                <label key={id} style={{ fontSize: 13, color: '#042746' }}>
                  <input type="checkbox" style={{ fontSize: 16 }} checked={r.events.includes(id)}
                    onChange={e => setRule(i, { events: e.target.checked ? [...r.events, id] : r.events.filter(x => x !== id) })} /> {name}
                </label>
              ))}
            </div>
            <label style={{ ...label, color: '#042746' }}>
              <input type="checkbox" style={{ fontSize: 16 }} checked={r.autoSend} onChange={e => setRule(i, { autoSend: e.target.checked })} />{' '}
              Send automatically, without showing it first
            </label>
          </div>
        )
      })}

      <div style={{ fontSize: 15, fontWeight: 700, color: '#042746', margin: '12px 0 8px' }}>Loan set requests</div>
      <div style={card}>
        <div style={{ fontSize: 12.5, color: '#6b7a8d', marginBottom: 6 }}>
          When a booking's kit says Distributor Loan for one of these, a request is written for you to check and send.
          A move or cancellation after that sends a follow-up.
        </div>
        {(settings.loanRequests || []).map((l, i) => {
          const contact = settings.contacts.find(c => c.id === l.contactId)
          return (
            <label key={l.distributor} style={{ display: 'block', fontSize: 14, color: '#042746', padding: '4px 0' }}>
              <input type="checkbox" style={{ fontSize: 16 }} checked={l.enabled}
                onChange={e => setSettings(st => ({ ...st,
                  loanRequests: st.loanRequests.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) }))} />{' '}
              {contact?.name || l.distributor}
            </label>
          )
        })}
      </div>

      <div style={{ fontSize: 15, fontWeight: 700, color: '#042746', margin: '12px 0 8px' }}>Contacts</div>
      {settings.contacts.map((c, i) => (
        <div key={c.id} style={card}>
          <strong style={{ color: '#042746' }}>{c.name}</strong>
          {c.note && <div style={{ fontSize: 12.5, color: '#6b7a8d' }}>{c.note}</div>}
          <AddressList label="To" who={c.name} addresses={c.to || []} onChange={to => setContact(i, { to })} />
          <AddressList label="Cc" who={c.name} addresses={c.cc || []} onChange={cc => setContact(i, { cc })} />
        </div>
      ))}

      {error && <div role="alert" style={{ color: '#c0392b', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {saved && <div style={{ color: '#189a85', fontSize: 13, marginBottom: 8 }}>{saved}</div>}
      {/* Kept in view: the contacts run long, and a change is not kept until
          this is pressed. */}
      <button onClick={save} disabled={saving} style={{ position: 'sticky', bottom: 8, width: '100%', padding: 12, borderRadius: 10, border: 'none',
        background: '#189a85', color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
