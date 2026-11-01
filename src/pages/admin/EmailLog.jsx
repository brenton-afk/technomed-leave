import React, { useState, useEffect, useCallback } from 'react'

// ─── Every email the portal has sent ─────────────────────────────────────────
// "Brenton: confirm where usage emails are actually sent from (personal inboxes
// or the system), and make sure there is a record of every one sent."
//
// Failures are shown in the same list as successes, and that is the point.
// "Did that usage ever go?" is nearly always asked about one that did not, and
// a list of only the successes answers it by omission — which is exactly how
// nobody noticed every email had been failing for weeks.
//
// There is no patient surname anywhere on this screen, because there is none in
// the stored record: the subject of a usage email is the case folder name,
// which is built from one. The case id is the link back for anybody who needs
// it, through the screens where the access rules already apply.

const KIND_LABELS = {
  usage: 'Usage',
  leave: 'Leave',
  timesheet: 'Timesheet',
  meeting: 'Minutes',
  pin: 'PIN reset',
  notification: 'Notice'
}

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16)
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Hobart',
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true
  }).format(d)
}

export default function EmailLog({ user }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [only, setOnly] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/applications?action=email-log', {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEntries(data.entries || [])
    } catch (err) {
      setError(err.message || 'Could not read the email log.')
    }
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  const failed = entries.filter(e => e.status === 'failed')
  const shown = only === 'failed' ? failed
    : only === 'all' ? entries
      : entries.filter(e => e.kind === only)

  const card = {
    background: 'white', borderRadius: 10, padding: '11px 13px', marginBottom: 7,
    border: '1px solid rgba(26,43,74,0.08)'
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap'
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#042746' }}>Sent email</div>
        <button onClick={load}
          style={{
            marginLeft: 'auto', padding: '6px 13px', borderRadius: 8,
            border: '1px solid rgba(26,43,74,0.15)', background: 'white',
            fontSize: 13, fontWeight: 600, color: '#042746', cursor: 'pointer'
          }}>Refresh</button>
      </div>

      {/* Failures first, because they are the reason to open this screen. */}
      {failed.length > 0 && only !== 'failed' && (
        <button onClick={() => setOnly('failed')}
          style={{
            display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
            background: '#fdecea', color: '#c0392b', border: '1px solid #f5c6cb',
            padding: '11px 13px', borderRadius: 10, marginBottom: 12,
            fontSize: 13, fontWeight: 600
          }}>
          {failed.length} email{failed.length === 1 ? '' : 's'} did not send — show {failed.length === 1 ? 'it' : 'them'}
        </button>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['all', `All · ${entries.length}`], ['failed', `Failed · ${failed.length}`],
          ['usage', 'Usage'], ['leave', 'Leave'], ['timesheet', 'Timesheet']].map(([id, label]) => (
          <button key={id} onClick={() => setOnly(id)}
            style={{
              padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
              border: only === id ? 'none' : '1px solid rgba(26,43,74,0.15)',
              background: only === id ? '#042746' : 'white',
              color: only === id ? 'white' : '#6b7a8d',
              fontSize: 12.5, fontWeight: 600
            }}>{label}</button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 30, color: '#6b7a8d', fontSize: 13 }}>
          Loading…
        </div>
      )}

      {error && (
        <div style={{
          background: '#fdecea', color: '#c0392b', padding: '12px 14px',
          borderRadius: 10, marginBottom: 12, fontSize: 13
        }}>{error}</div>
      )}

      {!loading && !error && shown.length === 0 && (
        <div style={{ textAlign: 'center', padding: 30, color: '#6b7a8d', fontSize: 13 }}>
          Nothing sent yet.
        </div>
      )}

      {shown.map(e => (
        <div key={e.id} style={{
          ...card,
          borderLeft: `3px solid ${e.status === 'failed' ? '#c0392b' : '#189a85'}`
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#042746' }}>
              {KIND_LABELS[e.kind] || e.kind}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
              background: e.status === 'failed' ? '#fdecea' : '#e8f4f2',
              color: e.status === 'failed' ? '#c0392b' : '#0f7566'
            }}>{e.status === 'failed' ? 'Did not send' : 'Sent'}</span>
            <span style={{ fontSize: 12, color: '#aab0bb', marginLeft: 'auto' }}>
              {when(e.at)}
            </span>
          </div>

          <div style={{ fontSize: 12.5, color: '#6b7a8d', marginTop: 4, lineHeight: 1.5 }}>
            <div>From {e.from || '—'}</div>
            <div>To {(e.to || []).join(', ') || '—'}</div>
            {(e.bcc || []).length > 0 && <div>Bcc {e.bcc.join(', ')}</div>}
          </div>

          {/* The technical cause, which is why an admin is on this screen. It
              has been through scrubDetail, so a quoted surname cannot ride in
              on a Resend error. */}
          {e.status === 'failed' && e.detail && (
            <div style={{
              fontSize: 11.5, color: '#856404', background: '#fff8ed',
              border: '1px solid #fcd9a4', borderRadius: 7,
              padding: '7px 9px', marginTop: 7, lineHeight: 1.45,
              wordBreak: 'break-word'
            }}>{e.detail}</div>
          )}

          {e.messageId && (
            <div style={{ fontSize: 10.5, color: '#aab0bb', marginTop: 5 }}>
              Resend {e.messageId}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
