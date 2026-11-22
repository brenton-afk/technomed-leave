import React, { useState } from 'react'
import { ink, muted, line, ground, navy, teal, tealSoft, restockGrey, amberSoft, amberInk, font, notBuilt } from '../ui.js'

// Stocktake on a phone: count one tray. Preview only — made-up data.

const TABS = ['Photo', 'Voice', 'Tap', 'Scan']

// The reference photo and the one just taken: 40 screw heads, three flagged.
const MISSING = [13, 21, 22]
const head = { borderRadius: '50%', aspectRatio: '1' }
const FULL = { ...head, background: 'radial-gradient(circle at 35% 35%, #e9eef3, #8d9aa6)' }
const EMPTY = { ...head, background: '#1b232c', boxShadow: 'inset 0 0 0 1px #3c4955' }
const FLAG = { ...head, background: '#1b232c', boxShadow: '0 0 0 2px #f59e0b' }
const REF = Array.from({ length: 40 }, () => FULL)
const NOW = REF.map((s, i) => (MISSING.includes(i) ? FLAG : i === 39 ? EMPTY : s))

const LINES = [
  { slot: '22', name: 'Screw 7.5 × 50', code: 'AB0321-75050', expected: 4, counted: 2 },
  { slot: '14', name: 'Screw 6.5 × 45', code: 'AB0321-65045', expected: 4, counted: 3 },
  { slot: '13', name: 'Screw 6.5 × 40', code: 'AB0321-65040', expected: 4, counted: 4 },
  { slot: '15', name: 'Screw 6.5 × 50', code: 'AB0321-65050', expected: 4, counted: 4 },
  { slot: '23', name: 'Screw 7.5 × 55', code: 'AB0321-75055', expected: 2, counted: null }
]
const TOTAL_LINES = 48
const DONE_ELSEWHERE = 27 // lines on this tray already counted, not shown here
const REST_AS_EXPECTED = 17

const stepper = { width: 40, height: 44, borderRadius: 10, border: '1px solid #d5dde5', background: '#fff', font: `600 20px ${font}`, color: ink, cursor: 'pointer' }

function Photo({ cells, caption }) {
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ height: 128, borderRadius: 12, background: '#2a3440', padding: 10, boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 5, alignContent: 'start' }}>
        {cells.map((s, i) => <span key={i} style={s} />)}
      </div>
      <figcaption style={{ fontSize: 11, color: muted, textAlign: 'center' }}>{caption}</figcaption>
    </figure>
  )
}

