import React, { useState } from 'react'
import { ink, muted, line, ground, navy, navySoft, teal, tealInk, font, band } from '../ui.js'

// Stocktake on a phone: choose the next tray, restock box or erector to count.
// Preview only — made-up data, nothing saved.

const STATUS = {
  done: { text: 'Counted', bg: '#e3f4f1', fg: '#0b4f45', dot: '#189a85' },
  diff: { text: '2 differences', bg: '#fdf0e1', fg: '#7c2d12', dot: '#d97706' },
  now: { text: 'Ben counting', bg: '#eef4fa', fg: '#1e3a5f', dot: '#2f6fa8' },
  todo: { text: 'Not started', bg: '#f1f3f5', fg: '#5b6b7a', dot: '#c3ccd5' },
  teach: { text: 'Teach first', bg: '#f4e8fb', fg: '#5b2180', dot: '#8e24aa' }
}

const TRAYS = [
  ['Calvary · Diplomat Screws 1', '52 lines · 9:31 · Mat', 'done'],
  ['Calvary · Diplomat Rods & Caps', '18 lines · 9:44 · Mat', 'diff'],
  ['RHH · Diplomat Screws 1', '52 lines · 9:50 · Ben', 'done'],
  ['RHH · Diplomat Instruments', '64 instruments to tick · started 10:05', 'now'],
  ['Calvary lumbar erector', 'sterile boxes · count by code and lot', 'todo'],
  ['Calvary cervical erector', 'sterile boxes · count by code and lot', 'todo'],
  ['RHH loans corner erector', 'sterile boxes · count by code and lot', 'todo'],
  ['Calvary · Ascot Implants', '30 lines', 'todo'],
  ['RHH · Firebird add-on', 'no reference photo yet', 'teach']
].map(([name, sub, status]) => ({ name, sub, status }))

const COUNTED = 18
const TOTAL = 41
const COUNTING_NOW = ['Mat · Calvary trays', 'Ben · RHH trays', 'Aimee · restock boxes']

const chevron = colour => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={colour} strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
)

export default function PhoneStocktake({ go }) {
  const [query, setQuery] = useState('')
  const [blind, setBlind] = useState(false)
  const pct = Math.round((COUNTED / TOTAL) * 100)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = TRAYS.filter(t => words.every(w => `${t.name} ${t.sub}`.toLowerCase().includes(w)))

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', fontFamily: font, color: ink, background: ground }}>
      <header style={{ background: band, color: '#fff', padding: '18px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 58, height: 58, borderRadius: '50%', flexShrink: 0, background: `conic-gradient(#3fd0b6 0 ${pct}%, #23507a ${pct}% 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: navy, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>{COUNTED}/{TOTAL}</div>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 21 }}>Signus annual stocktake</h1>
            <p style={{ margin: '3px 0 0', fontSize: 13, color: '#b9cfe1' }}>Every Signus tray and restock box, both hospitals · live · 7 differences so far</p>
          </div>
        </div>
        <div role="group" aria-label="Counting now" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {COUNTING_NOW.map(who => (
            <span key={who} style={{ fontSize: 12, fontWeight: 600, background: navySoft, border: '1px solid #2c5a82', borderRadius: 999, padding: '6px 10px' }}>● {who}</span>
          ))}
        </div>
      </header>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button type="button" onClick={() => go('count')} style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: '#fff', border: `2px solid ${teal}`, borderRadius: 16, padding: 14, fontFamily: font, color: ink, cursor: 'pointer' }}>
          <div style={{ width: 64, height: 64, borderRadius: 10, background: 'repeating-linear-gradient(90deg, #c9d3dc 0 6px, #e7ecf1 6px 12px)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: tealInk }}>NEXT FOR YOU</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Diplomat Screws 2</div>
            <div style={{ fontSize: 12, color: muted }}>48 lines · 212 implants · taught · last counted 12 Nov</div>
          </div>
          {chevron(teal)}
        </button>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${line}`, borderRadius: 12, padding: '10px 12px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a tray, or scan its tag" aria-label="Find a tray"
            style={{ border: 0, outline: 0, font: `16px ${font}`, fontSize: 16, flex: 1, minWidth: 0 }} />
        </label>

        <section style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 16, overflow: 'hidden' }}>
          {shown.length === 0 && <div style={{ padding: '14px', fontSize: 13, color: muted }}>No tray matches “{query}”.</div>}
          {shown.map(t => {
            const s = STATUS[t.status]
            return (
              <button key={t.name} type="button" data-stocktake-row onClick={() => go(t.status === 'teach' ? 'teach' : 'count')}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', minHeight: 44, border: 0, borderBottom: '1px solid #f0f3f6', background: '#fff', textAlign: 'left', fontFamily: font, color: ink, cursor: 'pointer' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: s.dot }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: muted }}>{t.sub}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '4px 8px', whiteSpace: 'nowrap', background: s.bg, color: s.fg }}>{s.text}</span>
              </button>
            )
          })}
        </section>

        <button type="button" role="switch" aria-checked={blind} aria-label="Blind count" onClick={() => setBlind(b => !b)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: `1px solid ${line}`, borderRadius: 12, padding: '12px 14px', fontFamily: font, color: ink, textAlign: 'left', cursor: 'pointer' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Blind count</div>
            <div style={{ fontSize: 12, color: muted }}>{blind ? 'On — what we expect stays hidden until you’ve counted' : 'Hide what we expect until you’ve counted'}</div>
          </div>
          <span style={{ width: 46, height: 28, borderRadius: 999, background: blind ? teal : '#d5dde5', display: 'flex', alignItems: 'center', padding: 3, boxSizing: 'border-box', justifyContent: blind ? 'flex-end' : 'flex-start', flexShrink: 0 }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff' }} />
          </span>
        </button>
      </div>
    </div>
  )
}
