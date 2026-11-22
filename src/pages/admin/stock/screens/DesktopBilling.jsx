import React, { useState } from 'react'
import { ink, muted, line, hair, ground, navySoft, teal, tealSoft, redSoft, redInk, blueSoft, blueInk, amberSoft, amberInk, restockGrey, font, band, chip, primary, secondary, notBuilt } from '../ui.js'

// Case billing from usage, desktop — from DesktopBilling.dc.html. Admins only.
// Amounts stay as "$ [amount]" placeholders, as in the mock-up: no prices here.

const KIND = {
  ok: ['#e3f4f1', '#0b4f45'], diff: [amberSoft, amberInk], wait: [blueSoft, blueInk], po: [redSoft, redInk]
}

const ROWS = [
  ['Thu 20 Nov', 'Renshaw', 'Thani', 'Diplomat + Boost', 'Calvary', 'Signus · Device (Boost)', 'Usage priced · report due', 'wait'],
  ['Wed 15 Oct', 'Okafor', 'Fowler', 'Lonestar', 'RHH', 'KT Medical', 'Not on the October report', 'po'],
  ['Tue 18 Nov', 'Delahunt', 'Dubey', 'Diplomat', 'Calvary', 'Signus', 'Usage priced · report due', 'wait'],
  ['Fri 31 Oct', 'Whitlock', 'Ibbett', 'Shoreline', 'Calvary', 'Device', 'Report differs: 1 cage', 'diff'],
  ['Thu 30 Oct', 'Ashdown', 'Atallah', 'Diplomat + Firebird', 'RHH', 'Signus · Device', '✓ Matches both reports', 'ok'],
  ['Wed 29 Oct', 'Pemberton', 'Fowler', 'Dakota', 'RHH', 'E4 Surgical', 'Usage priced · report due', 'wait'],
  ['Tue 28 Oct', 'Quinlan', 'Gupta', 'Mariner MIS', 'Calvary', 'Device', '✓ Matches report', 'ok'],
  ['Mon 27 Oct', 'Marlowe', 'Thani', 'Diplomat', 'Calvary', 'Signus', '✓ Matches report', 'ok']
].map(([date, pt, surgeon, sys, hosp, dists, status, kind]) => ({ id: pt, date, pt, surgeon, sys, hosp, dists, status, kind }))

const FILTERS = [['all', 'All cases'], ['wait', 'Report due'], ['diff', 'Differs'], ['po', 'Not on a report'], ['ok', 'Matches']]
const COLS = '90px 170px 90px minmax(0, 1fr) 120px 120px 190px'

const NEXT_STEP = {
  wait: 'Priced from the usage scan. It will be checked when the distributor\'s November report arrives.',
  po: 'Used and priced, but on no distributor\'s report — often a hospital PO we never see. Worth asking the distributor.',
  diff: 'The distributor\'s report and our usage disagree on one line. Check the scan, then settle it with them.',
  ok: 'Every line on the usage is on the distributor\'s report.'
}

