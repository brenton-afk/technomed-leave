import React, { useState, useEffect } from 'react'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { readBooking, detectHospital, isCancelled } from '../../clinicalPlan/parse.js'
import { parseDateStr, addCivilDays, toDateStr } from '../../clinicalPlan/week.js'
import { dialable, bookingWords } from '../../kit/couriers.js'

// ─── Shared by the kit move and "Move something else" ────────────────────────

export const PLACES = { office: 'TM office / Warehouse', CLV: 'Calvary', RHH: 'RHH' }

export function shortDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Cases at a hospital over the next fortnight, so the email can say which case
 * it is for without anybody retyping the date or the surname. null while
 * looking; [] for none or not a hospital.
 */
export function useCasesAt(to, today, token, off = false) {
  const [cases, setCases] = useState(null)
  useEffect(() => {
    if (!today || (to !== 'CLV' && to !== 'RHH') || off) { setCases(null); return }
    let live = true
    setCases(null)
    const end = toDateStr(addCivilDays(parseDateStr(today), 14))
    fetch(`/api/calendar/today?action=week&start=${today}&end=${end}`, {
      headers: { Authorization: `Bearer ${token || ''}` }
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
  }, [to, today, token, off])
  return cases
}

export const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.lg}px 0 ${space.sm}px` }
export const field = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', ...text('field'), border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }
export const primary = disabled => ({
  ...text('bodyStrong'), padding: `${space.md}px`, borderRadius: radius.control, border: 'none',
  background: colour.accent, color: 'white', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1
})
export const secondary = {
  ...text('bodyStrong'), padding: `${space.md}px`, borderRadius: radius.control, border: border.hairline,
  background: colour.surface, color: colour.ink, cursor: 'pointer'
}

export function Row({ label: name, children }) {
  return (
    <div style={{ display: 'flex', gap: space.sm, padding: `${space.xs}px 0`, borderBottom: border.hairlineSoft }}>
      <div style={{ ...text('caption'), color: colour.inkFaint, width: 56, flexShrink: 0 }}>{name}</div>
      <div style={{ ...text('caption'), color: colour.ink, overflowWrap: 'anywhere' }}>{children || '—'}</div>
    </div>
  )
}

/** For which case — a hospital's next fortnight, as a choice. */
export function CasePick({ to, cases, value, onChange }) {
  return (
    <>
      <div style={label}>For which case</div>
      {cases === null && <div style={{ ...text('caption'), color: colour.inkFaint }}>Finding cases at {PLACES[to]}…</div>}
      {cases && (
        <select value={value} onChange={e => onChange(e.target.value)} style={field} aria-label="Case this is for">
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
  )
}

/** The email, as it will go: who, subject, and the words — editable. */
export function EmailPreview({ email, body, onBody }) {
  return (
    <>
      <Row label="To">{email.to.join(', ')}</Row>
      <Row label="Cc">{email.cc.join(', ')}</Row>
      <Row label="Subject">{email.subject}</Row>
      <div style={{ ...label, marginTop: space.md }}>Email</div>
      <textarea value={body} onChange={e => onBody(e.target.value)} rows={14} aria-label="Email to the hospital"
        style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />
    </>
  )
}

/** After a move: who to ring to collect it (Brent, 20 Nov 2026). */
export function CourierStep({ name, moved, couriers, called, onCall }) {
  return (
    <div data-courier-step>
      <div role="status" style={{ ...text('bodyStrong'), background: colour.successSoft, color: colour.accentDeep,
        border: `1px solid ${colour.accent}`, borderRadius: radius.control, padding: space.md }}>
        ✓ Moved to {PLACES[moved.to]}{moved.emailed ? ' · email sent' : ''}
      </div>
      <div style={label}>Book the collection</div>
      <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
        {bookingWords({ kitName: name, trays: moved.trays, from: moved.from, to: moved.to, places: PLACES })}
        {' '}Ask for a job ID.
      </div>
      <div style={{ display: 'grid', gap: space.sm }}>
        {couriers.map(c => {
          const tel = dialable(c.phone)
          return tel ? (
            <a key={c.id} href={`tel:${tel}`} onClick={() => onCall(c)} data-call-courier={c.id}
              style={{ ...secondary, display: 'flex', alignItems: 'center', gap: space.sm, textDecoration: 'none',
                ...(called === c.id ? { borderColor: colour.accent, color: colour.accentDeep } : {}) }}>
              <span aria-hidden="true">📞</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block' }}>Call {c.name}{called === c.id ? ' ✓' : ''}</span>
                <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}>{c.phone}{c.note ? ` · ${c.note}` : ''}</span>
              </span>
            </a>
          ) : (
            <div key={c.id} style={{ ...text('caption'), color: colour.inkFaint, padding: `${space.xs}px ${space.sm}px` }}>
              {c.name} — no number yet (Kit room → Courier numbers)
            </div>
          )
        })}
      </div>
    </div>
  )
}
