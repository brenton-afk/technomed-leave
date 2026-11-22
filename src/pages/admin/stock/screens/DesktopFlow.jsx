import React, { useState } from 'react'
import { ink, muted, line, teal, tealInk, font } from '../ui.js'

// How stock moves — desktop diagram. Ported from the DesktopFlow mock-up.
// Each box and arrow opens the screen that shows that part, where there is one.

const STAGES = [
  { eyebrow: 'OWNED BY', title: 'Distributor', text: 'Signus, Device, E4, KT, Globus. Consignment stays theirs until it’s used.', border: '#c9d3dc', bg: '#f8fafb', eyeInk: muted, textInk: muted, to: 'resupply' },
  { eyebrow: 'AT THE OFFICE', title: 'TM Buffer', text: 'Extra stock not on a tray — the top-up pool. Shelf or bin locations.', border: '#9aa9b7', bg: '#f4f6f8', eyeInk: muted, textInk: muted, to: 'main' },
  { eyebrow: 'ON THE SHELF', title: 'Hospital trays', text: 'Calvary and RHH sets from the kit room. Each tray’s list is its par.', border: teal, bg: '#e3f4f1', eyeInk: '#0b4f45', textInk: '#24524a', to: 'stocktake' },
  { eyebrow: 'USED IN A CASE', title: 'Owed back', text: 'Until the distributor resupplies it — the bookings doc’s resupply columns.', border: '#f1a9a1', bg: '#fdecea', eyeInk: '#7f1d1d', textInk: '#7f1d1d', to: 'phoneResupply' }
]

const ARROWS = [
  { label: 'Resupply scan', sub: '+ to Buffer', colour: teal, ink: tealInk, to: 'resupply' },
  { label: 'Restock a tray', sub: 'Buffer → tray', colour: teal, ink: tealInk, to: 'restock' },
  { label: 'Usage scan', sub: '− from the tray', colour: '#b42318', ink: '#b42318', to: 'billing' }
]

const RULES = [
  { title: 'Transfers', text: 'A kit-room move of a tray takes its contents with it. Loose items moved by hand get their own “Move stock”.', to: 'main' },
  { title: 'Loan sets', text: 'Shown as “visiting” stock, never counted as ours. Usage from a loan set is owed nothing — it’s billed.', to: 'billing' },
  { title: 'Returns and surplus', text: 'Surplus, wrong size or expired goes back on a GRA. It leaves the count when it’s sent.', to: null },
  { title: 'Stocktake', text: 'Each counted line resets what the ledger says, with the reason for any difference kept beside it.', to: 'review' }
]

const reset = { font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }

function Arrow({ a, go }) {
  return (
    <button type="button" onClick={() => go(a.to)} aria-label={`${a.label}: ${a.sub}`}
      style={{ ...reset, flex: '0 0 110px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px', border: 0, background: 'none', borderRadius: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', color: a.ink }}>{a.label}</span>
      <svg width="100" height="14" viewBox="0 0 100 14" aria-hidden="true"><path d="M2 7h90" stroke={a.colour} strokeWidth="2" /><path d="M88 2l8 5-8 5" fill="none" stroke={a.colour} strokeWidth="2" /></svg>
      <span style={{ fontSize: 11, color: muted }}>{a.sub}</span>
    </button>
  )
}

export default function DesktopFlow({ go }) {
  const [msg, setMsg] = useState('')
  const open = to => (to ? go(to) : setMsg('Returns and surplus has no screen yet — this is a preview.'))

  return (
    <div style={{ boxSizing: 'border-box', padding: 'clamp(18px, 4vw, 40px) clamp(14px, 4vw, 48px)', fontFamily: font, color: ink, background: '#fff', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 28 }}>Every movement is something the portal already sees</h1>
        <p style={{ margin: '8px 0 0', fontSize: 15, color: muted, maxWidth: 900 }}>Stock on hand is a running ledger. Each arrow is an event the team already does in the portal; a stocktake corrects the ledger, it doesn't replace it.</p>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: tealInk }}>Tap a box or an arrow to open its screen.</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', rowGap: 8 }}>
        {STAGES.map((s, i) => (
          <React.Fragment key={s.title}>
            <button type="button" onClick={() => open(s.to)}
              style={{ ...reset, flex: '1 1 170px', minWidth: 0, border: `1.5px solid ${s.border}`, borderRadius: 16, padding: 18, background: s.bg }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: s.eyeInk }}>{s.eyebrow}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2, color: ink }}>{s.title}</div>
              <div style={{ fontSize: 13, color: s.textInk, marginTop: 6, lineHeight: 1.45 }}>{s.text}</div>
            </button>
            {ARROWS[i] && <Arrow a={ARROWS[i]} go={go} />}
          </React.Fragment>
        ))}
      </div>

      <button type="button" onClick={() => go('resupply')} style={{ ...reset, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', border: 0, background: 'none' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={teal} strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M20 12a8 8 0 11-3-6.2M20 4v5h-5" /></svg>
        <span style={{ fontSize: 14, color: ink }}><strong>The loop closes</strong> when the resupply for that case is scanned — the owed line clears and the stock lands in TM Buffer (or straight onto the tray, if it's delivered to the hospital).</span>
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        {RULES.map(r => (
          <button type="button" key={r.title} onClick={() => open(r.to)} style={{ ...reset, border: `1px solid ${line}`, borderRadius: 14, padding: 16, background: '#fff' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{r.title}</div>
            <div style={{ fontSize: 13, color: muted, marginTop: 6, lineHeight: 1.45 }}>{r.text}</div>
          </button>
        ))}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, color: muted }}>{msg}</div>}
    </div>
  )
}
