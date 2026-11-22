import React, { useState } from 'react'
import { ink, muted, line, ground, navy, teal, tealSoft, redSoft, redInk, amberSoft, amberInk, restockGrey, font, band, primary, secondary, notBuilt } from '../ui.js'

// Waiting on distributors, phone — from PhoneResupply.dc.html. Made-up cases;
// marking one received changes this screen only.

const GROUPS = [
  { name: 'Signus', sub: '5 cases · 12 items · 2 back orders', oldest: 'oldest 17 days', old: true, action: 'Draft a chase email to Jasper',
    cases: [
      { id: 'marlowe', pt: 'Marlowe', surgeon: 'Thani', line: 'Calvary · 4 Nov · 2 rods on back order, 1 screw', bo: true },
      { id: 'delahunt', pt: 'Delahunt', surgeon: 'Dubey', line: 'Calvary · 17 Nov · partial, 3 set screws' }
    ] },
  { name: 'Device Technologies', sub: '4 cases · 9 items · 1 back order', oldest: 'oldest 11 days', old: false, action: 'Draft a chase email to Ortho DT',
    cases: [{ id: 'ashdown', pt: 'Ashdown', surgeon: 'Atallah', line: 'RHH · 11 Nov · 1 × SEA-85-6507', bo: true }] },
  { name: 'E4 Surgical', sub: '2 cases · 4 items', oldest: 'oldest 11 days', old: false, action: 'Draft a chase email to Roy',
    cases: [{ id: 'pemberton', pt: 'Pemberton', surgeon: 'Fowler', line: 'RHH · 10 Nov · 4 cages, 1 plate' }] }
]

const RETURNS = [
  { name: 'E4 Surgical', sub: 'Loan set · surplus to send back', action: 'Ask E4 for a GRA number',
    cases: [{ id: 'kerrigan', pt: 'Kerrigan', surgeon: 'JPW', line: 'Calvary · 12 Nov · 1 screw to go back (GRA requested)' }] }
]

const TABS = [['waiting', 'Waiting'], ['bo', 'Back orders'], ['returns', 'Returns']]

export default function PhoneResupply({ go }) {
  const [tab, setTab] = useState('waiting')
  const [open, setOpen] = useState(null)
  const [got, setGot] = useState({})
  const [msg, setMsg] = useState({})

  const doneCount = Object.values(got).filter(Boolean).length
  const groups = (tab === 'returns' ? RETURNS : GROUPS)
    .map(g => ({ ...g, cases: g.cases.filter(c => tab !== 'bo' || c.bo) }))
    .filter(g => g.cases.length)

  return (
    <div style={{ fontFamily: font, color: ink, background: ground, width: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: band, color: '#fff', padding: '18px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Resupply</h1>
        <p style={{ margin: 0, fontSize: 13, color: '#b9cfe1' }}>{14 - doneCount} cases waiting · 31 items · 6 back orders</p>
        <div role="tablist" aria-label="View" style={{ display: 'flex', gap: 2 }}>
          {TABS.map(([id, name]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setOpen(null) }} style={{
              font: `600 13px ${font}`, padding: '10px 12px', border: 0, borderRadius: '10px 10px 0 0', cursor: 'pointer',
              background: tab === id ? ground : 'transparent', color: tab === id ? navy : '#cfe0ee'
            }}>{name}</button>
          ))}
        </div>
      </header>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groups.map(g => (
          <section key={g.name} style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{g.name}</div>
                <div style={{ fontSize: 12, color: muted }}>{g.sub}</div>
              </div>
              {g.oldest && <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '5px 9px', background: g.old ? redSoft : '#f1f3f5', color: g.old ? redInk : muted }}>{g.oldest}</span>}
            </div>
            {g.cases.map(c => {
              const isOpen = open === c.id
              const done = !!got[c.id]
              return (
                <div key={c.id} style={{ borderTop: '1px solid #f0f3f6', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div onClick={() => setOpen(isOpen ? null : c.id)} data-phone-case={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, textDecoration: done ? 'line-through' : 'none' }}>pt {c.pt} · {c.surgeon}</div>
                      <div style={{ fontSize: 12, color: done ? teal : muted }}>{done ? 'Received ✓ — marked by hand' : c.line}</div>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={restockGrey} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"
                      style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M9 6l6 6-6 6" /></svg>
                  </div>
                  {isOpen && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => setGot(s => ({ ...s, [c.id]: !s[c.id] }))} style={{ ...secondary, flex: '1 1 140px', font: `600 13px ${font}`, background: done ? tealSoft : '#fff' }}>
                        {done ? 'Undo received' : tab === 'returns' ? 'Mark sent back' : 'Mark received'}
                      </button>
                      <button onClick={() => go('resupply')} style={{ ...secondary, flex: '1 1 140px', font: `600 13px ${font}` }}>Open the full case</button>
                    </div>
                  )}
                </div>
              )
            })}
            {msg[g.name] && <div role="status" style={{ fontSize: 12, background: amberSoft, color: amberInk, borderRadius: 10, padding: '8px 10px' }}>{msg[g.name]}</div>}
            <button onClick={() => setMsg(m => ({ ...m, [g.name]: notBuilt(g.action) }))} style={{ ...secondary, font: `600 13px ${font}` }}>{g.action}</button>
          </section>
        ))}
        {groups.length === 0 && <div style={{ fontSize: 13, color: muted, padding: 12 }}>Nothing here.</div>}
      </div>

      <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msg.scan && <div role="status" style={{ fontSize: 12, background: amberSoft, color: amberInk, borderRadius: 10, padding: '8px 10px' }}>{msg.scan}</div>}
        <button onClick={() => setMsg(m => ({ ...m, scan: notBuilt('Scanning a resupply') }))} style={{ ...primary, width: '100%', minHeight: 50, font: `600 15px ${font}`, borderRadius: 14 }}>Scan a resupply</button>
      </div>
    </div>
  )
}
