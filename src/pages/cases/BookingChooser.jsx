import React from 'react'
import { useBackLayer } from '../../backButton.js'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'

// ─── + Booking: how to add it (Brent, 25 Nov 2026) ──────────────────────────
// "The booking button should open and give you the option to add by writing
// it in, speaking it OR checking the inbox."

const OPTIONS = [
  { id: 'type', title: 'Type it in', detail: 'The booking form — or paste a message into it' },
  { id: 'speak', title: 'Say it', detail: 'Speak the booking; the form fills itself for you to check' },
  { id: 'inbox', title: 'Check the inbox', detail: 'Bookings read from bookings@, waiting to be accepted' }
]

export default function BookingChooser({ when, queueCount = 0, onPick, onClose }) {
  useBackLayer(true, onClose)
  return (
    <Overlay>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 2900, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Add a booking" data-booking-chooser className="tm-sheet"
          style={{ background: colour.canvas, width: '100%', maxWidth: 480, boxSizing: 'border-box', borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, padding: space.lg, display: 'grid', gap: space.sm }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: space.xs }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...text('title'), color: colour.ink }}>Add a booking</div>
              {when && <div style={{ ...text('caption'), color: colour.inkFaint }}>{when}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ width: 40, height: 40, borderRadius: 20, border: 'none', background: colour.surface, cursor: 'pointer', ...text('heading'), color: colour.ink }}>✕</button>
          </div>
          {OPTIONS.map(o => (
            <button key={o.id} type="button" data-add-via={o.id} onClick={() => onPick(o.id)}
              style={{ textAlign: 'left', background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: `${space.md}px ${space.lg}px`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: space.md, minHeight: 64 }}>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', ...text('heading'), color: colour.ink }}>{o.title}</span>
                <span style={{ display: 'block', ...text('caption'), color: colour.inkFaint }}>{o.detail}</span>
              </span>
              {o.id === 'inbox' && queueCount > 0 && (
                <span style={{ minWidth: 26, height: 26, borderRadius: 13, padding: '0 8px', boxSizing: 'border-box', background: colour.warning, color: 'white', ...text('bodyStrong'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{queueCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </Overlay>
  )
}