export default function PhoneCount({ go }) {
  const [tab, setTab] = useState('Photo')
  const [counts, setCounts] = useState(() => LINES.map(l => l.counted))
  const [rest, setRest] = useState(false)
  const [msg, setMsg] = useState('')

  const change = (i, by) => setCounts(cs => cs.map((c, j) => (j !== i ? c : Math.max(0, (c ?? (by > 0 ? 0 : 1)) + by))))
  const done = DONE_ELSEWHERE + counts.filter(c => c !== null).length + (rest ? REST_AS_EXPECTED : 0)
  const short = LINES.reduce((n, l, i) => n + (counts[i] !== null && counts[i] < l.expected ? l.expected - counts[i] : 0), 0)
  const over = LINES.reduce((n, l, i) => n + (counts[i] !== null && counts[i] > l.expected ? counts[i] - l.expected : 0), 0)

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', fontFamily: font, color: ink, background: ground }}>
      <header style={{ background: '#fff', borderBottom: `1px solid ${line}`, padding: '14px 14px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" aria-label="Back to trays" onClick={() => go('stocktake')} style={{ width: 40, height: 40, borderRadius: 10, border: 0, background: ground, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Diplomat Screws 2</div>
            <div style={{ fontSize: 12, color: muted }} data-lines-done>Calvary · {done} of {TOTAL_LINES} lines done</div>
          </div>
          {short > 0 && <span data-short style={{ fontSize: 12, fontWeight: 700, color: amberInk, background: amberSoft, borderRadius: 999, padding: '5px 9px' }}>{short} short</span>}
          {over > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#0b4f45', background: tealSoft, borderRadius: 999, padding: '5px 9px' }}>{over} over</span>}
        </div>
        <div role="tablist" aria-label="How to count" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4, background: ground, borderRadius: 12, padding: 4 }}>
          {TABS.map(t => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              style={{ font: `600 13px ${font}`, minHeight: 40, border: 0, borderRadius: 9, background: tab === t ? navy : 'transparent', color: tab === t ? '#fff' : ink, cursor: 'pointer' }}>{t}</button>
          ))}
        </div>
      </header>

      {tab === 'Photo' ? (
        <section aria-label="Photo check" style={{ padding: '12px 14px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <Photo cells={REF} caption="Fully stocked (taught 3 Nov)" />
            <Photo cells={NOW} caption="Your photo, 10:21" />
          </div>
          <div style={{ fontSize: 13, background: amberSoft, color: amberInk, borderRadius: 12, padding: '10px 12px', lineHeight: 1.4 }}>
            <strong>The photo shows 3 empty slots:</strong> 6.5 × 45 (slot 14), 7.5 × 50 (two in slot 22). Check them and confirm.
          </div>
        </section>
      ) : (
        <div style={{ margin: '12px 14px 0', fontSize: 13, background: '#fff', border: `1px solid ${line}`, borderRadius: 12, padding: '10px 12px', color: muted }}>
          {tab === 'Voice' && 'Say the size then the number — “seven five fifty, two”.'}
          {tab === 'Tap' && 'Use − and + on each line below.'}
          {tab === 'Scan' && 'Scan each sticker or box barcode as you count it.'}
          {' '}(Preview — counting by {tab.toLowerCase()} is not built yet.)
        </div>
      )}

      <section aria-label="Lines" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {LINES.map((l, i) => {
          const c = counts[i]
          const state = c === null ? 'open' : c < l.expected ? 'short' : c > l.expected ? 'over' : 'ok'
          const diff = c === null ? '' : c - l.expected
          return (
            <div key={l.slot} data-count-line={l.slot} style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 14, padding: '10px 10px 10px 12px', background: '#fff', border: { short: '1.5px solid #f2c48d', ok: `1px solid ${line}`, over: `1.5px solid ${teal}`, open: `1.5px solid ${teal}` }[state] }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, background: state === 'short' ? amberSoft : '#f1f3f5', color: state === 'short' ? amberInk : muted }}>{l.slot}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{l.name}</div>
                <div style={{ fontSize: 12, color: muted }}>
                  {l.code} · expected {l.expected}
                  {diff !== '' && diff !== 0 && <strong style={{ color: diff < 0 ? '#b42318' : '#0f7a69' }}> · {diff > 0 ? '+' : '−'}{Math.abs(diff)}</strong>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button type="button" aria-label="One less" onClick={() => change(i, -1)} style={stepper}>−</button>
                <span data-qty style={{ width: 34, textAlign: 'center', fontSize: 20, fontWeight: 700, color: state === 'short' ? '#9a3412' : state === 'open' ? restockGrey : ink }}>{c === null ? '–' : c}</span>
                <button type="button" aria-label="One more" onClick={() => change(i, 1)} style={stepper}>+</button>
              </div>
            </div>
          )
        })}
      </section>

      <footer style={{ background: '#fff', borderTop: `1px solid ${line}`, padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: tealSoft, borderRadius: 12, padding: '9px 12px' }}>
          <span style={{ width: 34, height: 34, borderRadius: '50%', background: teal, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
          </span>
          <div style={{ fontSize: 13, lineHeight: 1.35 }}><span style={{ color: '#0b4f45', fontWeight: 600 }}>Heard:</span> “seven five fifty, two … six five forty-five, three”</div>
        </div>
        {msg && <div style={{ fontSize: 12, color: amberInk, background: amberSoft, borderRadius: 10, padding: '8px 10px' }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={rest} onClick={() => { setRest(true); setMsg('') }}
            style={{ flex: 1, minHeight: 50, font: `600 14px ${font}`, borderRadius: 14, border: '1px solid #d5dde5', background: '#fff', color: rest ? muted : ink, cursor: rest ? 'default' : 'pointer' }}>
            {rest ? `✓ Rest as expected (${REST_AS_EXPECTED})` : `Rest as expected (${REST_AS_EXPECTED})`}
          </button>
          <button type="button" onClick={() => go('review')}
            style={{ flex: 1, minHeight: 50, font: `600 14px ${font}`, borderRadius: 14, border: 0, background: teal, color: '#fff', cursor: 'pointer' }}>Done · next tray</button>
        </div>
        <button type="button" onClick={() => setMsg(notBuilt('Retaking the tray photo'))} style={{ alignSelf: 'center', minHeight: 40, border: 0, background: 'none', font: `600 13px ${font}`, color: muted, cursor: 'pointer' }}>Retake the photo</button>
      </footer>
    </div>
  )
}
