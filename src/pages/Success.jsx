import React from 'react'
import { colour as tokenColour } from '../design/tokens.js'

// ─── After the application has gone ──────────────────────────────────────────
// This screen had one button on it, reading "Submit another application", and
// it went to the Cases tab. So the only way out said it would do something it
// did not do, and the thing it actually did — getting back to the portal — was
// not offered at all.
//
// It was also rendered above the app shell, which took the bottom navigation
// off the screen with it. Somebody who had just filed a week's leave was left
// on a page with one mislabelled button and no tabs. That part is fixed where
// it was caused, in App.jsx; this screen now says plainly what each way out
// does, and leads with the one almost everybody wants.

const NAVY = tokenColour.navy
const TEAL = tokenColour.accent
const MUTED = tokenColour.inkFaint
const BORDER = tokenColour.line

export default function Success({ form, onDone, onAnother }) {
  return (
    <div style={{
      minHeight: '100%', display: 'flex', flexDirection: 'column',
      background: tokenColour.canvas
    }}>
      <div className="tm-bleed" style={{ background: NAVY, padding: '44px 20px 32px' }}>
        <div className="tm-measure" style={{ textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: 'rgba(42,181,160,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: 25, color: TEAL
          }}>✓</div>
          <h1 style={{ color: 'white', fontSize: 19, fontWeight: 700, margin: '0 0 10px' }}>
            Application sent
          </h1>
          <p style={{
            color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 1.7,
            maxWidth: 340, margin: '0 auto'
          }}>
            It has gone to management for approval. You will get an email once
            it has been looked at.
          </p>
        </div>
      </div>

      <div className="tm-measure" style={{ padding: '20px 16px 24px', flex: 1 }}>
        <div style={{
          background: 'white', borderRadius: 12, padding: '16px 18px',
          border: `1px solid ${BORDER}`, marginBottom: 12,
          display: 'flex', gap: 14, alignItems: 'flex-start'
        }}>
          <span style={{ fontSize: 25 }} aria-hidden="true">📧</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: NAVY, marginBottom: 3 }}>
              Management notified
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
              Erin and Brenton have your application and will review it shortly.
            </div>
          </div>
        </div>

        <div style={{
          background: 'rgba(42,181,160,0.07)', border: '1px solid rgba(42,181,160,0.2)',
          borderRadius: 12, padding: '14px 16px', marginBottom: 20,
          fontSize: 12.5, color: MUTED, lineHeight: 1.6
        }}>
          💡 Once approved it goes onto the TechnoMed calendar and into Xero on
          its own.
        </div>

        {/* Leading with the way out, because that is what almost everybody
            wants next. Both say what they do. */}
        <button onClick={onDone}
          style={{
            width: '100%', padding: 15, borderRadius: 10, border: 'none',
            background: TEAL, color: 'white', fontSize: 16, fontWeight: 700,
            cursor: 'pointer', marginBottom: 10
          }}>
          Done
        </button>
        <button onClick={onAnother}
          style={{
            width: '100%', padding: 14, borderRadius: 10,
            border: `1px solid ${BORDER}`, background: 'transparent',
            color: MUTED, fontSize: 14, fontWeight: 600, cursor: 'pointer'
          }}>
          Apply for more leave
        </button>
      </div>
    </div>
  )
}
