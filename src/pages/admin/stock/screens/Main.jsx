import React, { useState } from 'react'
import {
  ink, muted, line, hair, ground, navy, navySoft, teal, tealSoft, rhh, restockGrey,
  amberSoft, amberInk, redSoft, redInk, blueSoft, font, band, bandChip, notBuilt
} from '../ui.js'

// Stock on hand — desktop. Ported from the Main mock-up; made-up data.

const SYSTEMS = [
  ['Diplomat', 186, 3], ['Mariner', 214, 5], ['Firebird', 96, 0], ['Reform Cervical', 88, 2], ['Dakota', 141, 1],
  ['Shoreline', 72, 4], ['Catenary ALIF', 38, 0], ['CYLOX', 54, 2], ['Lonestar', 61, 0], ['Boost UltraFibres', 18, 6]
].map(([name, count, low]) => ({ name, count, low }))

const PLACES = [
  ['all', 'All places'], ['clvTrays', 'Calvary trays · 512'], ['clvRestock', 'Calvary restock · 104'],
  ['clvLumbar', 'Calvary lumbar erector · 38'], ['clvCervical', 'Calvary cervical erector · 22'],
  ['rhhTrays', 'RHH trays · 468'], ['rhhRestock', 'RHH restock · 96'], ['rhhLoans', 'RHH loans corner erector · 31']
]
const VIEWS = ['Size grid', 'List', 'By tray']
const PARTS = ['Screws', 'Rods', 'Set screws', 'Cross links']

const LENGTHS = [30, 35, 40, 45, 50, 55]
// [Calvary tray, RHH tray, restock (both hospitals), par] per diameter × length
const DATA = {
  '4.5': [[4, 2, 3, 6], [5, 3, 3, 6], [3, 2, 1, 6], [2, 2, 2, 4], [1, 1, 0, 4], [0, 0, 1, 2]],
  '5.5': [[3, 3, 4, 8], [4, 4, 4, 10], [4, 4, 5, 10], [3, 4, 3, 10], [2, 2, 2, 8], [1, 1, 2, 4]],
  '6.5': [[2, 2, 2, 6], [3, 3, 3, 8], [3, 2, 3, 10], [3, 2, 4, 12], [2, 2, 2, 8], [1, 2, 1, 4]],
  '7.5': [[1, 1, 2, 4], [2, 2, 2, 6], [2, 1, 2, 6], [1, 1, 1, 6], [0, 1, 0, 4], [0, 0, 0, 2]]
}
const DIAMETERS = Object.keys(DATA)

const COMING = [
  { text: 'Mon 24 · Thani · Calvary · L4/5 PLIF' },
  { text: 'Wed 26 · Fowler · RHH · T12–L2 fixation' },
  { text: 'Fri 28 · Ibbett · Calvary · needs 7.5 × 50 — Calvary tray has 0', warn: true }
]

const STATE = {
  ok: { bg: tealSoft, bd: '#9fd8cc', ink: '#0b4f45' },
  low: { bg: amberSoft, bd: '#f2c48d', ink: amberInk },
  out: { bg: redSoft, bd: '#f1a9a1', ink: redInk }
}

const cellOf = (d, i) => {
  const [c, r, b, par] = DATA[d][i]
  const total = c + r + b
  const state = total === 0 ? 'out' : total < par ? 'low' : 'ok'
  return { d, len: LENGTHS[i], c, r, b, par, total, state, short: Math.max(0, par - total) }
}

const btn = { cursor: 'pointer', fontFamily: font }

