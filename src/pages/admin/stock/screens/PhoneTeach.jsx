import React, { useState } from 'react'
import { ink, muted, line, ground, navy, teal, tealSoft, amberSoft, amberInk, font, notBuilt } from '../ui.js'

// Teach the portal a tray: a photo of it fully stocked, then each compartment
// named. Preview only — made-up data, nothing saved.

const SLOTS = 15
const TRAY_LIST_LINES = 34
const PLACED_ELSEWHERE = 14 // tray-list lines placed by slots not on this photo
const ITEMS = [
  ...[5, 6, 7, 8, 9, 10, 11, 12].map(h => `CYLOX cage 12 × 10 × ${h} mm`),
  ...[7, 8, 9, 10, 11, 12].map(h => `CYLOX cage 14 × 12 × ${h} mm`),
  'CYLOX cage 16 × 14 × 8 mm', 'CYLOX cage 16 × 14 × 10 mm'
]
// Slots 1–8 already taught when the screen opens.
const START = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, { item: ITEMS[i], holds: 2 }]))

const stepper = { width: 44, height: 44, borderRadius: 10, border: '1px solid #d5dde5', background: '#fff', font: `600 20px ${font}`, color: ink, cursor: 'pointer' }

export default function PhoneTeach({ go }) {
  const [taught, setTaught] = useState(START)
  const [active, setActive] = useState(9)
  const [holds, setHolds] = useState(2)
  const [choice, setChoice] = useState(ITEMS[8])
  const [msg, setMsg] = useState('')

  const open = n => {
    setActive(n); setMsg('')
    setChoice(taught[n]?.item ?? ITEMS[n - 1])
    setHolds(taught[n]?.holds ?? 2)
  }
  const keep = () => setTaught(t => ({ ...t, [active]: { item: choice, holds } }))
  const next = () => {
    const after = { ...taught, [active]: { item: choice, holds } }
    setTaught(after)
    if (active < SLOTS) open(active + 1)
    else setMsg(notBuilt('Saving the taught tray'))
  }

  const matched = Object.keys(taught).length
  const options = [ITEMS[active - 1], ITEMS[active]].filter(Boolean)

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', fontFamily: font, color: ink, background: ground }}>
      <header style={{ background: '#fff', borderBottom: `1px solid ${line}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" aria-label="Back to trays" onClick={() => go('stocktake')} style={{ width: 40, height: 40, borderRadius: 10, border: 0, background: ground, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b2a91' }}>TEACH THE PORTAL · STEP 2 OF 3</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>CYLOX Implants · Calvary</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          {[teal, teal, '#d5dde5'].map((c, i) => <span key={i} style={{ height: 5, borderRadius: 3, background: c }} />)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: muted }}>
          <span>1 Photo fully stocked</span><span style={{ color: ink, fontWeight: 600 }}>2 Tap each slot</span><span>3 Check it</span>
        </div>
      </header>

      <section style={{ padding: '12px 14px 0' }}>
        <div style={{ height: 250, borderRadius: 14, background: '#2a3440', padding: 14, boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gridTemplateRows: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
          {Array.from({ length: SLOTS }, (_, i) => {
            const n = i + 1
            const on = n === active
            const done = !!taught[n]
            return (
              <button key={n} type="button" data-slot={n} aria-label={`Slot ${n}${done ? `, ${taught[n].item}` : ''}`} onClick={() => open(n)}
                style={{ borderRadius: 8, border: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', padding: 4, background: 'linear-gradient(160deg, #5c6b78, #3a4652)', boxShadow: on ? '0 0 0 3px #3fd0b6' : 'none', cursor: 'pointer', minHeight: 40 }}>
                {(done || on) && (
                  <span style={{ minWidth: 20, height: 20, borderRadius: 10, padding: '0 5px', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? '#3fd0b6' : '#fff', color: navy }}>{n}</span>
                )}
              </button>
            )
          })}
        </div>
        <p style={{ margin: '8px 2px 0', fontSize: 12, color: muted }}>Tap a compartment, then pick what lives there. Pins stay on the photo for every future count.</p>
      </section>

      <section style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ background: '#fff', border: `2px solid ${teal}`, borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Slot {active} — what lives here?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {options.map((item, k) => {
              const on = choice === item
              return (
                <button key={item} type="button" aria-pressed={on} onClick={() => { setChoice(item); setTaught(t => ({ ...t, [active]: { item, holds } })) }}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 8, textAlign: 'left', font: `500 13px ${font}`, minHeight: 40, padding: '10px 12px', borderRadius: 10, border: on ? 0 : `1px solid ${line}`, background: on ? tealSoft : '#fff', color: on ? '#0b4f45' : ink, cursor: 'pointer' }}>
                  <span>{item}</span>
                  {on ? <strong>{k === 0 ? 'from tray list' : 'chosen'}</strong> : <span style={{ color: muted }}>{k === 0 ? 'from tray list' : 'next on list'}</span>}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, flex: 1 }}>Holds when full</span>
            <button type="button" aria-label="One less" onClick={() => setHolds(h => Math.max(1, h - 1))} style={stepper}>−</button>
            <span data-holds style={{ width: 32, textAlign: 'center', fontSize: 20, fontWeight: 700 }}>{holds}</span>
            <button type="button" aria-label="One more" onClick={() => setHolds(h => h + 1)} style={stepper}>+</button>
          </div>
          {taught[active] && taught[active].holds !== holds && (
            <button type="button" onClick={keep} style={{ alignSelf: 'flex-start', minHeight: 40, border: 0, background: 'none', font: `600 13px ${font}`, color: teal, cursor: 'pointer', padding: 0 }}>Keep {holds} for slot {active}</button>
          )}
        </div>
        <div data-progress style={{ fontSize: 12, color: muted, background: '#fff', border: `1px solid ${line}`, borderRadius: 12, padding: '10px 12px', lineHeight: 1.5 }}>
          {matched} of {SLOTS} slots matched · {PLACED_ELSEWHERE + matched} of {TRAY_LIST_LINES} tray-list lines placed<br />
          Tip: flat on a bench, from directly above, lid off, good light, nothing over the tray.
        </div>
        {msg && <div style={{ fontSize: 12, color: amberInk, background: amberSoft, borderRadius: 10, padding: '8px 10px' }}>{msg}</div>}
      </section>

      <footer style={{ background: '#fff', borderTop: `1px solid ${line}`, padding: '10px 14px 14px', display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setMsg(notBuilt('Retaking the photo'))}
          style={{ flex: 1, minHeight: 50, font: `600 14px ${font}`, borderRadius: 14, border: '1px solid #d5dde5', background: '#fff', color: ink, cursor: 'pointer' }}>Retake photo</button>
        <button type="button" onClick={next}
          style={{ flex: 1, minHeight: 50, font: `600 14px ${font}`, borderRadius: 14, border: 0, background: teal, color: '#fff', cursor: 'pointer' }}>{active < SLOTS ? 'Next slot' : 'Check and save'}</button>
      </footer>
    </div>
  )
}
