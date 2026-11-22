import React, { useState } from 'react'
import { ink, muted, line, hair, ground, navySoft, teal, rhh, restockGrey, blueSoft, blueInk, redSoft, redInk, font, band, pill, notBuilt, amberSoft, amberInk } from '../ui.js'

// Find an implant — phone. Ported from the PhoneItem mock-up; made-up data.

const ITEM = { maker: 'SIGNUS · DIPLOMAT', name: 'Polyaxial screw 6.5 × 45', code: 'AB0321-65045', total: 9, par: 12 }

const PLACES = [
  { id: 'clvTray', colour: teal, name: 'Calvary tray', sub: 'Diplomat Screws 2 · slot 14', n: 3 },
  { id: 'clvRestock', colour: restockGrey, name: 'Calvary restock', sub: 'Tub, transit or restock box', n: 2 },
  { id: 'rhhTray', colour: rhh, name: 'RHH tray', sub: 'Diplomat Screws 1 · slot 14', n: 2 },
  { id: 'rhhRestock', colour: restockGrey, name: 'RHH restock', sub: 'Tub, transit or restock box', n: 2 }
]

const EVENTS = [
  ['Tray restocked · photo', '20 Nov · Aimee · from Calvary restock', '+1', '#189a85', 'clvTray'],
  ['Used · Thani case, Calvary', '18 Nov · usage scan', '−2', '#b42318', 'clvTray'],
  ['Checked in · Signus resupply', '14 Nov · Toni · into Calvary tub', '+3', '#2f6fa8', 'clvRestock'],
  ['Stocktake · Calvary', '12 Nov · Mat · counted 4, expected 4', '✓', '#5b6b7a', 'clvTray'],
  ['Back order raised · Signus', '2 Nov · from resupply docket', 'BO 1', '#9a3412', null]
].map(([what, when, qty, colour, place]) => ({ what, when, qty, colour, place }))

const SEARCH_WORDS = 'diplomat signus polyaxial screw 6.5 45 ab0321-65045 pedicle'

const btn = { cursor: 'pointer', fontFamily: font }

export default function PhoneItem({ go }) {
  const [q, setQ] = useState('diplomat 6.5 45')
  const [place, setPlace] = useState(null)
  const [note, setNote] = useState('')

  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const found = words.every(w => SEARCH_WORDS.includes(w))
  const events = place ? EVENTS.filter(e => e.place === place) : EVENTS
  const placeName = PLACES.find(p => p.id === place)?.name

  return (
    <div style={{ width: '100%', fontFamily: font, color: ink, background: ground, display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: band, color: '#fff', padding: '18px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Stock on hand</h1>
          <button type="button" aria-label="Scan a barcode" onClick={() => setNote(notBuilt('Scan a barcode'))} style={{ ...btn, width: 40, height: 40, borderRadius: 10, border: '1px solid #2c5a82', background: navySoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5h3M17 5h3v2M20 17v2h-3M7 19H4v-2M8 9v6M11 9v6M14 9v6M17 9v6" /></svg>
          </button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 12, padding: '11px 12px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={q} onChange={e => setQ(e.target.value)} aria-label="Search stock" style={{ border: 0, outline: 0, fontFamily: font, fontSize: 16, flex: 1, color: ink, minWidth: 0 }} />
          <button type="button" aria-label="Say it" onClick={() => setNote(notBuilt('Search by voice'))} style={{ ...btn, border: 0, background: 'none', padding: 0, display: 'flex' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={teal} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
          </button>
        </label>
      </header>

      <div style={{ padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {note && (
          <div role="status" style={{ background: amberSoft, color: amberInk, borderRadius: 12, padding: '9px 12px', fontSize: 13, display: 'flex', gap: 8 }}>
            <span style={{ flex: 1 }}>{note}</span>
            <button type="button" onClick={() => setNote('')} aria-label="Dismiss" style={{ ...btn, border: 0, background: 'none', color: amberInk, fontSize: 16 }}>×</button>
          </div>
        )}

        {!found ? (
          <section style={{ background: '#fff', borderRadius: 16, border: `1px solid ${line}`, padding: 16, fontSize: 14, color: muted, lineHeight: 1.45 }}>
            Nothing matches “{q}”. This preview only knows the Diplomat 6.5 × 45 screw — try “diplomat 6.5 45”.
          </section>
        ) : (
          <>
            <section style={{ background: '#fff', borderRadius: 16, border: `1px solid ${line}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: muted, fontWeight: 600 }}>{ITEM.maker}</div>
                  <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2 }}>{ITEM.name}</div>
                  <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>{ITEM.code}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 34, fontWeight: 700, color: '#9a3412', lineHeight: 1 }}>{ITEM.total}</div>
                  <div style={{ fontSize: 11, color: muted }}>of par {ITEM.par}</div>
                </div>
              </div>
              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
                <span style={{ width: '33%', background: teal }} /><span style={{ width: '22%', background: rhh }} /><span style={{ width: '45%', background: restockGrey }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {PLACES.map((p, i) => {
                  const on = place === p.id
                  return (
                    <button type="button" key={p.id} onClick={() => setPlace(on ? null : p.id)} aria-pressed={on}
                      style={{ ...btn, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 6px', margin: '0 -6px', border: 0, borderBottom: i < PLACES.length - 1 ? `1px solid ${hair}` : 0, borderRadius: on ? 10 : 0, background: on ? '#e3f4f1' : 'transparent', color: ink, textAlign: 'left' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: p.colour, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 15, fontWeight: 600 }}>{p.name}</div><div style={{ fontSize: 12, color: muted }}>{p.sub}</div></div>
                      <span style={{ fontSize: 18, fontWeight: 700 }}>{p.n}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={pill(blueSoft, blueInk)}>2 owed by Signus</span>
                <span style={pill(redSoft, redInk)}>1 on back order</span>
                <span style={pill(ground, ink)}>2 likely needed this week</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setNote(notBuilt(placeName ? `Move from ${placeName}` : 'Move'))} style={{ ...btn, flex: 1, minHeight: 46, font: `600 14px ${font}`, borderRadius: 12, border: 0, background: teal, color: '#fff' }}>Move</button>
                <button type="button" onClick={() => go('count')} style={{ ...btn, flex: 1, minHeight: 46, font: `600 14px ${font}`, borderRadius: 12, border: '1px solid #d5dde5', background: '#fff', color: ink }}>Count</button>
              </div>
            </section>

            <section style={{ background: '#fff', borderRadius: 16, border: `1px solid ${line}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 14, flex: 1 }}>What happened to it{placeName ? ` · ${placeName}` : ''}</h2>
                {place && <button type="button" onClick={() => setPlace(null)} style={{ ...btn, border: 0, background: 'none', color: '#0f7a69', fontSize: 12, fontWeight: 600 }}>Show all</button>}
              </div>
              {events.map(e => (
                <div key={e.what} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: e.colour }} />
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{e.what}</div><div style={{ fontSize: 12, color: muted }}>{e.when}</div></div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: e.colour }}>{e.qty}</span>
                </div>
              ))}
              {!events.length && <div style={{ fontSize: 13, color: muted }}>Nothing recorded here yet.</div>}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
