import React, { useState } from 'react'
import { ink, muted, line, hair, ground, navy, teal, tealSoft, redSoft, redInk, blueSoft, blueInk, amberSoft, amberInk, font, band, primary, secondary, notBuilt } from '../ui.js'

// Resupply and back orders, desktop — from DesktopResupply.dc.html. Made-up
// cases; ticking a line or a case off changes this screen only.

const DISTS = [
  { key: 'all', name: 'All distributors', sub: '31 items owed', n: 14 },
  { key: 'signus', name: 'Signus', sub: '12 items · 2 BO', n: 5, contact: 'Signus' },
  { key: 'device', name: 'Device Technologies', sub: '9 items · 1 BO', n: 4, contact: 'Ortho DT' },
  { key: 'boost', name: 'Boost (Device)', sub: '3 grafts', n: 3, contact: 'Boost' },
  { key: 'e4', name: 'E4 Surgical', sub: '4 items · 2 BO', n: 2, contact: 'Roy at E4' },
  { key: 'kt', name: 'KT Medical', sub: '2 items', n: 1, contact: 'KT Medical' },
  { key: 'globus', name: 'Globus / NuVasive', sub: 'loan only', n: 0, contact: 'Globus' }
]

const CHIP = {
  done: ['#e3f4f1', '#0b4f45'], part: [amberSoft, amberInk], bo: [redSoft, redInk], wait: [blueSoft, blueInk], na: ['#f1f3f5', muted]
}

const CASES = [
  { id: 'marlowe', date: 'Tue 4 Nov', age: '17 days', old: true, pt: 'Marlowe', surgeon: 'Thani', hosp: 'Calvary', sys: 'Diplomat', supply: 'Consignment', dists: ['signus'],
    chips: [['part', 'Signus · partial 10 Nov'], ['bo', 'Signus BO 2']], owed: '2 × rod 40 (BO) · 1 × screw 6.5×45', chased: 'Jasper · 17 Nov',
    summary: 'Used 14 items · back 11 · owed 3',
    trail: [['Partial resupply', '10 Nov · scanned by Toni'], ['Back order notice', '10 Nov · on the docket'], ['Chased Jasper', '17 Nov · Toni']],
    lines: [{ code: 'AB0855-00040', qty: 2, text: 'straight rod 40', bo: true }, { code: 'AB0321-65045', qty: 1, text: 'screw 6.5 × 45' }] },
  { id: 'quinlan', date: 'Thu 6 Nov', age: '15 days', old: true, pt: 'Quinlan', surgeon: 'Gupta', hosp: 'Calvary', sys: 'Mariner MIS', supply: 'Consignment', dists: ['device', 'boost'],
    chips: [['done', 'Device ✓ 12 Nov'], ['wait', 'Boost · waiting']], owed: '1 × Boost UF 5cc', chased: '—', lines: [{ qty: 1, text: 'Boost UF 5cc' }] },
  { id: 'pemberton', date: 'Mon 10 Nov', age: '11 days', pt: 'Pemberton', surgeon: 'Fowler', hosp: 'RHH', sys: 'Dakota', supply: 'Consignment', dists: ['e4'],
    chips: [['wait', 'E4 · waiting']], owed: '4 × cage 14×12 · 1 × plate', chased: '—', lines: [{ qty: 4, text: 'cage 14×12' }, { qty: 1, text: 'plate' }] },
  { id: 'ashdown', date: 'Tue 11 Nov', age: '10 days', pt: 'Ashdown', surgeon: 'Atallah', hosp: 'RHH', sys: 'Diplomat + Firebird', supply: 'Consignment', dists: ['signus', 'device'],
    chips: [['done', 'Signus ✓ 17 Nov'], ['part', 'Device · partial 18 Nov']], owed: '1 × SEA-85-6507', chased: 'Ortho DT · 19 Nov', lines: [{ code: 'SEA-85-6507', qty: 1, text: '' }] },
  { id: 'kerrigan', date: 'Wed 12 Nov', age: '9 days', pt: 'Kerrigan', surgeon: 'JPW', hosp: 'Calvary', sys: 'Reform', supply: 'E4 loan', dists: ['e4'], surplus: true,
    chips: [['na', 'E4 · loan, no resupply']], owed: 'Surplus: 1 screw to GRA', chased: 'GRA requested', lines: [{ qty: 1, text: 'screw to go back (GRA)' }] },
  { id: 'whitlock', date: 'Fri 14 Nov', age: '7 days', pt: 'Whitlock', surgeon: 'Ibbett', hosp: 'Calvary', sys: 'Shoreline', supply: 'Consignment', dists: ['device'],
    chips: [['wait', 'Device · waiting']], owed: '2 × interbody 7°', chased: '—', lines: [{ qty: 2, text: 'interbody 7°' }] },
  { id: 'delahunt', date: 'Mon 17 Nov', age: '4 days', pt: 'Delahunt', surgeon: 'Dubey', hosp: 'Calvary', sys: 'Diplomat', supply: 'Consignment', dists: ['signus'],
    chips: [['part', 'Signus · partial 20 Nov']], owed: '3 × set screw', chased: '—', lines: [{ qty: 3, text: 'set screw' }] },
  { id: 'renshaw', date: 'Tue 18 Nov', age: '3 days', pt: 'Renshaw', surgeon: 'Thani', hosp: 'Calvary', sys: 'Diplomat + Boost', supply: 'Consignment', dists: ['signus', 'boost'],
    chips: [['wait', 'Signus · waiting'], ['wait', 'Boost · waiting']], owed: '9 items · 1 graft', chased: '—', lines: [{ qty: 9, text: 'items (Signus)' }, { qty: 1, text: 'graft (Boost)' }] },
  { id: 'okafor', date: 'Wed 19 Nov', age: '2 days', pt: 'Okafor', surgeon: 'Fowler', hosp: 'RHH', sys: 'Lonestar', supply: 'Consignment', dists: ['kt'],
    chips: [['wait', 'KT · waiting']], owed: '2 × cage', chased: '—', lines: [{ qty: 2, text: 'cage' }] }
]

