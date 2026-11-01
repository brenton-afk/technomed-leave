import React, { useState, useEffect } from 'react'

// ─── Admin → Notices ─────────────────────────────────────────────────────────
// Who suppliers are, and when they are told about a booking. "Editable in
// settings; never hard-code them." The first copy came from the confirmed list
// and from the addresses the team already writes to; saving here replaces it.

const EVENT_LABELS = { new: 'New', changed: 'Changed', moved: 'Moved', cancelled: 'Cancelled' }
const DISTRIBUTORS = [['signus', 'Signus systems'], ['kt', 'KT Medical systems'], ['e4', 'E4 systems'],
  ['globus', 'Globus / NuVasive'], ['device', 'Device Technologies']]

const list = v => (Array.isArray(v) ? v.join(', ') : String(v || ''))
const unlist = v => String(v || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)

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
      setSettings(data); setSaved('Saved.')
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

      <div style={{ fontSize: 15, fontWeight: 700, color: '#042746', margin: '12px 0 8px' }}>Contacts</div>
      {settings.contacts.map((c, i) => (
        <div key={c.id} style={card}>
          <strong style={{ color: '#042746' }}>{c.name}</strong>
          {c.note && <div style={{ fontSize: 12.5, color: '#6b7a8d' }}>{c.note}</div>}
          <label style={label}>To
            <input value={list(c.to)} onChange={e => setContact(i, { to: unlist(e.target.value) })} style={input} aria-label={`${c.name} to`} />
          </label>
          <label style={label}>Cc
            <input value={list(c.cc)} onChange={e => setContact(i, { cc: unlist(e.target.value) })} style={input} aria-label={`${c.name} cc`} />
          </label>
        </div>
      ))}

      {error && <div role="alert" style={{ color: '#c0392b', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {saved && <div style={{ color: '#189a85', fontSize: 13, marginBottom: 8 }}>{saved}</div>}
      <button onClick={save} disabled={saving} style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none',
        background: '#189a85', color: 'white', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
