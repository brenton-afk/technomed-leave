import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'
import { PLACES, useCasesAt, label, field, primary, secondary, CasePick, EmailPreview, CourierStep } from './moveParts.jsx'

// ─── Move something else (Brent, 23 Nov 2026) ────────────────────────────────
// "An entry portal page a bit like the add booking page for kit transfers that
// aren't part of our day to day kit ... when we get asked to transfer the
// Brainlab trays on behalf of the hospital ... still be able to email the
// respective loans departments and book couriers." Typed in, not chosen from
// the kit room: what it is, whose, from and to, the trays if they want them
// named. Then the same safeguard as a kit move — the exact email, editable —
// and the courier buttons. Nothing is kept on a kit; the move goes on the
// movement history. api/_kits.js prepareOtherMove / confirmOtherMove.

const OWNERS = ['RHH', 'Calvary', 'Brainlab']

export default function OtherMoveSheet({ user, today, post, couriers = [], onClose, onDone }) {
  useBackLayer(true, onClose)
  const [item, setItem] = useState('')
  const [owner, setOwner] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [trays, setTrays] = useState('')
  const [date, setDate] = useState(today || '')
  const [caseChoice, setCaseChoice] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)
  const [body, setBody] = useState('')
  const [moved, setMoved] = useState(null)
  const [called, setCalled] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const cases = useCasesAt(to, today, user?.token)
  const chosenCase = (cases || []).find(c => c.id === caseChoice)
  const ready = item.trim() && from && to && from !== to

  async function next() {
    setBusy(true); setError('')
    try {
      const result = await post('move-other', {
        item, owner, from, to, trays, date, note,
        caseDate: chosenCase?.date || '', surname: chosenCase?.surname || '', surgeon: chosenCase?.surgeon || ''
      })
      setPreview(result); setBody(result.email?.text || '')
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function confirm(send) {
    setBusy(true); setError('')
    try {
      const result = await post('confirm-other', { id: preview.id, send, text: body })
      setMoved({ emailed: Boolean(result?.emailed), to: preview.to, from: preview.from, trays: preview.trays || [] })
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  function callCourier(c) {
    setCalled(c.id)
    post('courier-called', { itemName: preview.item, courierId: c.id }).catch(() => {})
  }

  const placeRow = (value, set, other, name) => (
    <div role="group" aria-label={name} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: space.sm }}>
      {Object.keys(PLACES).map(p => {
        const on = value === p
        const off = p === other
        return (
          <button key={p} type="button" disabled={off} onClick={() => set(p)} aria-pressed={on} data-place={`${name}-${p}`}
            style={{
              padding: `${space.md}px ${space.sm}px`, borderRadius: radius.control, cursor: off ? 'default' : 'pointer',
              border: on ? `2px solid ${colour.accent}` : border.hairline, background: on ? colour.accentSoft : colour.surface,
              opacity: off ? 0.45 : 1, ...text('bodyStrong'), color: colour.ink
            }}>
            {PLACES[p]}
          </button>
        )
      })}
    </div>
  )

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label="Move something else" data-other-move className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 520, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...text('heading'), color: colour.ink }}>{moved ? 'Book a courier' : preview ? 'Check before it goes' : 'Move something else'}</div>
              {!moved && !preview && <div style={{ ...text('caption'), color: colour.inkFaint }}>Trays that are not in the kit room — a hospital's Brainlab trays, a kit not added yet</div>}
            </div>
            <button onClick={moved ? onDone : onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>{moved ? 'Close' : 'Cancel'}</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}

            {!moved && !preview && (
              <>
                <div style={{ ...label, marginTop: 0 }}>What is moving</div>
                <input value={item} onChange={e => setItem(e.target.value)} maxLength={80} data-other-item
                  placeholder="e.g. Brainlab cranial navigation trays" aria-label="What is moving" style={{ ...field, fontSize: 16 }} />

                <div style={label}>Whose is it</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm }}>
                  {OWNERS.map(o => (
                    <button key={o} type="button" aria-pressed={owner === o} onClick={() => setOwner(owner === o ? '' : o)}
                      style={{ ...text('caption'), fontWeight: 600, padding: '7px 12px', borderRadius: radius.pill, cursor: 'pointer',
                        border: `1px solid ${owner === o ? colour.accent : colour.line}`, background: owner === o ? colour.accent : colour.surface,
                        color: owner === o ? 'white' : colour.ink }}>{o}</button>
                  ))}
                </div>
                <input value={OWNERS.includes(owner) ? '' : owner} onChange={e => setOwner(e.target.value)} maxLength={60}
                  placeholder="Or type it (optional)" aria-label="Whose is it" style={{ ...field, fontSize: 16 }} />

                <div style={label}>Coming from</div>
                {placeRow(from, setFrom, to, 'from')}
                <div style={label}>Going to</div>
                {placeRow(to, setTo, from, 'to')}

                <div style={label}>Trays (optional, one a line)</div>
                <textarea value={trays} onChange={e => setTrays(e.target.value)} rows={3} data-other-trays
                  placeholder={'e.g. Cranial instruments\nReference arrays'} style={{ ...field, fontSize: 16, resize: 'vertical', fontFamily: 'inherit' }} />

                <div style={label}>When</div>
                <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} style={{ ...field, fontSize: 16 }} aria-label="Date of the move" />

                {(to === 'CLV' || to === 'RHH') && <CasePick to={to} cases={cases} value={caseChoice} onChange={setCaseChoice} />}

                <div style={label}>Note (optional)</div>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                  placeholder="e.g. Asked for by RHH theatres, going by Jet courier" style={{ ...field, fontSize: 16, resize: 'vertical', fontFamily: 'inherit' }} />
              </>
            )}

            {moved && <CourierStep name={preview.item} moved={moved} couriers={couriers} called={called} onCall={callCourier} />}

            {!moved && preview && !preview.email && (
              <div style={{ ...text('body'), color: colour.ink }}>
                Nobody at a hospital is emailed for this move — no loans contact is set for either end (Admin → Supplier notices).
              </div>
            )}
            {!moved && preview?.email && <EmailPreview email={preview.email} body={body} onBody={setBody} />}
          </div>

          <div style={{ padding: space.md, borderTop: border.hairline, display: 'grid', gap: space.sm }}>
            {moved && <button onClick={onDone} style={primary(false)} data-courier-done>{called ? 'Done' : 'No courier needed'}</button>}
            {!moved && !preview && (
              <button disabled={!ready || busy} onClick={next} style={primary(!ready || busy)} data-other-next>{busy ? 'Working…' : 'Next: check the email'}</button>
            )}
            {!moved && preview?.email && (
              <button disabled={busy} onClick={() => confirm(true)} style={primary(busy)} data-other-send>{busy ? 'Sending…' : 'Send email and move'}</button>
            )}
            {!moved && preview && (
              <button disabled={busy} onClick={() => confirm(false)} style={preview.email ? secondary : primary(busy)}>
                {preview.email ? 'Move without emailing' : 'Move'}
              </button>
            )}
            {!moved && preview && (
              <button disabled={busy} onClick={() => setPreview(null)} style={{ ...secondary, border: 'none', background: 'none' }}>Back</button>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
