import React, { useState } from 'react'
import { ink, muted, line, ground, navy, tealInk, tealSoft, amberSoft, amberInk, font, primary, secondary, notBuilt } from '../ui.js'

// Restock a tray, phone — from PhoneRestock.dc.html. The before and after
// photos are drawn as in the mock-up; choosing where the screws came from and
// changing the counts happen on this screen only.

const HEAD = { borderRadius: '50%', aspectRatio: '1' }
const FULL = { ...HEAD, background: 'radial-gradient(circle at 35% 35%, #e9eef3, #8d9aa6)' }
const EMPTY = { ...HEAD, background: '#1b232c', boxShadow: 'inset 0 0 0 1px #3c4955' }
const ADDED = { ...FULL, boxShadow: '0 0 0 2px #3fd0b6' }
const GONE = [5, 13, 14, 21, 22, 30]
const FILLED = [5, 13, 14, 30]
const BEFORE = Array.from({ length: 40 }, (_, i) => (GONE.includes(i) ? EMPTY : FULL))
const AFTER = BEFORE.map((s, i) => (FILLED.includes(i) ? ADDED : s))

const SOURCES = ['Calvary restock box', 'Lumbar erector', 'Cervical erector']

const LINES = [
  { name: 'Screw 6.5 × 45', code: 'AB0321-65045', slot: 'slot 14', qty: 2 },
  { name: 'Screw 6.5 × 40', code: 'AB0321-65040', slot: 'slot 13', qty: 1 },
  { name: 'Screw 5.5 × 35', code: 'AB0321-55035', slot: 'slot 6', qty: 1 }
]

function Photo({ slots, caption }) {
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ height: 120, borderRadius: 12, background: '#2a3440', padding: 9, display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 5, alignContent: 'start', overflow: 'hidden' }}>
        {slots.map((s, i) => <span key={i} style={s} />)}
      </div>
      <figcaption style={{ fontSize: 11, color: muted, textAlign: 'center' }}>{caption}</figcaption>
    </figure>
  )
}

export default function PhoneRestock({ go }) {
  const [from, setFrom] = useState('Calvary restock box')
  const [editing, setEditing] = useState(false)
  const [qty, setQty] = useState(LINES.map(l => l.qty))
  const [msg, setMsg] = useState('')

  const total = qty.reduce((a, b) => a + b, 0)
  const bump = (i, d) => setQty(q => q.map((n, j) => (j === i ? Math.max(0, n + d) : n)))

  return (
    <div style={{ fontFamily: font, color: ink, background: ground, width: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#fff', borderBottom: `1px solid ${line}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: tealInk }}>RESTOCK · CALVARY</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Diplomat Screws 2</div>
        <div style={{ fontSize: 12, color: muted }}>Picked by scanning the tray tag · last photo 18 Nov</div>
      </header>

      <section style={{ padding: '12px 14px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <Photo slots={BEFORE} caption="Before · 18 Nov, after the case" />
          <Photo slots={AFTER} caption="After · now" />
        </div>
        <div style={{ fontSize: 13, background: tealSoft, color: '#0b4f45', borderRadius: 12, padding: '10px 12px', lineHeight: 1.4, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div><strong>The photo shows {total} added.</strong> Where did they come from?</div>
          <div role="group" aria-label="Taken from" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SOURCES.map(s => {
              const on = from === s
              return (
                <button key={s} onClick={() => setFrom(s)} aria-pressed={on} style={{
                  font: `600 12px ${font}`, padding: '7px 10px', borderRadius: 999, cursor: 'pointer',
                  background: on ? navy : '#fff', color: on ? '#fff' : ink, border: on ? 0 : '1px solid #d5dde5'
                }}>{s}</button>
              )
            })}
          </div>
          <div data-restock-from style={{ fontSize: 12 }}>
            {total} taken from the <strong>{from === 'Calvary restock box' ? 'Calvary restock box' : `${from.toLowerCase()}`}</strong> — its count goes down by {total}{from === 'Calvary restock box' ? '' : ', and the erector is flagged to be topped up'}.
          </div>
        </div>
      </section>

      <section style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {LINES.map((l, i) => (
          <div key={l.code} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${line}`, borderRadius: 14, padding: '10px 12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{l.name}</div>
              <div style={{ fontSize: 12, color: muted }}>
                <span onClick={() => go('item')} style={{ cursor: 'pointer', textDecoration: 'underline' }}>{l.code}</span> · {l.slot}
              </div>
            </div>
            {editing && <button aria-label={`One fewer ${l.name}`} onClick={() => bump(i, -1)} style={stepper}>−</button>}
            <span style={{ fontSize: 18, fontWeight: 700, color: tealInk, minWidth: 28, textAlign: 'center' }}>+{qty[i]}</span>
            {editing && <button aria-label={`One more ${l.name}`} onClick={() => bump(i, 1)} style={stepper}>+</button>}
          </div>
        ))}
        <div style={{ fontSize: 13, background: amberSoft, color: amberInk, borderRadius: 12, padding: '10px 12px', lineHeight: 1.4 }}>
          Still short after restocking: <strong>7.5 × 50 (0 of 2)</strong> — none in Calvary restock or on the erectors.{' '}
          <span onClick={() => go('phoneResupply')} style={{ cursor: 'pointer', textDecoration: 'underline' }}>Signus owe 2.</span>
        </div>
      </section>

      <footer style={{ background: '#fff', borderTop: `1px solid ${line}`, padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msg && <div role="status" style={{ fontSize: 12, background: amberSoft, color: amberInk, borderRadius: 10, padding: '8px 10px' }}>{msg}</div>}
        <div style={{ fontSize: 12, color: muted, textAlign: 'center' }}>The photo is posted to Logistics in Messages, like the WhatsApp group today</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEditing(e => !e)} style={{ ...secondary, flex: 1, minHeight: 50, borderRadius: 14 }}>{editing ? 'Done' : 'Change'}</button>
          <button onClick={() => setMsg(notBuilt(`Confirming the restock (${total} from the ${from}) and posting the photo to Logistics`))} style={{ ...primary, flex: 2, minHeight: 50, borderRadius: 14 }}>Confirm restock</button>
        </div>
      </footer>
    </div>
  )
}

const stepper = { width: 36, height: 36, borderRadius: 10, border: '1px solid #d5dde5', background: '#fff', color: ink, font: `600 18px ${font}`, cursor: 'pointer' }