export default function DesktopBilling({ go }) {
  const [filter, setFilter] = useState('all')
  const [dist, setDist] = useState(null)
  const [selected, setSelected] = useState('Whitlock')
  const [settled, setSettled] = useState({})
  const [msg, setMsg] = useState('')

  const kindOf = r => (settled[r.id] ? 'ok' : r.kind)
  const statusOf = r => (settled[r.id] ? '✓ Checked by hand' : r.status)
  const rows = ROWS.filter(r => filter === 'all' || kindOf(r) === filter).filter(r => !dist || r.dists.includes(dist))
  const count = k => ROWS.filter(r => k === 'all' || kindOf(r) === k).length
  const sel = ROWS.find(r => r.id === selected)

  const reports = [
    ['Signus', 'Signus · October report', <strong style={{ color: '#0f7a69' }}>31 of 31 match</strong>],
    ['Device', 'Device · October report', settled.Whitlock ? <strong style={{ color: '#0f7a69' }}>1 differs</strong> : <strong style={{ color: '#9a3412' }}>2 differ</strong>],
    ['E4', 'E4 · October report', <span style={{ color: muted }}>not in yet</span>]
  ]

  return (
    <div style={{ fontFamily: font, color: ink, background: ground, display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: band, color: '#fff', padding: '22px 22px 18px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#7fe0cd' }}>ADMINS ONLY</div>
          <h1 style={{ margin: '2px 0 0', fontSize: 26 }}>Case billing · November 2026</h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: '#b9cfe1' }}>Priced from each usage scan with the hospital's price list · checked against each distributor's sales report when it arrives</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[['SALES SO FAR', '$ [amount]'], ['OUR COMMISSION', '$ [amount]'], ['CASES', '48']].map(([k, v]) => (
            <div key={k} style={{ background: navySoft, border: '1px solid #2c5a82', borderRadius: 12, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#b9cfe1', fontWeight: 600 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '18px 16px' }}>
        <section style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div role="group" aria-label="Filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {FILTERS.map(([id, name]) => (
              <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id} style={chip(filter === id)}>{name} · {count(id)}</button>
            ))}
            {dist && <button onClick={() => setDist(null)} style={{ ...chip(true), background: teal }}>{dist} only ✕</button>}
          </div>
          <div style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 920 }}>
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: muted, borderBottom: `1px solid ${hair}`, background: '#fafbfc' }}>
                  <span>DATE</span><span>CASE</span><span>HOSPITAL</span><span>DISTRIBUTORS</span><span>SALES</span><span>COMMISSION</span><span>CHECKED</span>
                </div>
                {rows.length === 0 && <div style={{ padding: 24, fontSize: 13, color: muted }}>No cases match.</div>}
                {rows.map(r => {
                  const on = r.id === selected
                  const [bg, fg] = KIND[kindOf(r)]
                  return (
                    <div key={r.id} onClick={() => setSelected(r.id)} data-billing-row={r.id} style={{
                      display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 18px', alignItems: 'center', borderBottom: '1px solid #f0f3f6', fontSize: 13, cursor: 'pointer',
                      background: on ? '#f2faf8' : '#fff', boxShadow: on ? `inset 3px 0 0 ${teal}` : 'none'
                    }}>
                      <span style={{ fontWeight: 600 }}>{r.date}</span>
                      <span><strong>pt {r.pt}</strong><span style={{ display: 'block', color: muted, fontSize: 12 }}>{r.surgeon} · {r.sys}</span></span>
                      <span>{r.hosp}</span>
                      <span style={{ color: muted }}>{r.dists}</span>
                      <span style={{ color: restockGrey }}>$ [amount]</span>
                      <span style={{ color: restockGrey }}>$ [amount]</span>
                      <span style={{ fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '4px 9px', justifySelf: 'start', background: bg, color: fg }}>{statusOf(r)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <aside style={{ flex: '1 1 300px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sel && (
            <div data-billing-detail style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: muted, fontWeight: 600 }}>{`${sel.date} · ${sel.hosp} · ${sel.surgeon}`.toUpperCase()}</div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>pt {sel.pt} · {sel.sys}</div>
              <div style={{ fontSize: 13, color: muted }}>{sel.dists}</div>
              <div style={{ fontSize: 13, lineHeight: 1.45, background: KIND[kindOf(sel)][0], color: KIND[kindOf(sel)][1], borderRadius: 10, padding: '8px 10px' }}>
                <strong>{statusOf(sel)}.</strong> {settled[sel.id] ? 'Marked as checked on this screen.' : NEXT_STEP[sel.kind]}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setMsg(notBuilt('Opening the usage scan for this case'))} style={{ ...secondary, flex: '1 1 120px', font: `600 13px ${font}` }}>Open the usage</button>
                {(sel.kind === 'diff' || sel.kind === 'po') && (
                  <button onClick={() => setSettled(s => ({ ...s, [sel.id]: !s[sel.id] }))} style={{ ...primary, flex: '1 1 120px', font: `600 13px ${font}` }}>
                    {settled[sel.id] ? 'Undo' : 'Mark checked'}
                  </button>
                )}
              </div>
            </div>
          )}
          <div style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 15 }}>Against the sales reports</h2>
            {reports.map(([key, label, val]) => (
              <button key={key} onClick={() => setDist(dist === key ? null : key)} aria-pressed={dist === key} style={{
                display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, font: `400 13px ${font}`, color: ink, cursor: 'pointer', textAlign: 'left',
                background: dist === key ? tealSoft : 'transparent', border: 0, borderRadius: 8, padding: '4px 6px', margin: '0 -6px'
              }}><span>{label}</span>{val}</button>
            ))}
          </div>
          <div style={{ background: amberSoft, border: '1px solid #f2c48d', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 15, color: amberInk }}>Missing from last month's reports · 3 cases</h2>
            <div style={{ fontSize: 13, color: amberInk, lineHeight: 1.45 }}>Used and priced in October but on no distributor's report — often a hospital PO we never see. Worth asking the distributor.</div>
            <button onClick={() => { setFilter('po'); setDist(null) }} style={{ ...secondary, minHeight: 36, font: `600 13px ${font}`, alignSelf: 'flex-start', marginTop: 4 }}>Show them</button>
          </div>
          {msg && <div role="status" style={{ fontSize: 12, background: amberSoft, color: amberInk, borderRadius: 10, padding: '8px 10px' }}>{msg}</div>}
          <div style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 14, padding: 16, fontSize: 13, color: muted, lineHeight: 1.5 }}>
            Feeds the commission run on the 1st: the month's commission is known before the commission invoices arrive.
          </div>
        </aside>
      </div>
    </div>
  )
}
