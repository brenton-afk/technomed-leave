import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { useBackLayer } from '../../backButton.js'
import { PLACES, useCasesAt, label, field, primary, secondary, CasePick, EmailPreview, CourierStep } from './moveParts.jsx'

// ─── Moving a kit ────────────────────────────────────────────────────────────
// Two steps, and the second is the safeguard: where it is going and what is
// in it, then the exact email the hospital will get — editable, with Send,
// Move without emailing, or Back. "We don't want inaccurate comms going to
// either team." Nothing is moved until the second step is confirmed.

export default function MoveSheet({ kit, user, emailsOn, today, post, onClose, onDone, onMoved, couriers = [], initialTo = '', initialTrays = null }) {
  // After the move: who to ring to collect it (Brent, 20 Nov 2026).
  const [moved, setMoved] = useState(null)
  const [called, setCalled] = useState('')
  useBackLayer(true, onClose) // the phone's back button closes it (src/backButton.js)
  // A tile dragged onto a place arrives with that place already chosen.
  const [to, setTo] = useState(initialTo && initialTo !== kit.at ? initialTo : (kit.at === kit.home ? '' : kit.home))
  // One tray when it was moved from its own Move button; else every tray.
  const [trays, setTrays] = useState(initialTrays?.length ? (kit.trays || []).filter(t => initialTrays.includes(t)) : (kit.trays || []))
  const [date, setDate] = useState(today || '')
  const [caseChoice, setCaseChoice] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isReturn = to && to === kit.home

  const cases = useCasesAt(to, today, user?.token, isReturn)

  const chosenCase = (cases || []).find(c => c.id === caseChoice)

  async function next() {
    setBusy(true); setError('')
    try {
      const result = await post('move', {
        kitId: kit.id, to, trays, date, note,
        caseDate: chosenCase?.date || '', surname: chosenCase?.surname || '', surgeon: chosenCase?.surgeon || ''
      })
      setPreview(result); setBody(result.email?.text || '')
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function confirm(send) {
    setBusy(true); setError('')
    try {
      const result = await post('confirm', { id: preview.id, send, text: body })
      // A return home, or a move to the office, may still need a courier; the
      // step is offered for every move and "No courier needed" closes it.
      setMoved({ emailed: Boolean(result?.emailed), to: preview.to, from: preview.from, trays: preview.trays || [], date: preview.date })
      setBusy(false)
      onMoved?.()
    } catch (err) { setError(err.message); setBusy(false) }
  }

  function callCourier(c) {
    setCalled(c.id)
    // Logged on the movement history; a failure to log never stops the call.
    post('courier-called', { kitId: kit.id, courierId: c.id }).catch(() => {})
  }


  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label={`Move ${kit.name}`} className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 520, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...text('heading'), color: colour.ink }}>{moved ? 'Book a courier' : preview ? 'Check before it goes' : `Move ${kit.name}`}</div>
              {!moved && <div style={{ ...text('caption'), color: colour.inkFaint }}>Now at {PLACES[kit.at]} · home {PLACES[kit.home]}</div>}
            </div>
            <button onClick={moved ? onDone : onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>{moved ? 'Close' : 'Cancel'}</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}

            {!moved && !preview && (
              <>
                <div style={{ ...label, marginTop: 0 }}>Going to</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: space.sm }}>
                  {Object.keys(PLACES).map(p => {
                    const here = p === kit.at
                    const on = to === p
                    return (
                      <button key={p} disabled={here} onClick={() => setTo(p)} aria-pressed={on}
                        style={{
                          padding: `${space.md}px ${space.sm}px`, borderRadius: radius.control, cursor: here ? 'default' : 'pointer',
                          border: on ? `2px solid ${colour.accent}` : border.hairline, background: on ? colour.accentSoft : colour.surface,
                          opacity: here ? 0.45 : 1, ...text('bodyStrong'), color: colour.ink
                        }}>
                        {PLACES[p]}
                        <div style={{ ...text('caption'), color: colour.inkFaint }}>{here ? 'here now' : p === kit.home ? 'return home' : ''}</div>
                      </button>
                    )
                  })}
                </div>

                {isReturn && (
                  <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.sm }}>
                    A return: the kit goes back to {PLACES[kit.home]} and nobody is emailed.
                  </div>
                )}

                {to && !isReturn && (kit.trays || []).length > 0 && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm }}>
                      <div style={{ ...label, flex: 1 }}>Trays going · {trays.length} of {kit.trays.length}</div>
                      {/* "Select all, entire kit … a Dakota kit transfer from RHH to
                          Calvary would need to transfer all trays in one go" (Brent, 20 Nov 2026). */}
                      <button type="button" data-entire-kit onClick={() => setTrays(trays.length === kit.trays.length ? [] : [...kit.trays])}
                        style={{ ...text('caption'), fontWeight: 600, padding: '5px 10px', borderRadius: radius.pill, cursor: 'pointer', whiteSpace: 'nowrap',
                          border: `1px solid ${colour.accent}`, background: trays.length === kit.trays.length ? colour.accent : colour.surface,
                          color: trays.length === kit.trays.length ? 'white' : colour.accentDeep }}>
                        {trays.length === kit.trays.length ? '✓ Entire kit' : 'Entire kit'}
                      </button>
                    </div>
                    <div style={{ background: colour.surface, border: border.hairline, borderRadius: radius.control }}>
                      {kit.trays.map((t, i) => (
                        <label key={t} style={{ display: 'flex', gap: space.sm, alignItems: 'center', padding: `${space.sm}px ${space.md}px`, borderTop: i ? border.hairlineSoft : 'none', ...text('body'), color: colour.ink }}>
                          <input type="checkbox" checked={trays.includes(t)} style={{ width: 18, height: 18, fontSize: 16 }}
                            onChange={e => setTrays(e.target.checked ? kit.trays.filter(x => x === t || trays.includes(x)) : trays.filter(x => x !== t))} />
                          {t}
                        </label>
                      ))}
                    </div>
                  </>
                )}

                {to && !isReturn && (
                  <>
                    <div style={label}>When</div>
                    <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} style={{ ...field, fontSize: 16 }} aria-label="Date of the move" />

                    {(to === 'CLV' || to === 'RHH') && <CasePick to={to} cases={cases} value={caseChoice} onChange={setCaseChoice} />}

                    <div style={label}>Note (optional)</div>
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                      placeholder="e.g. Going by Jet courier, double bagged" style={{ ...field, fontSize: 16, resize: 'vertical', fontFamily: 'inherit' }} />
                  </>
                )}
              </>
            )}

            {moved && <CourierStep name={kit.name} moved={moved} couriers={couriers} called={called} onCall={callCourier} />}

            {!moved && preview && !preview.email && (
              <div style={{ ...text('body'), color: colour.ink }}>
                {preview.isReturn
                  ? `${kit.name} goes back to ${PLACES[kit.home]}. Nobody is emailed for a return.`
                  : `${kit.name} moves to ${PLACES[preview.to]}. Nobody outside TechnoMed is emailed for this move.`}
              </div>
            )}

            {!moved && preview?.email && (
              <>
                {!emailsOn && (
                  <div style={{ ...text('caption'), background: colour.warningSoft, color: colour.warning, border: `1px solid ${colour.warningLine}`, borderRadius: radius.control, padding: space.sm, marginBottom: space.md }}>
                    Hospital emails are off, so this will <strong>not</strong> be sent. It is what would go once they are turned on —
                    check it reads right.
                  </div>
                )}
                <EmailPreview email={preview.email} body={body} onBody={setBody} />
              </>
            )}
          </div>

          <div style={{ padding: space.md, borderTop: border.hairline, display: 'grid', gap: space.sm }}>
            {moved && (
              <button onClick={onDone} style={primary(false)} data-courier-done>{called ? 'Done' : 'No courier needed'}</button>
            )}
            {!moved && !preview && (
              <button disabled={!to || busy || ((kit.trays || []).length > 0 && !isReturn && !trays.length)} onClick={next} style={primary(!to || busy)}>
                {busy ? 'Working…' : isReturn ? 'Next' : 'Next: check the email'}
              </button>
            )}
            {!moved && preview && preview.email && emailsOn && (
              <button disabled={busy} onClick={() => confirm(true)} style={primary(busy)}>{busy ? 'Sending…' : 'Send email and move'}</button>
            )}
            {!moved && preview && (
              <button disabled={busy} onClick={() => confirm(false)} style={preview.email && emailsOn ? secondary : primary(busy)}>
                {preview.isReturn ? 'Mark returned' : preview.email ? 'Move without emailing' : 'Move'}
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