const COLS = '82px 150px 110px 120px minmax(0, 1fr) 150px 120px'
const isBo = c => c.chips.some(([k]) => k === 'bo')

export default function DesktopResupply({ go }) {
  const [tab, setTab] = useState('waiting')
  const [dist, setDist] = useState('all')
  const [selected, setSelected] = useState('marlowe')
  const [received, setReceived] = useState({}) // `${caseId}:${lineIndex}` → true
  const [msg, setMsg] = useState('')

  const lineDone = (c, i) => !!received[`${c.id}:${i}`]
  const caseDone = c => c.lines.every((_, i) => lineDone(c, i))
  const doneCases = CASES.filter(caseDone)
  const doneFor = key => doneCases.filter(c => key === 'all' || c.dists.includes(key)).length

  const TABS = [
    ['waiting', `Waiting · ${14 - doneCases.length}`],
    ['bo', `Back orders · ${6 - doneCases.filter(isBo).length}`],
    ['surplus', `Surplus to return · ${2 - doneCases.filter(c => c.surplus).length}`],
    ['done', `Done this month · ${41 + doneCases.length}`],
    ['all', 'All cases']
  ]

  const rows = CASES.filter(c => dist === 'all' || c.dists.includes(dist)).filter(c =>
    tab === 'all' ? true : tab === 'done' ? caseDone(c) : caseDone(c) ? false :
      tab === 'bo' ? isBo(c) : tab === 'surplus' ? !!c.surplus : true)

  const sel = CASES.find(c => c.id === selected)
  const toggleLine = (c, i) => setReceived(r => ({ ...r, [`${c.id}:${i}`]: !r[`${c.id}:${i}`] }))
  const markAll = c => setReceived(r => { const n = { ...r }; c.lines.forEach((_, i) => { n[`${c.id}:${i}`] = true }); return n })

  return (
    <div style={{ fontFamily: font, color: ink, background: ground, display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: band, color: '#fff', padding: '22px 22px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px' }}>
            <h1 style={{ margin: 0, fontSize: 26 }}>Resupply and back orders</h1>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: '#b9cfe1' }}>
              Built from usage scans and resupply scans — nobody types a date in. {14 - doneCases.length} cases waiting · 31 items owed · 6 on back order · 2 surplus to send back
            </p>
          </div>
          <button onClick={() => setMsg(notBuilt('Scanning a resupply'))} style={{ font: `600 13px ${font}`, padding: '10px 14px', borderRadius: 10, border: 0, background: teal, color: '#fff', cursor: 'pointer' }}>Scan a resupply</button>
        </div>
        <div role="tablist" aria-label="View" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {TABS.map(([id, name]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} style={{
              font: `600 13px ${font}`, padding: '11px 16px', border: 0, borderRadius: '10px 10px 0 0', cursor: 'pointer', whiteSpace: 'nowrap',
              background: tab === id ? ground : 'transparent', color: tab === id ? navy : '#cfe0ee'
            }}>{name}</button>
          ))}
        </div>
      </header>

      {msg && <div role="status" style={{ margin: '12px 16px 0', background: amberSoft, color: amberInk, borderRadius: 10, padding: '8px 12px', fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '18px 16px' }}>
        <section aria-label="Distributors" style={{ flex: '1 1 200px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DISTS.map(d => {
            const on = dist === d.key
            const n = Math.max(0, d.n - doneFor(d.key))
            return (
              <button key={d.key} onClick={() => setDist(d.key)} aria-pressed={on} style={{
                display: 'flex', alignItems: 'center', gap: 10, borderRadius: 12, padding: '12px 14px', fontFamily: font, color: ink, cursor: 'pointer',
                background: on ? tealSoft : '#fff', border: on ? '1px solid #9fd8cc' : `1px solid ${line}`
              }}>
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{d.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: muted, marginTop: 2 }}>{d.sub}</span>
                </span>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{n}</span>
              </button>
            )
          })}
          <div style={{ marginTop: 6, fontSize: 12, color: muted, lineHeight: 1.5, padding: '0 4px' }}>Oldest first. A case drops off once every item used is back, or marked loan / no resupply.</div>
        </section>

        <section aria-label="Cases waiting" style={{ flex: '999 1 520px', minWidth: 0, background: '#fff', border: `1px solid ${line}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 960 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: muted, borderBottom: `1px solid ${hair}`, background: '#fafbfc' }}>
                <span>CASE DATE</span><span>PATIENT · SURGEON</span><span>HOSPITAL</span><span>SYSTEM</span><span>BY DISTRIBUTOR</span><span>STILL OWED</span><span>CHASED</span>
              </div>
              {rows.length === 0 && <div style={{ padding: 24, fontSize: 13, color: muted }}>Nothing here for this distributor.</div>}
              {rows.map(c => {
                const on = c.id === selected
                const done = caseDone(c)
                return (
                  <div key={c.id} onClick={() => setSelected(c.id)} data-case-row={c.id} style={{
                    display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '12px 18px', alignItems: 'center', borderBottom: '1px solid #f0f3f6', cursor: 'pointer',
                    background: on ? '#f2faf8' : '#fff', boxShadow: on ? `inset 3px 0 0 ${teal}` : 'none'
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.date}<span style={{ display: 'block', fontSize: 11, color: c.old ? '#b42318' : muted, fontWeight: 600 }}>{c.age}</span></span>
                    <span style={{ fontSize: 13 }}><strong>pt {c.pt}</strong><span style={{ display: 'block', color: muted, fontSize: 12 }}>{c.surgeon}</span></span>
                    <span style={{ fontSize: 13 }}>{c.hosp}</span>
                    <span style={{ fontSize: 13 }}>{c.sys}<span style={{ display: 'block', color: muted, fontSize: 12 }}>{c.supply}</span></span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(done ? [['done', 'All back ✓ (by hand)']] : c.chips).map(([k, t]) => (
                        <span key={t} style={{ fontSize: 12, fontWeight: 600, borderRadius: 999, padding: '4px 9px', whiteSpace: 'nowrap', background: CHIP[k][0], color: CHIP[k][1] }}>{t}</span>
                      ))}
                    </span>
                    <span style={{ fontSize: 12, lineHeight: 1.4, textDecoration: done ? 'line-through' : 'none' }}>{c.owed}</span>
                    <span style={{ fontSize: 12, color: muted }}>{c.chased}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {sel && <Detail c={sel} go={go} lineDone={i => lineDone(sel, i)} toggle={i => toggleLine(sel, i)} markAll={() => markAll(sel)} done={caseDone(sel)} />}
      </div>
    </div>
  )
}

function Detail({ c, go, lineDone, toggle, markAll, done }) {
  const [msg, setMsg] = useState('')
  const owing = c.lines.filter((_, i) => !lineDone(i)).reduce((s, l) => s + l.qty, 0)
  const contact = c.id === 'marlowe' ? 'Signus' : DISTS.find(d => d.key === c.dists[c.dists.length - 1])?.contact
  const trail = c.trail || c.chips.map(([, t]) => [t, '']).concat(c.chased !== '—' ? [[`Chased ${c.chased.split(' · ')[0]}`, c.chased.split(' · ')[1] || '']] : [])
  return (
    <aside aria-label="Selected case" style={{ flex: '1 1 280px', maxWidth: '100%', background: '#fff', border: `1px solid ${line}`, borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, alignSelf: 'flex-start' }}>
      <div style={{ fontSize: 12, color: muted, fontWeight: 600 }}>{`${c.date} · ${c.hosp} · ${c.surgeon}`.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>pt {c.pt} · {c.sys}</div>
      <div style={{ fontSize: 13, color: muted }}>{done ? 'Everything is back' : c.summary && owing === 3 ? c.summary : `Still owed ${owing}`}</div>
      <div style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${hair}`, borderRadius: 12 }}>
        {trail.map(([a, b], i) => (
          <div key={a} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderBottom: i < trail.length - 1 ? `1px solid ${hair}` : 0, fontSize: 13 }}>
            <span>{a}</span><span style={{ color: muted }}>{b}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{c.surplus ? 'To send back' : 'Still owed'} <span style={{ fontWeight: 400, color: muted }}>· tap a line when it arrives</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {c.lines.map((l, i) => {
          const got = lineDone(i)
          const [bg, fg] = got ? [tealSoft, '#0b4f45'] : l.bo ? [redSoft, redInk] : [blueSoft, blueInk]
          return (
            <div key={i} onClick={() => toggle(i)} role="checkbox" aria-checked={got} data-owed-line style={{ fontSize: 13, background: bg, color: fg, borderRadius: 10, padding: '8px 10px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ fontWeight: 700 }}>{got ? '✓' : '○'}</span>
              <span style={{ textDecoration: got ? 'line-through' : 'none' }}>
                <strong>{l.qty} × </strong>
                {l.code && <strong onClick={e => { e.stopPropagation(); go('item') }} style={{ textDecoration: 'underline', cursor: 'pointer' }}>{l.code}</strong>} {l.text}
                {got ? ' · received' : l.bo ? ' · back order' : l.code ? ' · owed' : ''}
              </span>
            </div>
          )
        })}
      </div>
      {!c.surplus && <div style={{ fontSize: 13, background: ground, borderRadius: 10, padding: '10px 12px', lineHeight: 1.45 }}>When it arrives it goes to <strong>TM Buffer</strong>, then onto the {c.hosp} tray with the next <span onClick={() => go('restock')} style={{ color: teal, fontWeight: 600, cursor: 'pointer' }}>restock</span>.</div>}
      {msg && <div role="status" style={{ fontSize: 12, background: amberSoft, color: amberInk, borderRadius: 10, padding: '8px 10px' }}>{msg}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={() => setMsg(notBuilt(`Drafting a chase email to ${contact}`))} style={{ ...primary, font: `600 13px ${font}` }}>Draft a chase email to {contact}</button>
        <button onClick={markAll} disabled={done} style={{ ...secondary, font: `600 13px ${font}`, opacity: done ? 0.5 : 1 }}>{done ? 'Marked received ✓' : 'Mark received by hand'}</button>
      </div>
    </aside>
  )
}