export default function Main({ go }) {
  const [q, setQ] = useState('diplomat 6.5')
  const [place, setPlace] = useState('all')
  const [view, setView] = useState('Size grid')
  const [system, setSystem] = useState('Diplomat')
  const [part, setPart] = useState('Screws')
  const [sel, setSel] = useState({ d: '6.5', i: 3 })
  const [note, setNote] = useState('')

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const sysWords = words.filter(w => !/^[\d.×x]+$/.test(w))
  const shownSystems = SYSTEMS.filter(s => sysWords.every(w => s.name.toLowerCase().includes(w)) || !sysWords.length)
  const numWords = words.filter(w => /^\d/.test(w))
  const cellMatches = (d, len) => numWords.length > 0 && numWords.every(w => w === d || w === String(len))

  const say = what => setNote(notBuilt(what))
  const sample = system === 'Diplomat' && part === 'Screws'
  const cell = cellOf(sel.d, sel.i)
  const clvRestock = Math.ceil(cell.b / 2)
  const rhhRestock = cell.b - clvRestock
  const code = `AB0321-${Math.round(Number(cell.d) * 10)}0${cell.len}`

  return (
    <div style={{ fontFamily: font, color: ink, background: ground, display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: band, color: '#fff', padding: '22px 24px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Stock on hand</h1>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: '#b9cfe1' }}>1,271 implants on trays, in restock and on the erectors at Calvary and RHH · 23 lines below par · 9 owed by distributors · 4 on back order</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => go('stocktake')} style={{ ...btn, font: `600 13px ${font}`, padding: '10px 14px', borderRadius: 10, border: '1px solid #2c5a82', background: navySoft, color: '#fff' }}>Start a stocktake</button>
            <button type="button" onClick={() => say('Restock list')} style={{ ...btn, font: `600 13px ${font}`, padding: '10px 14px', borderRadius: 10, border: 0, background: teal, color: '#fff' }}>Restock list (12)</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 10, padding: '9px 12px', flex: '0 1 360px', minWidth: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} aria-label="Search stock" style={{ border: 0, outline: 0, fontFamily: font, fontSize: 16, flex: 1, minWidth: 0, color: ink }} />
          </label>
          <div role="group" aria-label="Place" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PLACES.map(([id, label]) => (
              <button type="button" key={id} onClick={() => setPlace(id)} style={bandChip(place === id)}>{label}</button>
            ))}
          </div>
          <div role="group" aria-label="View" style={{ marginLeft: 'auto', display: 'flex', background: navySoft, borderRadius: 10, padding: 3 }}>
            {VIEWS.map(v => (
              <button type="button" key={v} onClick={() => setView(v)} style={{ ...btn, font: `600 12px ${font}`, padding: '7px 12px', borderRadius: 8, border: 0, background: view === v ? '#fff' : 'transparent', color: view === v ? navy : '#dce8f2' }}>{v}</button>
            ))}
          </div>
        </div>
      </header>

      {note && (
        <div role="status" style={{ margin: '12px 22px 0', background: amberSoft, color: amberInk, borderRadius: 10, padding: '9px 12px', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{note}</span>
          <button type="button" onClick={() => setNote('')} aria-label="Dismiss" style={{ ...btn, border: 0, background: 'none', color: amberInk, fontSize: 16 }}>×</button>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '18px 22px', alignItems: 'flex-start' }}>
        <section aria-label="Systems" style={{ flex: '1 1 200px', maxWidth: 260, minWidth: 0, background: '#fff', border: `1px solid ${line}`, borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: muted, padding: '6px 8px' }}>SYSTEMS</div>
          {shownSystems.map(s => {
            const on = s.name === system
            return (
              <button type="button" key={s.name} onClick={() => setSystem(s.name)} style={{ ...btn, display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 0, borderRadius: 9, padding: '9px 10px', font: `${on ? 600 : 500} 14px ${font}`, color: ink, background: on ? tealSoft : 'transparent' }}>
                <span style={{ flex: 1, textAlign: 'left' }}>{s.name}</span>
                <span style={{ fontSize: 12, color: muted }}>{s.count}</span>
                {s.low > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#9a3412', background: amberSoft, borderRadius: 999, padding: '2px 7px' }}>{s.low} low</span>}
              </button>
            )
          })}
          {!shownSystems.length && <div style={{ fontSize: 13, color: muted, padding: '6px 8px' }}>No system matches “{q}”.</div>}
        </section>

        <section aria-label={`${system} size grid`} style={{ flex: '999 1 420px', minWidth: 0, background: '#fff', border: `1px solid ${line}`, borderRadius: 14, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 19 }}>{system === 'Diplomat' ? 'Diplomat · Polyaxial pedicle screws' : system}</h2>
            <span style={{ fontSize: 13, color: muted }}>{system === 'Diplomat' ? 'Signus · 186 on hand · par 210' : `${SYSTEMS.find(s => s.name === system)?.count ?? ''} on hand`}</span>
            <div role="group" aria-label="Part" style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PARTS.map(p => (
                <button type="button" key={p} onClick={() => setPart(p)} style={{ ...btn, font: `600 12px ${font}`, padding: '6px 11px', borderRadius: 999, border: part === p ? 0 : '1px solid #d5dde5', background: part === p ? navy : '#fff', color: part === p ? '#fff' : ink }}>{p}</button>
              ))}
            </div>
          </div>

          {(!sample || view !== 'Size grid') && (
            <div style={{ fontSize: 13, background: blueSoft, color: '#1e3a5f', borderRadius: 10, padding: '9px 12px' }}>
              {view !== 'Size grid'
                ? `The ${view.toLowerCase()} view is not built yet — showing the size grid. `
                : ''}
              {!sample && 'Sample data only for Diplomat screws — the grid below is Diplomat’s, shown as a sample.'}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(6, minmax(52px, 1fr))', gap: 6, minWidth: 420 }}>
              <div style={{ fontSize: 11, color: muted, fontWeight: 600, alignSelf: 'end', paddingBottom: 4 }}>Ø \ length</div>
              {LENGTHS.map(l => <div key={l} style={{ fontSize: 12, fontWeight: 600, color: muted, textAlign: 'center', paddingBottom: 4 }}>{l} mm</div>)}
              {DIAMETERS.map(d => (
                <React.Fragment key={d}>
                  <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center' }}>{d}</div>
                  {LENGTHS.map((len, i) => {
                    const x = cellOf(d, i)
                    const st = STATE[x.state]
                    const on = sel.d === d && sel.i === i
                    const hit = cellMatches(d, len)
                    const w = n => (x.total ? `${(n / x.total) * 100}%` : '0')
                    return (
                      <button type="button" key={len} onClick={() => setSel({ d, i })} aria-pressed={on}
                        aria-label={`${d} by ${len} millimetre: ${x.total} on hand, par ${x.par}`}
                        style={{ ...btn, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '10px 6px 8px', borderRadius: 10, background: st.bg, border: on ? `2px solid ${navy}` : `1px solid ${st.bd}`, color: st.ink, boxShadow: on ? '0 4px 12px rgba(4,39,70,.18)' : hit ? `0 0 0 2px ${teal}` : 'none' }}>
                        <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{x.total}</span>
                        <span style={{ fontSize: 11, opacity: 0.85 }}>par {x.par}</span>
                        <span style={{ display: 'flex', gap: 2, width: '100%', height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                          <span style={{ background: teal, width: w(x.c) }} /><span style={{ background: rhh, width: w(x.r) }} /><span style={{ background: restockGrey, width: w(x.b) }} />
                        </span>
                      </button>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 18, fontSize: 12, color: muted, alignItems: 'center', flexWrap: 'wrap' }}>
            {[['ok', 'At or above par'], ['low', 'Below par'], ['out', 'None on hand']].map(([k, t]) => (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: STATE[k].bg, border: `1px solid ${STATE[k].bd}` }} />{t}</span>
            ))}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>Bar:
              <span style={{ width: 18, height: 5, background: teal, borderRadius: 2 }} />Calvary
              <span style={{ width: 18, height: 5, background: rhh, borderRadius: 2 }} />RHH
              <span style={{ width: 18, height: 5, background: restockGrey, borderRadius: 2 }} />Restock (both hospitals)
            </span>
          </div>

          <div style={{ borderTop: `1px solid ${hair}`, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Coming up — booked cases that will draw on Diplomat screws</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {COMING.map(c => (
                <div key={c.text} style={{ fontSize: 13, borderRadius: 10, padding: '8px 12px', background: c.warn ? amberSoft : ground, color: c.warn ? amberInk : ink, fontWeight: c.warn ? 600 : 400 }}>{c.text}</div>
              ))}
            </div>
          </div>
        </section>

        <aside aria-label="Selected size" style={{ flex: '1 1 280px', maxWidth: 420, minWidth: 0, background: '#fff', border: `1px solid ${line}`, borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: muted, fontWeight: 600 }}>Diplomat polyaxial screw</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{cell.d} × {cell.len} mm</div>
            <div style={{ fontSize: 13, color: muted, marginTop: 2 }}>{code} · rebate QQ741</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 40, fontWeight: 700, color: { ok: '#0b4f45', low: '#9a3412', out: redInk }[cell.state] }}>{cell.total}</span>
            <span style={{ fontSize: 14, color: muted }}>on hand · par {cell.par}{cell.short ? ` · ${cell.short} short` : ' · at par'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', border: `1px solid ${hair}`, borderRadius: 12 }}>
            {[
              [teal, 'Calvary tray', 'Diplomat Screws 2 · restock photo 20 Nov', cell.c],
              [restockGrey, 'Calvary restock', 'Office tub, in transit or restock box', clvRestock],
              [rhh, 'RHH tray', 'Diplomat Screws 1 · counted 4 Nov', cell.r],
              [restockGrey, 'RHH restock', 'Office tub, in transit or restock box', rhhRestock]
            ].map(([col, name, sub, n], i) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderBottom: i < 3 ? `1px solid ${hair}` : 0 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: col, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div><div style={{ fontSize: 12, color: muted }}>{sub}</div></div>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{n}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, background: blueSoft, borderRadius: 10, padding: '9px 12px' }}><span>Owed by Signus</span><strong>2 · case 18 Nov, Calvary</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, background: redSoft, color: redInk, borderRadius: 10, padding: '9px 12px' }}><span>On back order</span><strong>1 · since 2 Nov</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, background: ground, borderRadius: 10, padding: '9px 12px' }}><span>Likely needed this week</span><strong>2 · 2 cases</strong></div>
          </div>
          <div style={{ fontSize: 13, color: ink, background: tealSoft, borderRadius: 10, padding: '10px 12px', lineHeight: 1.45 }}>
            <strong>Suggestion:</strong>{' '}
            {cell.short === 0
              ? 'at par — nothing to do for this size.'
              : cell.c === 0 && cell.b > 0
                ? 'the Calvary tray has none — top it up from Calvary restock.'
                : cell.total === 0
                  ? 'none on hand anywhere — chase Signus for the owed stock.'
                  : 'top up the Calvary tray from Calvary restock before Monday’s PLIF.'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => say('Move stock')} style={{ ...btn, flex: 1, font: `600 13px ${font}`, padding: 11, borderRadius: 10, border: 0, background: teal, color: '#fff' }}>Move stock</button>
            <button type="button" onClick={() => go('item')} style={{ ...btn, flex: 1, font: `600 13px ${font}`, padding: 11, borderRadius: 10, border: '1px solid #d5dde5', background: '#fff', color: ink }}>History</button>
          </div>
        </aside>
      </div>
    </div>
  )
}
