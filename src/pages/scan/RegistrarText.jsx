import React, { useMemo, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { registrarDraft, registrarMessage, levelsFrom, smsLink } from '../../usageText.js'
import { systemsInKit } from '../../clinicalPlan/systems.js'
import { inventoryFor } from '../../clinicalPlan/inventory.js'

// ─── The text for the registrar ──────────────────────────────────────────────
// Brent, 4 Nov 2026: "really basic … Pt, system name, screws used (the portal
// should automatically give the rep a list of the levels based on the booking
// … then the rep can add 6.5 x 45mm etc to each level), then the rod length
// used, then if a cross connector was used and if bone graft was used. Also
// include cages (just the sizes)."
//
// A small form that writes the text as it is filled in. Levels come from the
// booking's procedure and can be corrected in the Levels box; a level side left
// blank is left out. Still a draft, never a send: the phone's own messaging app
// opens with it, and the rep chooses who it goes to.

export default function RegistrarText({ caseRecord, booking }) {
  const start = useMemo(
    () => registrarDraft(caseRecord, caseRecord?.items || [], booking, { systemsInKit, inventoryFor }),
    [caseRecord, booking])
  const [d, setD] = useState(start)
  const [levelText, setLevelText] = useState(booking?.procedure || caseRecord?.procedure || '')
  const [copied, setCopied] = useState(false)
  const set = (key, value) => { setCopied(false); setD(c => ({ ...c, [key]: value })) }
  const levels = levelsFrom(levelText)
  const message = registrarMessage({ ...d, levels })

  const input = {
    width: '100%', boxSizing: 'border-box', minWidth: 0, minHeight: 40, padding: `6px ${space.sm}px`,
    border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface,
    ...text('field'), color: colour.ink
  }
  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, display: 'block', marginBottom: 3 }
  const field = (key, name, placeholder) => (
    <label style={{ display: 'block', marginBottom: space.sm }}>
      <span style={label}>{name}</span>
      <input value={d[key] || ''} placeholder={placeholder} onChange={e => set(key, e.target.value)} style={input} />
    </label>
  )

  return (
    <div style={{ background: colour.surface, borderRadius: radius.card, padding: space.md, marginBottom: space.md, border: `1px solid ${colour.line}` }}>
      <div style={{ ...label, marginBottom: space.sm }}>Send to the registrar</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: space.sm }}>
        {field('patient', 'Patient')}
        {field('consultant', 'Consultant', 'e.g. Mr Fowler')}
      </div>
      {field('system', 'System', 'e.g. Signus Diplomat')}

      <label style={{ display: 'block', marginBottom: space.sm }}>
        <span style={label}>Levels</span>
        <input value={levelText} placeholder="e.g. T12-L2" onChange={e => { setCopied(false); setLevelText(e.target.value) }} style={input} />
      </label>
      {levels.length > 0 && (
        <div style={{ marginBottom: space.sm }}>
          <span style={label}>Screws — leave a side blank if none</span>
          {levels.map(level => (
            <div key={level} style={{ display: 'grid', gridTemplateColumns: '36px repeat(2, minmax(0, 1fr))', gap: space.xs, alignItems: 'center', marginBottom: space.xs }}>
              <span style={{ ...text('bodyStrong'), color: colour.ink }}>{level}</span>
              {['Left', 'Right'].map(side => (
                <input key={side} aria-label={`${level} ${side}`} placeholder={side}
                  value={d.screws?.[`${level} ${side}`] || ''}
                  onChange={e => set('screws', { ...d.screws, [`${level} ${side}`]: e.target.value })}
                  style={input} />
              ))}
            </div>
          ))}
        </div>
      )}

      {field('rods', 'Rods', 'e.g. 150mm straight Ti')}
      <label style={{ display: 'flex', alignItems: 'center', gap: space.sm, minHeight: 40, marginBottom: space.sm, ...text('body'), color: colour.ink }}>
        <input type="checkbox" checked={Boolean(d.crossConnector)} onChange={e => set('crossConnector', e.target.checked)}
          style={{ width: 20, height: 20, fontSize: 16 }} />
        Cross connector used
      </label>
      {field('graft', 'Bone graft', 'e.g. Boost DBM Allograft')}
      {field('cages', 'Cages', 'Sizes only, e.g. 10 x 26mm')}

      <pre style={{
        margin: `${space.xs}px 0 ${space.sm}px`, padding: space.sm, background: colour.canvas, borderRadius: radius.control,
        ...text('caption'), color: colour.ink, whiteSpace: 'pre-wrap', fontFamily: 'inherit'
      }}>{message}</pre>
      <div style={{ display: 'flex', gap: space.sm }}>
        <a href={smsLink(message)} style={{
          flex: 1, textAlign: 'center', padding: `${space.sm}px 0`, borderRadius: radius.control,
          background: colour.accent, color: 'white', ...text('bodyStrong'), textDecoration: 'none'
        }}>Text it</a>
        <button type="button" onClick={() => navigator.clipboard?.writeText(message).then(() => setCopied(true), () => setCopied(false))}
          style={{
            flex: 1, padding: `${space.sm}px 0`, borderRadius: radius.control, cursor: 'pointer',
            border: `1px solid ${colour.line}`, background: 'transparent', ...text('bodyStrong'), color: colour.ink
          }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  )
}
