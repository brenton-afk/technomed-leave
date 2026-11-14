import { flagsFor, needsDecision } from '../../timesheetFlags.js'
import React, { useState, useEffect, useMemo } from 'react'
import { Overlay } from '../../design/Shell.jsx'

const NAVY = '#042746'
const TEAL = '#189a85'
const AMBER = '#f59e0b'
const MUTED = '#6b7a8d'
const BORDER = 'rgba(26,43,74,0.12)'
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ─── Dates people read ───────────────────────────────────────────────────────
// "It's not clear enough for me to tell which week and what dates Erin is
// submitting … the date format needs to be adjusted" — Brent, 4 Nov 2026.
// 2026-11-02 → "Mon 2 Nov". Read off the string, never through a Date in the
// device's zone, so no timezone can move a day.
const parts = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null
}
const weekdayOf = iso => {
  const p = parts(iso)
  if (!p) return ''
  return DAY_NAMES[(new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay() + 6) % 7]
}
export const dayLabel = iso => {
  const p = parts(iso)
  return p ? `${weekdayOf(iso)} ${p.d} ${MONTHS[p.mo - 1]}` : String(iso || '')
}
/** "Mon 2 Nov – Sun 15 Nov 2026" */
export const rangeLabel = (start, end) => {
  const e = parts(end)
  return start && end ? `${dayLabel(start)} – ${dayLabel(end)}${e ? ` ${e.y}` : ''}` : ''
}

const PURPLE = '#8e24aa'
const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const sumOf = byDay => round2(Object.values(byDay || {}).reduce((a, b) => a + Number(b || 0), 0))
export const leaveTotalOf = record => round2(Number(record.leave?.total || 0) + sumOf(record.toilTaken))
const daysText = byDay => Object.keys(byDay || {}).sort().map(d => `${dayLabel(d)} ${byDay[d]}h`).join(' · ')

/**
 * Is Xero set up the way each person's contract says? (Brent, 14 Nov 2026:
 * "ensure it talks to Xero correctly and that the pay items are set up
 * properly".) Read-only — `action=payrollcheck`.
 */
