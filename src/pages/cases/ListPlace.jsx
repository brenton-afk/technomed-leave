import React, { useState } from 'react'
import { Overlay, SectionLabel, Button, Banner } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { SESSIONS, ordinal, cleanListPlace } from '../../clinicalPlan/listPlace.js'

// ─── Recording what the hospital said ────────────────────────────────────────
// Filled in once a day, in the twenty minutes after the hospital rings, for
// every case on tomorrow's lists. So it opens on the thing most often being
// set — the number — and everything on it can be tapped rather than typed.
//
// Nothing here is required. A list order arrives in pieces: often the session
// first ("Mr Dubey is on the afternoon list") and the number later. Half of it
// is worth recording on its own, and a form that insists on the rest would get
// the whole thing left blank.

const PLACES = [1, 2, 3, 4, 5, 6]

const FIELD = {
  width: '100%', minHeight: 44, boxSizing: 'border-box',
  padding: `0 ${space.md}px`, borderRadius: radius.control,
  border: `1px solid ${colour.line}`, ...text('field'),
  color: colour.ink, background: colour.surface
}

function Choice({ label, chosen, onClick, wide }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={chosen}
      style={{
        // 44px minimum: this gets tapped on a phone, standing in a car park,
        // reading a running order off a screen.
        minWidth: wide ? 0 : 44, minHeight: 44, flex: wide ? 1 : '0 0 auto',
        padding: `0 ${space.md}px`, borderRadius: radius.control, cursor: 'pointer',
        border: `1px solid ${chosen ? colour.accent : colour.line}`,
        background: chosen ? colour.accent : colour.surface,
        color: chosen ? 'white' : colour.ink,
        ...text('bodyStrong')
      }}>
      {label}
    </button>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: space.lg }}>
      <SectionLabel>{label}</SectionLabel>
      {hint && (
        <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.xs }}>
          {hint}
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * The sheet that records where a case sits on the hospital's list.
 *
 * @param {object} surgicalCase  the booking, for its current place and its name
 * @param {(place: object|null) => Promise<void>} onSave  null clears it
 */
export default function ListPlace({ surgicalCase, onSave, onClose }) {
  const existing = surgicalCase?.listPlace || {}
  const [position, setPosition] = useState(existing.position || null)
  const [session, setSession] = useState(existing.session || null)
  const [from, setFrom] = useState(existing.from || '')
  const [ahead, setAhead] = useState(existing.ahead || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const place = cleanListPlace({ position, session, from, ahead })

  async function save(next) {
    setSaving(true)
    setError('')
    try {
      await onSave(next)
      onClose()
    } catch (err) {
      setError(err.message || 'That did not save')
      setSaving(false)
    }
  }

  return (
    <Overlay>
      {/* Overlay is only a portal — it puts this at the end of document.body and
          positions nothing. Every sheet supplies its own backdrop, and this one
          did not: it rendered below #root, which is exactly the height of the
          viewport, so it opened off-screen and the button looked dead. jsdom has
          no layout, so every test passed. */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
      }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="List order"
          className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 460,
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
            display: 'flex', flexDirection: 'column'
          }}>

          <div style={{
            padding: `${space.md}px ${space.md}px ${space.sm}px`,
            borderBottom: `1px solid ${colour.line}`, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: space.sm
          }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ ...text('heading'), color: colour.ink, display: 'block' }}>
                List order
              </span>
              <span style={{ ...text('caption'), color: colour.inkFaint }}>
                {surgicalCase?.patient} · {surgicalCase?.surgeon}
                {surgicalCase?.hospital ? ` · ${surgicalCase.hospital}` : ''}
              </span>
            </span>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'none', border: 'none', cursor: 'pointer',
              ...text('body'), color: colour.inkFaint
            }}>Close</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {error && <Banner tone="danger">{error}</Banner>}

            <Field
              label="Which number are we"
              hint="Counting every case on the list, including the ones we are not at.">
              <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap' }}>
                {PLACES.map(n => (
                  <Choice key={n} label={ordinal(n)} chosen={position === n}
                    // Tapping the chosen one again clears it, which is the only
                    // way back to "nobody has told us" without closing.
                    onClick={() => setPosition(position === n ? null : n)} />
                ))}
              </div>
            </Field>

            <Field label="Which list"
              hint="A morning list starts about 08:00, an afternoon one about 13:00.">
              <div style={{ display: 'flex', gap: space.sm }}>
                {SESSIONS.map(s => (
                  <Choice key={s.id} wide label={s.label} chosen={session === s.id}
                    onClick={() => setSession(session === s.id ? null : s.id)} />
                ))}
              </div>
            </Field>

            <Field label="Wanted from"
              hint="Only if the hospital gave a time. Leave it blank otherwise.">
              <input
                value={from}
                onChange={e => setFrom(e.target.value)}
                placeholder="1pm"
                aria-label="Wanted from"
                style={FIELD} />
            </Field>

            <Field
              label="What is ahead of us"
              hint="Why we are not on first — the thing somebody would otherwise ring to ask.">
              <input
                value={ahead}
                onChange={e => setAhead(e.target.value)}
                placeholder="After a PLIF — KT Medical, not ours"
                aria-label="What is ahead of us"
                style={FIELD} />
            </Field>

            <Button onClick={() => save(place)} disabled={saving}>
              {saving ? 'Saving…' : 'Save list order'}
            </Button>

            {surgicalCase?.listPlace && (
              <div style={{ marginTop: space.sm }}>
                <Button variant="secondary" onClick={() => save(null)} disabled={saving}>
                  Clear it
                </Button>
              </div>
            )}

            <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: space.md }}>
              This goes on the booking itself, so it reads the same in Google
              Calendar as it does here.
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
