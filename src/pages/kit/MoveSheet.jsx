import React, { useState, useEffect } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { readBooking, detectHospital, isCancelled } from '../../clinicalPlan/parse.js'
import { parseDateStr, addCivilDays, toDateStr } from '../../clinicalPlan/week.js'

// ─── Moving a kit ────────────────────────────────────────────────────────────
// Two steps, and the second is the safeguard: where it is going and what is
// in it, then the exact email the hospital will get — editable, with Send,
// Move without emailing, or Back. "We don't want inaccurate comms going to
// either team." Nothing is moved until the second step is confirmed.

const PLACES = { office: 'TM office / Warehouse', CLV: 'Calvary', RHH: 'RHH' }

function shortDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
}

export default function MoveSheet({ kit, user, emailsOn, today, post, onClose, onDone, initialTo = '' }) {
  // A tile dragged onto a place arrives with that place already chosen.
  const [to, setTo] = useState(initialTo && initialTo !== kit.at ? initialTo : (kit.at === kit.home ? '' : kit.home))
  const [trays, setTrays] = useState(kit.trays || [])
  const [date, setDate] = useState(today || '')
  const [caseChoice, setCaseChoice] = useState('')
  const [cases, setCases] = useState(null)
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isReturn = to && to === kit.home

  // Cases at the destination over the next fortnight, so the email can say
  // which case it is for without anybody retyping the date or the surname.
  useEffect(() => {
    if (!today || (to !== 'CLV' && to !== 'RHH') || isReturn) { setCases(null); return }
    let live = true
    const end = toDateStr(addCivilDays(parseDateStr(today), 14))
    fetch(`/api/calendar/today?action=week&start=${today}&end=${end}`, {
      headers: { Authorization: `Bearer ${user?.token || ''}` }
    }).then(r => r.json()).then(d => {
      if (!live) return
      const found = (d.events || []).filter(e => e.source === 'bookings' && e.start?.dateTime)
        .map(e => {
          const b = readBooking(e.summary, e.description, { knownPatient: e.knownPatient }) || {}
          const hospital = b.hospital || detectHospital(e.location, e.description, { caseEvent: true })
          return {
            id: e.id, date: String(e.start.dateTime).slice(0, 10), hospital,
            surname: b.patient || '', surgeon: b.surgeon || '', system: b.system || '',
            cancelled: isCancelled(e.summary, e.description)
          }
        })
        .filter(c => c.hospital === to && !c.cancelled && c.date >= today && c.date <= end)
      setCases(found)
    }).catch(() => live && setCases([]))
    return () => { live = false }
  }, [to, today, isReturn, user?.token])

  const chosenCase = (cases || []).find(c => c.id === caseChoice)

  async function next() {
    setBusy(true); setError('')
    try {
      const result = await post('move', {
        kitId: kit.id, to, trays, date, note,
        caseDate: chosenCase?.date || '', surname: chosenCase?.surname || ''
      })
      setPreview(result); setBody(result.email?.text || '')
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  async function confirm(send) {
    setBusy(true); setError('')
    try {
      await post('confirm', { id: preview.id, send, text: body })
      onDone()
    } catch (err) { setError(err.message); setBusy(false) }
  }

  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.lg}px 0 ${space.sm}px` }
  const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', ...text('field'), border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }

  return (
    <Overlay>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div role="dialog" aria-label={`Move ${kit.name}`} className="tm-sheet" style={{
          background: colour.canvas, width: '100%', maxWidth: 520, borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: space.md, borderBottom: border.hairline, display: 'flex', alignItems: 'baseline', gap: space.sm }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...text('heading'), color: colour.ink }}>{preview ? 'Check before it goes' : `Move ${kit.name}`}</div>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>Now at {PLACES[kit.at]} · home {PLACES[kit.home]}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>Cancel</button>
          </div>

          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginBottom: space.sm }}>{error}</div>}

            {!preview && (
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
                    <div style={label}>Trays going · {trays.length} of {kit.trays.length}</div>
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
                    <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} style={field} aria-label="Date of the move" />

                    {(to === 'CLV' || to === 'RHH') && (
                      <>
                        <div style={label}>For which case</div>
                        {cases === null && <div style={{ ...text('caption'), color: colour.inkFaint }}>Finding cases at {PLACES[to]}…</div>}
                        {cases && (
                          <select value={caseChoice} onChange={e => setCaseChoice(e.target.value)} style={field} aria-label="Case this kit is for">
                            <option value="">No particular case</option>
                            {cases.map(c => (
                              <option key={c.id} value={c.id}>
                                {shortDay(c.date)} · {c.surname || 'name to come'}{c.surgeon ? ` · ${c.surgeon}` : ''}{c.system ? ` · ${c.system}` : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        {cases && cases.length === 0 && (
                          <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 4 }}>No cases at {PLACES[to]} in the next two weeks.</div>
                        )}
                      </>
                    )}

                    <div style={label}>Note (optional)</div>
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                      placeholder="e.g. Going by Jet courier, double bagged" style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />
                  </>
                )}
              </>
            )}

            {preview && !preview.email && (
              <div style={{ ...text('body'), color: colour.ink }}>
                {preview.isReturn
                  ? `${kit.name} goes back to ${PLACES[kit.home]}. Nobody is emailed for a return.`
                  : `${kit.name} moves to ${PLACES[preview.to]}. Nobody outside TechnoMed is emailed for this move.`}
              </div>
            )}

            {preview?.email && (
              <>
                {!emailsOn && (
                  <div style={{ ...text('caption'), background: colour.warningSoft, color: colour.warning, border: `1px solid ${colour.warningLine}`, borderRadius: radius.control, padding: space.sm, marginBottom: space.md }}>
                    Hospital emails are off, so this will <strong>not</strong> be sent. It is what would go once they are turned on —
                    check it reads right.
                  </div>
                )}
                <Row label="To">{preview.email.to.join(', ')}</Row>
                <Row label="Cc">{preview.email.cc.join(', ')}</Row>
                <Row label="Subject">{preview.email.subject}</Row>
                <div style={{ ...label, marginTop: space.md }}>Email</div>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={14} aria-label="Email to the hospital"
                  style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />
              </>
            )}
          </div>

          <div style={{ padding: space.md, borderTop: border.hairline, display: 'grid', gap: space.sm }}>
            {!preview && (
              <button disabled={!to || busy || ((kit.trays || []).length > 0 && !isReturn && !trays.length)} onClick={next} style={primary(!to || busy)}>
                {busy ? 'Working…' : isReturn ? 'Next' : 'Next: check the email'}
              </button>
            )}
            {preview && preview.email && emailsOn && (
              <button disabled={busy} onClick={() => confirm(true)} style={primary(busy)}>{busy ? 'Sending…' : 'Send email and move'}</button>
            )}
            {preview && (
              <button disabled={busy} onClick={() => confirm(false)} style={preview.email && emailsOn ? secondary : primary(busy)}>
                {preview.isReturn ? 'Mark returned' : preview.email ? 'Move without emailing' : 'Move'}
              </button>
            )}
            {preview && (
              <button disabled={busy} onClick={() => setPreview(null)} style={{ ...secondary, border: 'none', background: 'none' }}>Back</button>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: space.sm, padding: `${space.xs}px 0`, borderBottom: border.hairlineSoft }}>
      <div style={{ ...text('caption'), color: colour.inkFaint, width: 56, flexShrink: 0 }}>{label}</div>
      <div style={{ ...text('caption'), color: colour.ink, overflowWrap: 'anywhere' }}>{children || '—'}</div>
    </div>
  )
}

const primary = disabled => ({
  ...text('bodyStrong'), padding: `${space.md}px`, borderRadius: radius.control, border: 'none',
  background: colour.accent, color: 'white', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1
})
const secondary = {
  ...text('bodyStrong'), padding: `${space.md}px`, borderRadius: radius.control, border: border.hairline,
  background: colour.surface, color: colour.ink, cursor: 'pointer'
}
