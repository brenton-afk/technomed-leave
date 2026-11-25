// ─── Tidy all labels: see every label before and after (Brent, 25 Nov 2026) ─
// The house style from tidy.js, shown label by label beside the label as it
// is now. Labels with something to check come first. Nothing is saved until
// "Tidy N labels"; each is saved with the label it was made against (a 409
// leaves that one alone), and the label as it was is kept so a card's
// "Put back" restores it.

import React, { useMemo, useState } from 'react'
import { useBackLayer } from '../backButton.js'
import { colour, text, space, radius, face, border } from '../design/tokens.js'
import LabelSvg from './LabelSvg.jsx'
import { tidyLabel } from './tidy.js'
import { saveLabel } from './api.js'

const btn = { ...text('caption'), fontWeight: 600, padding: '9px 14px', borderRadius: radius.control, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap' }

export default function TidySheet({ user, labels, logos, onSaved, onClose }) {
  const plans = useMemo(() => labels
    .map(l => ({ before: l, ...tidyLabel(l, logos) }))
    .filter(p => p.changed)
    .sort((a, b) => (b.warnings.length - a.warnings.length) || a.before.name.localeCompare(b.before.name, 'en', { numeric: true })),
  [labels, logos])
  const [skip, setSkip] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  useBackLayer(true, () => { if (!busy) onClose() })

  const chosen = plans.filter(p => !skip.has(p.before.id))
  const toggle = id => setSkip(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function apply() {
    setBusy(true)
    const out = { saved: 0, failed: [] }
    for (let i = 0; i < chosen.length; i += 4) {
      await Promise.all(chosen.slice(i, i + 4).map(async p => {
        try {
          const { label } = await saveLabel(user.token, p.before.id, p.label, p.before.version, { tidy: true })
          onSaved(label)
          out.saved++
        } catch (err) {
          out.failed.push(`${p.before.name}: ${err.message}`)
        }
      }))
      setDone({ ...out, progress: Math.min(i + 4, chosen.length) })
    }
    setDone({ ...out, finished: true })
    setBusy(false)
  }

  return (
    <div data-tidy-sheet role="dialog" aria-label="Tidy all labels"
      style={{ position: 'fixed', inset: 0, zIndex: 3300, background: colour.canvas, overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: colour.surface, borderBottom: border.hairline, padding: `${space.md}px ${space.lg}px`, display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ ...text('title'), color: colour.ink }}>Tidy all labels</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            One house style: logos the same size, name in the maker&rsquo;s colour, black text, REF and REBATE in one place, screw size colours, no Device logo. Each label&rsquo;s old version is kept — &ldquo;Put back&rdquo; on its card restores it.
          </div>
        </div>
        {!done?.finished && (
          <button data-tidy-apply disabled={busy || !chosen.length} onClick={apply} style={{ ...btn, ...face.primary, opacity: busy || !chosen.length ? 0.6 : 1 }}>
            {busy ? `Tidying… ${done?.progress || 0} of ${chosen.length}` : `Tidy ${chosen.length} label${chosen.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button onClick={onClose} disabled={busy} style={{ ...btn, ...face.secondary }}>{done?.finished ? 'Done' : 'Cancel'}</button>
      </div>
      <div style={{ padding: space.lg, maxWidth: 1100, margin: '0 auto' }}>
        {done?.finished && (
          <div role="status" data-tidy-done style={{ ...text('body'), color: done.failed.length ? colour.warning : colour.accentDeep, background: done.failed.length ? colour.warningSoft : colour.accentSoft, borderRadius: radius.control, padding: space.md, marginBottom: space.md }}>
            {done.saved} label{done.saved === 1 ? '' : 's'} tidied.
            {done.failed.length > 0 && <> {done.failed.length} not saved — they were changed meanwhile or could not be reached; open Tidy again for them.<br />{done.failed.join(' · ')}</>}
          </div>
        )}
        {!plans.length && <div style={{ ...text('body'), color: colour.inkFaint, textAlign: 'center', padding: space.xl }}>Every label is already in the house style.</div>}
        {plans.length > 0 && !done?.finished && (
          <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.md }}>
            {plans.length} label{plans.length === 1 ? '' : 's'} to tidy{plans.some(p => p.warnings.length) ? ' — those with something to check are first' : ''}. Untick any to leave as it is.
          </div>
        )}
        <div style={{ display: 'grid', gap: space.md }}>
          {plans.map(p => {
            const on = !skip.has(p.before.id)
            return (
              <div key={p.before.id} data-tidy-row={p.before.id} style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md, opacity: on ? 1 : 0.55 }}>
                <label style={{ display: 'flex', gap: space.sm, alignItems: 'center', marginBottom: space.sm, cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} disabled={busy || done?.finished} onChange={() => toggle(p.before.id)} style={{ width: 20, height: 20, fontSize: 16 }} />
                  <span style={{ ...text('bodyStrong'), color: colour.ink }}>{p.before.name}</span>
                </label>
                {p.warnings.length > 0 && (
                  <div data-tidy-warning style={{ ...text('caption'), color: colour.warning, marginBottom: space.sm }}>{p.warnings.join(' · ')}</div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: space.md }}>
                  <div>
                    <div style={{ ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>Now</div>
                    <div style={{ boxShadow: '0 1px 3px rgba(4,39,70,0.18)', borderRadius: 3, overflow: 'hidden' }}><LabelSvg label={p.before} logos={logos} /></div>
                  </div>
                  <div>
                    <div style={{ ...text('micro'), color: colour.accentDeep, textTransform: 'uppercase', marginBottom: 4 }}>Tidied</div>
                    <div style={{ boxShadow: '0 1px 3px rgba(4,39,70,0.18)', borderRadius: 3, overflow: 'hidden' }}><LabelSvg label={p.label} logos={logos} /></div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