function XeroSetupCheck({ authHeaders }) {
  const [state, setState] = useState(null)
  async function run() {
    setState({ busy: true })
    try {
      const res = await fetch('/api/timesheet/agent?action=payrollcheck', { headers: authHeaders })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      setState({ result: body })
    } catch (err) { setState({ error: err.message }) }
  }
  const result = state?.result
  return (
    <div data-xero-check style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '11px 13px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 13, color: NAVY, fontWeight: 700 }}>Xero pay setup</div>
        <button onClick={run} disabled={state?.busy}
          style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'white', color: NAVY, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          {state?.busy ? 'Checking…' : result ? 'Check again' : 'Check Xero setup'}
        </button>
      </div>
      {state?.error && <div style={{ fontSize: 12, color: '#c0392b', marginTop: 8 }}>{state.error}</div>}
      {result && (
        <div style={{ marginTop: 8 }}>
          {result.allClear && <div style={{ fontSize: 12.5, color: TEAL, fontWeight: 600 }}>✓ Every person's Xero pay template matches their contract.</div>}
          {result.people.map(p => (
            <div key={p.name} style={{ fontSize: 12, padding: '6px 0', borderTop: `1px solid ${BORDER}` }}>
              <strong style={{ color: NAVY }}>{p.name}</strong>
              <span style={{ color: MUTED }}> · sees {p.willSee.join(', ') || 'nothing'}</span>
              {p.problems.length === 0
                ? <span style={{ color: TEAL }}> ✓</span>
                : p.problems.map((x, i) => <div key={i} style={{ color: '#8a5a00', marginTop: 2 }}>· {x}</div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Overtime claimed at double time (Brent, 14 Nov 2026): Erin approves it, or
 * banks the same hours as TOIL instead. Chosen before Approve.
 */
function OvertimeBlock({ record, choice, onChoose }) {
  const claim = record.overtimeClaim
  if (!claim) return null
  const btn = on => ({ flex: 1, padding: '10px 8px', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? TEAL : BORDER}`, background: on ? TEAL : 'white', color: on ? 'white' : NAVY })
  const when = (claim.moved || []).map(m => `${dayLabel(m.day)} ${m.hours}h`).join(' · ')
  return (
    <div data-overtime-claim style={{ background: '#fff8e6', borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>Overtime claimed: {claim.hours}h at double time</div>
      <div style={{ fontSize: 12, color: MUTED, margin: '3px 0 8px', lineHeight: 1.45 }}>Over the {claim.limit}h fortnight · {when}</div>
      {claim.status === 'pending' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" data-overtime-approve onClick={() => onChoose('approve')} style={btn(choice === 'approve')}>Pay as overtime</button>
          <button type="button" data-overtime-toil onClick={() => onChoose('toil')} style={btn(choice === 'toil')}>Bank as TOIL instead</button>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: NAVY }}>{claim.status === 'banked' ? 'Banked as TOIL instead' : 'Paid as overtime'}</div>
      )}
    </div>
  )
}

/**
 * Leave and TOIL taken on a timesheet (Brent, 12 Nov 2026): as the staff
 * member saw it when they submitted, whether each part is in Xero, and any
 * leave added or changed since.
 */
function LeaveBlock({ record, live, busy, onRetry }) {
  const rows = record.leave?.rows || []
  const toil = record.toilTaken || {}
  const toilTotal = sumOf(toil)
  const liveTotal = live ? round2(live.total) : null
  const changed = live && liveTotal !== round2(record.leave?.total || 0)
  if (!rows.length && !toilTotal && !changed) return null
  const line = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, marginBottom: 2 }
  return (
    <div data-leave-block style={{ background: '#f8f4fc', border: '1px solid rgba(142,36,170,0.2)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: PURPLE, marginBottom: 6 }}>Leave — paid as leave, not on the Xero timesheet</div>
      {rows.map(r => (
        <div key={r.type} style={{ marginBottom: 6 }}>
          <div style={line}><strong style={{ color: NAVY }}>{r.label}</strong><span style={{ color: PURPLE, fontWeight: 700 }}>{r.total}h</span></div>
          <div style={{ fontSize: 11, color: MUTED }}>{daysText(r.byDay)}</div>
          <div style={{ fontSize: 11, color: r.inXero ? TEAL : '#c0392b' }}>
            {r.inXero ? 'In Xero ✓' : `Approved in the portal but not in Xero (${r.notInXero.map(dayLabel).join(', ')}) — add it in Xero`}
          </div>
        </div>
      ))}
      {toilTotal > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={line}><strong style={{ color: NAVY }}>TOIL taken</strong><span style={{ color: PURPLE, fontWeight: 700 }}>{toilTotal}h</span></div>
          <div style={{ fontSize: 11, color: MUTED }}>{daysText(toil)}</div>
          <div style={{ fontSize: 11, color: record.toilLeave?.ok === false ? '#c0392b' : record.toilLeave?.ok ? TEAL : MUTED }}>
            {record.status === 'approved'
              ? (record.toilLeave?.ok ? 'Sent to Xero as TOIL leave ✓' : `Not in Xero yet: ${record.toilLeave?.error || 'not sent'}`)
              : 'Sent to Xero as TOIL leave when you approve'}
          </div>
          {record.status === 'approved' && record.toilLeave?.ok === false && (
            <button onClick={onRetry} disabled={busy}
              style={{ marginTop: 4, padding: '6px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'white', fontSize: 12, fontWeight: 700, color: NAVY, cursor: 'pointer' }}>
              {busy ? 'Sending…' : 'Try again'}
            </button>
          )}
        </div>
      )}
      {(record.leave?.pending || []).length > 0 && (
        <div style={{ fontSize: 11, color: MUTED }}>Waiting for approval when submitted: {record.leave.pending.map(p => `${p.label} ${p.total}h`).join(' · ')}</div>
      )}
      {(record.leave?.notes || []).map((n, i) => <div key={i} style={{ fontSize: 11, color: MUTED }}>{n}</div>)}
      {record.leave?.xeroError && <div style={{ fontSize: 11, color: '#8a5a00' }}>{record.leave.xeroError}</div>}
      {changed && (
        <div data-leave-changed style={{ fontSize: 11.5, color: '#8a5a00', marginTop: 4 }}>
          Leave has changed since this was submitted — it is now {liveTotal}h
          {live.rows?.length ? ` (${live.rows.map(r => `${r.label} ${r.total}h`).join(' · ')})` : ''}.
        </div>
      )}
    </div>
  )
}

export default function TimesheetApprovals({ user }) {
  const [data, setData] = useState({ submitted: [], approved: [], rejected: [], outstanding: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('submitted')
  const [open, setOpen] = useState(null)
  const [rejectFor, setRejectFor] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  // Leave as it stands now, per opened timesheet, to show what changed since
  // it was submitted (Brent, 12 Nov 2026).
  const [liveLeave, setLiveLeave] = useState({})
  // Pay or bank, per timesheet with overtime claimed.
  const [otChoice, setOtChoice] = useState({})

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
        body: JSON.stringify({ email: record.email, periodStart: record.periodStart, decision, reason: why, overtime: otChoice[`${record.email}-${record.periodStart}`] })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      if (body.emailError) setError(`Saved, but the notification email failed: ${body.emailError}`)
      setRejectFor(null); setReason(''); setOpen(null)
      await load()
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  async function checkLeaveNow(record) {
    const k = `${record.email}-${record.periodStart}`
    if (liveLeave[k]) return
    try {
      const res = await fetch(`/api/timesheet/agent?action=leavedays&periodStart=${record.periodStart}&email=${encodeURIComponent(record.email)}`, { headers: authHeaders })
      const body = await res.json()
      if (!body.error) setLiveLeave(p => ({ ...p, [k]: body.leave || null }))
    } catch { /* the snapshot still shows */ }
  }

  async function retryToil(record) {
    setBusy(record.email + 'toil'); setError('')
    try {
      const res = await fetch('/api/timesheet/agent?action=toilretry', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ email: record.email, periodStart: record.periodStart })
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
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
  // Approve all (Brent, 14 Nov 2026): every timesheet waiting that needs no
  // decision — overtime claims are left to be opened.
  const clean = tab === 'submitted' ? list.filter(r => !needsDecision(r)) : []
  async function approveAll() {
    if (!clean.length || !window.confirm(`Approve ${clean.length} timesheet${clean.length === 1 ? '' : 's'}: ${clean.map(r => r.staffName).join(', ')}?`)) return
    setBusy('all'); setError('')
    const failed = []
    for (const record of clean) {
      try {
        const res = await fetch('/api/timesheet/agent?action=decide', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ email: record.email, periodStart: record.periodStart, decision: 'approve' })
        })
        const body = await res.json()
        if (body.error) failed.push(`${record.staffName}: ${body.error}`)
      } catch (err) { failed.push(`${record.staffName}: ${err.message}`) }
    }
    if (failed.length) setError(failed.join(' · '))
    await load()
    setBusy('')
  }

  return (
    <div>
      {error && <div style={{ background: '#fdecea', color: '#c0392b', padding: 12, borderRadius: 10, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {data.outstanding?.length > 0 && (
        <div style={{ background: '#fff8e6', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '11px 13px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8a5a00', marginBottom: 3 }}>
            Not yet submitted for this fortnight, {rangeLabel(data.currentPeriod?.start, data.currentPeriod?.end)}
          </div>
          <div style={{ fontSize: 12, color: '#8a5a00' }}>{data.outstanding.map(s => s.name).join(', ')}</div>
        </div>
      )}

      <XeroSetupCheck authHeaders={authHeaders} />

      <div style={{ display: 'flex', gap: 7, marginBottom: 12 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: '8px 0', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: tab === t.id ? NAVY : 'rgba(4,39,70,0.07)', color: tab === t.id ? 'white' : MUTED }}>
            {t.label}{t.count ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {clean.length > 1 && (
        <button data-approve-all onClick={approveAll} disabled={busy === 'all'}
          style={{ width: '100%', padding: 12, marginBottom: 12, background: TEAL, color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: busy === 'all' ? 0.7 : 1 }}>
          {busy === 'all' ? 'Approving…' : `✓ Approve all ${clean.length}${clean.length < list.length ? ' without a decision to make' : ''}`}
        </button>
      )}
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
            <div onClick={() => { setOpen(isOpen ? null : key); if (!isOpen) checkLeaveNow(record) }} style={{ padding: '13px 15px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{record.staffName}</div>
                  <div style={{ fontSize: 13, color: NAVY, marginTop: 3, fontWeight: 600 }}>
                    Fortnight {rangeLabel(record.periodStart, record.periodEnd)}
                    {record.periodStart === data.currentPeriod?.start && (
                      <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: TEAL, background: '#e3f4f1', borderRadius: 10, padding: '1px 7px' }}>This fortnight</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: record.totals?.totalHours > 76 ? AMBER : NAVY }}>{record.totals?.totalHours ?? 0}h</div>
                  <div style={{ fontSize: 11, color: MUTED }}>
                    {(record.totals?.weekHours || []).map((h, i) => `Week ${i + 1}: ${h}h`).join(' · ')}
                  </div>
                  {leaveTotalOf(record) > 0 && (
                    <div data-leave-total style={{ fontSize: 11, color: PURPLE, fontWeight: 700 }}>+ {leaveTotalOf(record)}h leave</div>
                  )}
                </div>
              </div>
              {record.editedByAdmin && <div style={{ fontSize: 11, color: AMBER, marginTop: 5 }}>Edited before approval</div>}
              {record.rejectionReason && <div style={{ fontSize: 11.5, color: '#c0392b', marginTop: 5 }}>Returned: {record.rejectionReason}</div>}
              {record.status === 'submitted' && flagsFor(record).length > 0 && (
                <div data-flags style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
                  {flagsFor(record).map((f, i) => (
                    <span key={i} data-flag={f.kind} style={{ fontSize: 11, fontWeight: 600, borderRadius: 10, padding: '2px 8px', lineHeight: 1.4,
                      background: f.tone === 'decide' ? AMBER : f.tone === 'warn' ? '#fff8e6' : 'rgba(4,39,70,0.06)',
                      color: f.tone === 'decide' ? 'white' : f.tone === 'warn' ? '#8a5a00' : NAVY }}>{f.text}</span>
                  ))}
                </div>
              )}
              {record.status === 'submitted' && flagsFor(record).length === 0 && (
                <div style={{ fontSize: 11, color: TEAL, marginTop: 5, fontWeight: 600 }}>✓ Nothing unusual</div>
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
                    {/* One labelled row per week, each day with its own date. It was
                        one row of Mon–Sun with two numbers stacked under each day
                        and nothing to say which week either belonged to. */}
                    {[0, 1].map(week => {
                      const days = (record.days || []).slice(week * 7, week * 7 + 7)
                      if (!days.length) return null
                      return (
                        <div key={week} style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: NAVY, margin: '2px 0 4px' }}>
                            Week {week + 1} · {dayLabel(days[0])} – {dayLabel(days[days.length - 1])}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 }}>
                            {days.map((d, i) => {
                              const v = record.entries?.[c.key]?.[d]
                              const weekend = i >= 5
                              return (
                                <div key={d} style={{
                                  textAlign: 'center', borderRadius: 6, padding: '4px 0',
                                  background: weekend ? 'rgba(4,39,70,0.04)' : 'white', border: `1px solid ${BORDER}`
                                }}>
                                  <div style={{ color: MUTED, fontSize: 10.5 }}>{DAY_NAMES[i]}</div>
                                  <div style={{ color: MUTED, fontSize: 10.5 }}>{dayLabel(d).split(' ').slice(1).join(' ')}</div>
                                  <div style={{ color: v ? NAVY : 'rgba(26,43,74,0.25)', fontWeight: v ? 700 : 400, fontSize: 13, marginTop: 2 }}>
                                    {v ? `${v}${c.unit === 'count' ? '' : 'h'}` : '–'}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}

                <OvertimeBlock record={record} choice={otChoice[key]} onChoose={c => setOtChoice(prev => ({ ...prev, [key]: c }))} />
                <LeaveBlock record={record} live={liveLeave[key]} busy={busy === record.email + 'toil'} onRetry={() => retryToil(record)} />

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
                    <button onClick={() => decide(record, 'approve')} disabled={busy === record.email + 'approve' || (record.overtimeClaim?.status === 'pending' && !otChoice[key])}
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
              style={{ width: '100%', padding: '11px 13px', border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 16, resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 14, fontFamily: 'inherit' }} />
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
