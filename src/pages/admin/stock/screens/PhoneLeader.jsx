import React, { useState } from 'react'
import { ink, muted, line, ground, teal, tealSoft, rhh, amberSoft, amberInk, font, band, notBuilt } from '../ui.js'

// Team leader · which trays to open — phone. Ported from the PhoneLeader
// mock-up; made-up data.

const OPEN = [
  { name: 'Diplomat Instruments 1 and 2', why: 'Always for a Diplomat fixation', colour: teal },
  { name: 'Pedicle Screws tray 2 of 3', why: 'Fullest of the three — 5.5 and 6.5 × 35–50 all there', colour: teal },
  { name: 'Diplomat Rods & Caps', why: 'Rods 60–120, set screws', colour: teal },
  { name: 'Diplomat Reduction', why: 'Fixation over three levels — reduction likely', colour: rhh }
]

const btn = { cursor: 'pointer', fontFamily: font }

export default function PhoneLeader({ go }) {
  const [ticked, setTicked] = useState({})
  const [note, setNote] = useState('')
  const done = OPEN.filter(t => ticked[t.name]).length

  return (
    <div style={{ width: '100%', fontFamily: font, color: ink, background: ground, display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: band, color: '#fff', padding: '18px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#7fe0cd' }}>48 HOURS AHEAD · MONDAY 24 NOV</div>
        <h1 style={{ margin: 0, fontSize: 21 }}>Fowler · RHH</h1>
        <p style={{ margin: 0, fontSize: 13, color: '#b9cfe1' }}>T11–L1 posterior fixation · Diplomat (Consignment)</p>
        <p style={{ margin: 0, fontSize: 12, color: '#7fe0cd' }}>Sent to Mat (planned rep) and Ben (team leader)</p>
      </header>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <section style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 15, flex: 1 }}>Open these trays</h2>
            <span style={{ fontSize: 12, color: muted }}>{done} of {OPEN.length} ready</span>
          </div>
          {OPEN.map(t => {
            const on = !!ticked[t.name]
            return (
              <button type="button" key={t.name} aria-pressed={on} onClick={() => setTicked(s => ({ ...s, [t.name]: !on }))}
                style={{ ...btn, display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0 0', border: 0, borderTop: '1px solid #f0f3f6', background: 'none', color: ink, textAlign: 'left', width: '100%' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, background: t.colour }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, textDecoration: on ? 'line-through' : 'none', color: on ? muted : ink }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: muted }}>{t.why}</div>
                </div>
                <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: on ? 0 : '1.5px solid #c9d3dc', background: on ? teal : '#fff', color: '#fff', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>
              </button>
            )
          })}
        </section>

        <section style={{ background: amberSoft, border: '1px solid #f2c48d', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 15, color: amberInk }}>Gaps for T11–L1</h2>
          <div style={{ fontSize: 13, color: amberInk, lineHeight: 1.45 }}>No tray has <strong>7.5 × 50</strong> and RHH restock has two — send them in to be steri-peeled; once the steri-peel is photographed they show as at RHH with the kit. Signus also owe 2.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button type="button" onClick={() => go('restock')} style={{ ...btn, font: `600 13px ${font}`, padding: '8px 12px', borderRadius: 10, border: 0, background: amberInk, color: '#fff' }}>Photograph the steri-peel</button>
            <button type="button" onClick={() => go('item')} style={{ ...btn, font: `600 13px ${font}`, padding: '8px 12px', borderRadius: 10, border: '1px solid #f2c48d', background: '#fff', color: amberInk }}>Where is 7.5 × 50?</button>
          </div>
        </section>

        <section style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Don't open</h2>
          <div style={{ fontSize: 13, color: muted, lineHeight: 1.45 }}>Pedicle Screws tray 1 and 3 — same sizes as tray 2 but fewer on them since the last restock photos. Keep them sealed.</div>
        </section>

        {note && (
          <div role="status" style={{ background: tealSoft, color: ink, borderRadius: 12, padding: '9px 12px', fontSize: 13, display: 'flex', gap: 8 }}>
            <span style={{ flex: 1 }}>{note}</span>
            <button type="button" onClick={() => setNote('')} aria-label="Dismiss" style={{ ...btn, border: 0, background: 'none', color: ink, fontSize: 16 }}>×</button>
          </div>
        )}
      </div>

      <footer style={{ background: '#fff', borderTop: `1px solid ${line}`, padding: '10px 14px 14px', display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setNote(notBuilt('Message Mat'))} style={{ ...btn, flex: 1, minHeight: 50, font: `600 14px ${font}`, borderRadius: 14, border: '1px solid #d5dde5', background: '#fff', color: ink }}>Message Mat (planned rep)</button>
        <button type="button" onClick={() => setNote(notBuilt('Open the booking'))} style={{ ...btn, flex: 1, minHeight: 50, font: `600 14px ${font}`, borderRadius: 14, border: 0, background: teal, color: '#fff' }}>Open the booking</button>
      </footer>
    </div>
  )
}
