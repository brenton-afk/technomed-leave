import React, { useState, useEffect, useMemo } from 'react'
import { Overlay } from '../../design/Shell.jsx'

const NAVY = '#042746'
const TEAL = '#189a85'
const AMBER = '#f59e0b'
const MUTED = '#6b7a8d'
const BORDER = 'rgba(26,43,74,0.12)'
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function TimesheetApprovals({ user }) {
  const [data, setData] = useState({ submitted: [], approved: [], rejected: [], outstanding: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('submitted')
  const [open, setOpen] = useState(null)
  const [rejectFor, setRejectFor] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/timesheet/agent?action=list', { headers: authHeaders })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      setData(body)
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  async function decide(record, decision, why = '') {
    setBusy(record.email + decision); setError('')
    try {
      const res = await fetch('/api/timesheet/agent?action=decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ email: record.email, periodStart: record.periodStart, decision, reason: why })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      if (body.emailError) setError(`Saved, but the notification email failed: ${body.emailError}`)
      setRejectFor(null); setReason(''); setOpen(null)
      await load()
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  const tabs = [
    { id: 'submitted', label: 'Awaiting', count: data.submitted?.length || 0 },
    { id: 'approved', label: 'Approved', count: data.approved?.length || 0 },
    { id: 'rejected', label: 'Returned', count: data.rejected?.length || 0 }
  ]
  const list = data[tab] || []

  return (
    <div>
      {error && <div style={{ background: '#fdecea', color: '#c0392b', padding: 12, borderRadius: 10, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {data.outstanding?.length > 0 && (
        <div style={{ background: '#fff8e6', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '11px 13px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8a5a00', marginBottom: 3 }}>
            Not yet submitted for {data.currentPeriod?.start} → {data.currentPeriod?.end}
          </div>
          <div style={{ fontSize: 12, color: '#8a5a00' }}>{data.outstanding.map(s => s.name).join(', ')}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, marginBottom: 12 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: '8px 0', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: tab === t.id ? NAVY : 'rgba(4,39,70,0.07)', color: tab === t.id ? 'white' : MUTED }}>
            {t.label}{t.count ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 30, color: MUTED, fontSize: 14 }}>Loading…</div>}
      {!loading && list.length === 0 && (
        <div style={{ background: 'white', borderRadius: 12, padding: 32, textAlign: 'center', color: MUTED, fontSize: 14 }}>
          No {tab === 'submitted' ? 'timesheets awaiting approval' : `${tab} timesheets`}
        </div>
      )}

      {list.map(record => {
        const key = `${record.email}-${record.periodStart}`
        const isOpen = open === key
        return (
          <div key={key} style={{ background: 'white', borderRadius: 12, marginBottom: 10, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
            <div onClick={() => setOpen(isOpen ? null : key)} style={{ padding: '13px 15px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{record.staffName}</div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{record.periodStart} → {record.periodEnd}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: record.totals?.totalHours > 76 ? AMBER : NAVY }}>{record.totals?.totalHours ?? 0}h</div>
                  <div style={{ fontSize: 10.5, color: MUTED }}>{record.totals?.weekHours?.join('h / ')}h</div>
                </div>
              </div>
              {record.editedByAdmin && <div style={{ fontSize: 11, color: AMBER, marginTop: 5 }}>Edited before approval</div>}
              {record.rejectionReason && <div style={{ fontSize: 11.5, color: '#c0392b', marginTop: 5 }}>Returned: {record.rejectionReason}</div>}
              {record.warnings?.length > 0 && (
                <div style={{ fontSize: 11, color: '#8a5a00', marginTop: 5 }}>⚠ {record.warnings.length} warning{record.warnings.length === 1 ? '' : 's'}</div>
              )}
            </div>

            {isOpen && (
              <div style={{ borderTop: `1px solid ${BORDER}`, padding: '12px 15px', background: '#fafbfd' }}>
                {(record.categories || []).filter(c => record.totals?.byCategory?.[c.key]).map(c => (
                  <div key={c.key} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <strong style={{ color: NAVY }}>{c.label}</strong>
                      <span style={{ color: TEAL, fontWeight: 700 }}>{record.totals.byCategory[c.key]}{c.unit === 'count' ? '' : 'h'}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                      {(record.days || []).slice(0, 7).map((d, i) => {
                        const w2 = record.days[i + 7]
                        const v1 = record.entries?.[c.key]?.[d]
                        const v2 = record.entries?.[c.key]?.[w2]
                        return (
                          <div key={d} style={{ textAlign: 'center', fontSize: 10 }}>
                            <div style={{ color: MUTED, fontSize: 9 }}>{DAY_NAMES[i]}</div>
                            <div style={{ color: v1 ? NAVY : 'rgba(26,43,74,0.2)', fontWeight: v1 ? 700 : 400 }}>{v1 ?? '·'}</div>
                            <div style={{ color: v2 ? NAVY : 'rgba(26,43,74,0.2)', fontWeight: v2 ? 700 : 400 }}>{v2 ?? '·'}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {record.warnings?.length > 0 && (
                  <div style={{ background: '#fff8e6', color: '#8a5a00', borderRadius: 8, padding: 10, fontSize: 11.5, lineHeight: 1.5, marginBottom: 10 }}>
                    {record.warnings.map((w, i) => <div key={i}>· {w}</div>)}
                  </div>
                )}

                {record.xero?.timesheetID && (
                  <div style={{ fontSize: 11, color: MUTED, marginBottom: 10 }}>
                    Xero timesheet {record.xero.timesheetID} · {record.xero.status}
                  </div>
                )}

                {record.status === 'submitted' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => decide(record, 'approve')} disabled={busy === record.email + 'approve'}
                      style={{ flex: 2, padding: 12, background: TEAL, color: 'white', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', opacity: busy === record.email + 'approve' ? 0.7 : 1 }}>
                      {busy === record.email + 'approve' ? 'Approving…' : '✓ Approve'}
                    </button>
                    <button onClick={() => setRejectFor(record)}
                      style={{ flex: 1, padding: 12, background: '#fdecea', color: '#c0392b', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
                      Return
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      <button onClick={load} style={{ width: '100%', padding: 12, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 13, color: MUTED, cursor: 'pointer', marginTop: 6 }}>
        Refresh
      </button>

      {rejectFor && (
        <Overlay>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 22, width: '100%', maxWidth: 400 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 6 }}>Return this timesheet</div>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 14 }}>
              {rejectFor.staffName} will be emailed the reason and can resubmit.
            </div>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="e.g. Thursday overtime should be ordinary hours"
              style={{ width: '100%', padding: '11px 13px', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 14, resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 14, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setRejectFor(null); setReason('') }}
                style={{ flex: 1, padding: 12, background: '#f0f3f7', border: 'none', borderRadius: 8, fontSize: 14, color: MUTED, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => decide(rejectFor, 'reject', reason)} disabled={!reason.trim() || busy}
                style={{ flex: 2, padding: 12, background: reason.trim() ? '#c0392b' : '#d9c3c0', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: reason.trim() ? 'pointer' : 'default' }}>
                Return timesheet
              </button>
            </div>
          </div>
        </div>
        </Overlay>
      )}
    </div>
  )
}
