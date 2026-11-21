import React from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'

// ─── Kit room settings (Brent, 21 Nov 2026, option C) ────────────────────────
// "Get rid of the two warnings/alerts at the top of the kit room page. Put
// them somewhere else." The stock-take progress and the hospital-email switch
// live here, behind the ⚙ on the kit room's band, with the courier numbers,
// reset, agreements and the movement history.

export default function KitSettings({ data, kits, busy, onClose, onEmails, onCouriers, onReset, onAgreements, history }) {
  useBackLayer(true, onClose)
  const total = kits.length
  const checked = kits.filter(k => k.checkedAt).length
  const emailsOn = Boolean(data?.settings?.emailsOn)
  const anyAway = kits.some(k => k.away || Object.keys(k.trayAt || {}).length)
  const row = { display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.md}px 0`, borderBottom: border.hairlineSoft }
  const btn = on => ({ ...text('caption'), fontWeight: 600, padding: '8px 12px', borderRadius: radius.pill, cursor: 'pointer', whiteSpace: 'nowrap', ...(on ? face.primary : face.secondary) })

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3150, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label="Kit room settings" className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 520, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column', overflowX: 'hidden'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1, ...text('heading'), color: colour.ink }}>Kit room settings</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ padding: `0 ${space.md}px ${space.md}px`, overflowY: 'auto', overflowX: 'hidden' }}>
            <div style={{ ...row, flexDirection: 'column', alignItems: 'stretch' }} data-stocktake>
              <div style={{ ...text('bodyStrong'), color: colour.ink }}>Stock-take: {checked} of {total} hospital sets checked</div>
              <div style={{ height: 6, background: colour.lineSoft, borderRadius: radius.pill, overflow: 'hidden' }}>
                <div style={{ width: `${(checked / Math.max(total, 1)) * 100}%`, height: '100%', background: colour.accent }} />
              </div>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>
                Open a system and tap <strong>It's here</strong> beside the trays you can see. A tray somewhere else: Move it to where it really is.
              </div>
            </div>
            <div style={{ ...row, flexWrap: 'wrap' }} data-hospital-emails>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...text('bodyStrong'), color: colour.ink }}>Hospital emails {emailsOn ? 'on' : 'off'}</div>
                <div style={{ ...text('caption'), color: colour.inkFaint }}>
                  {emailsOn ? 'Moves into a hospital email its loans team.'
                    : `Moves are recorded and show the email that would go, but nothing is sent${data?.isAdmin ? '. Turn them on once the stock-take is finished.' : ' until Brent or Erin turn them on.'}`}
                </div>
              </div>
              {data?.isAdmin && (emailsOn || checked === total) && (
                <button disabled={busy === 'emails'} onClick={() => onEmails(!emailsOn)} style={btn(!emailsOn)}>
                  {emailsOn ? 'Turn off' : 'Turn on'}
                </button>
              )}
            </div>
            {data?.canRemove && (
              <div style={{ ...row, flexWrap: 'wrap' }}>
                <button onClick={onCouriers} data-courier-numbers style={btn(false)}>Courier numbers</button>
                <button data-reset-all disabled={busy === 'reset' || !anyAway} onClick={onReset} style={btn(false)}>
                  {busy === 'reset' ? 'Resetting…' : 'Reset all trays to home'}
                </button>
                <button onClick={onAgreements} data-attach-agreements style={btn(false)}>Attach agreements from Dropbox</button>
              </div>
            )}
            {history}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
