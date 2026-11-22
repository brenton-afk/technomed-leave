import React, { useState } from 'react'
import { ink, muted, line, ground, navy, teal, tealSoft, restockGrey, amberSoft, amberInk, font, band, notBuilt } from '../ui.js'

// Stocktake on a phone: explain each difference before it goes to Erin.
// Preview only — made-up data, nothing saved.

const WHY = ['Used, not scanned', 'Moved to another tray', 'Miscount before', 'Damaged / expired', 'Don’t know']

const DIFFS = [
  { name: 'Screw 7.5 × 50 · Diplomat', where: 'Diplomat Screws 2 · slot 22', expected: 4, counted: 2,
    hint: 'Likely used on Thu 20 Nov (Ibbett, L5/S1 fixation) — that usage hasn’t been scanned yet.', reasons: WHY, picked: 'Used, not scanned' },
  { name: 'Screw 6.5 × 45 · Diplomat', where: 'Diplomat Screws 2 · slot 14', expected: 4, counted: 3,
    hint: '', reasons: WHY, picked: '' },
  { name: 'Straight rod 40 · Diplomat', where: 'Calvary lumbar erector', expected: 0, counted: 2,
    hint: 'Signus back order for 2 of these was still open — they may have arrived without being checked in.',
    reasons: ['Resupply not checked in', 'Came from RHH', 'Miscount before', 'Don’t know'], picked: 'Resupply not checked in' }
]
// Of the seven differences, the ones further down the list still to explain.
const OFF_SCREEN_UNEXPLAINED = 3

const reasonChip = on => ({
  font: `600 12px ${font}`, padding: '8px 11px', borderRadius: 999, minHeight: 40, cursor: 'pointer',
  border: on ? 0 : '1px solid #d5dde5', background: on ? navy : '#fff', color: on ? '#fff' : ink
})

export default function PhoneReview({ go }) {
  const [picked, setPicked] = useState(() => DIFFS.map(d => d.picked))
  const [notes, setNotes] = useState(() => DIFFS.map(() => ''))
  const [msg, setMsg] = useState('')

  const pick = (i, r) => setPicked(ps => ps.map((p, j) => (j === i ? (p === r ? '' : r) : p)))
  const still = OFF_SCREEN_UNEXPLAINED + picked.filter(p => !p).length
  const ready = still === 0

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', fontFamily: font, color: ink, background: ground }}>
      <header style={{ background: band, color: '#fff', padding: '18px 16px 16px' }}>
        <h1 style={{ margin: 0, fontSize: 21 }}>7 differences to explain</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#b9cfe1' }}>Signus stocktake · 23 trays, 2 restock boxes and 3 erectors · 1,104 lines matched</p>
      </header>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {DIFFS.map((d, i) => {
          const n = d.counted - d.expected
          return (
            <section key={d.name} data-diff={i} style={{ background: '#fff', border: `1px solid ${line}`, borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: muted }}>{d.where}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: n < 0 ? '#b42318' : '#0f7a69' }}>{n < 0 ? '−' : '+'}{Math.abs(n)}</div>
                  <div style={{ fontSize: 11, color: muted }}>expected {d.expected} · counted {d.counted}</div>
                </div>
              </div>
              {d.hint && <div style={{ fontSize: 13, background: tealSoft, color: '#0b4f45', borderRadius: 10, padding: '9px 11px', lineHeight: 1.4 }}>{d.hint}</div>}
              <div role="group" aria-label="Why" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {d.reasons.map(r => (
                  <button key={r} type="button" aria-pressed={picked[i] === r} onClick={() => pick(i, r)} style={reasonChip(picked[i] === r)}>{r}</button>
                ))}
              </div>
              <textarea value={notes[i]} onChange={e => { const v = e.target.value; setNotes(ns => ns.map((x, j) => (j === i ? v : x))) }}
                placeholder="Add a note (optional)" aria-label={`Note for ${d.name}`} rows={2}
                style={{ font: `16px ${font}`, fontSize: 16, color: ink, border: `1px solid ${line}`, borderRadius: 10, padding: '8px 10px', resize: 'vertical', minHeight: 44, boxSizing: 'border-box', width: '100%' }} />
            </section>
          )
        })}
        <div style={{ fontSize: 12, color: muted, textAlign: 'center' }}>{OFF_SCREEN_UNEXPLAINED + 1} more differences further down — not shown in this preview.</div>
      </div>

      <footer style={{ background: '#fff', borderTop: `1px solid ${line}`, padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div data-still style={{ fontSize: 12, color: muted, textAlign: 'center' }}>
          {ready ? 'All explained' : `${still} still to explain`} · Erin sees the value of anything confirmed missing, then signs off or asks for a recount
        </div>
        {msg && <div style={{ fontSize: 12, color: amberInk, background: amberSoft, borderRadius: 10, padding: '8px 10px' }}>{msg}</div>}
        <button type="button" onClick={() => setMsg(notBuilt('Signing off'))}
          style={{ minHeight: 50, font: `600 15px ${font}`, borderRadius: 14, border: 0, background: ready ? teal : restockGrey, color: '#fff', cursor: 'pointer' }}>Submit to Erin</button>
        <button type="button" onClick={() => go('stocktake')} style={{ alignSelf: 'center', minHeight: 40, border: 0, background: 'none', font: `600 13px ${font}`, color: teal, cursor: 'pointer' }}>‹ Back to the trays</button>
      </footer>
    </div>
  )
}
