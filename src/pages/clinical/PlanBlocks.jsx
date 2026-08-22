import React from 'react'
import { accentFor, accentTextFor, tokens, FONT_STACK } from '../../clinicalPlan/theme.js'
import { formatDayHeading } from '../../clinicalPlan/week.js'

// Presentational only. Every component here takes already-derived plan data and
// draws it — no fetching, no parsing, no date maths beyond formatting. Order
// follows §6.4 exactly, because the document's order is what readers scan by.

// Four lines, always in this order: who, what was done, what it was done with,
// and where the kit came from. Times are deliberately absent — theatre lists move
// so often that a time printed here is wrong more often than it is right, and a
// wrong time is worse than none. They are still on the calendar, which is the one
// place they are kept up to date, and meetings below do keep theirs.
export function CaseBlock({ surgicalCase, dark }) {
  const t = tokens(dark)
  const accent = accentFor(surgicalCase.surgeon, dark)          // the bar
  const accentText = accentTextFor(surgicalCase.surgeon, dark)  // legible as text

  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
      {/* Coloured left bar runs the full height of the block */}
      <div aria-hidden="true" style={{ width: 4, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* Surgeon colour is never the only carrier of meaning — the name is
            always present as text (§10 accessibility). */}
        <div style={{ fontSize: 14, fontWeight: 700, color: t.ink, lineHeight: 1.35 }}>
          {surgicalCase.patient}
          <span style={{ color: t.inkFaint, fontWeight: 400 }}> / </span>
          <span style={{ color: accentText }}>{surgicalCase.surgeon}</span>
        </div>
        {/* The operation leads, in bold: "C5/6 ACDF" says more about the case
            than the implant system does. */}
        {surgicalCase.operation && (
          <div style={{ fontSize: 13.5, fontWeight: 700, color: t.ink, lineHeight: 1.45 }}>
            {surgicalCase.operation}
          </div>
        )}
        {/* System and supply on one line. They were two, and the second was the
            first repeated with "(consignment)" added to it. */}
        {(surgicalCase.system || surgicalCase.supply) && (
          <div style={{ fontSize: 13, color: t.inkMuted, lineHeight: 1.45 }}>
            {surgicalCase.system}
            {surgicalCase.system && surgicalCase.supply ? ' · ' : ''}
            {surgicalCase.supply && (
              <span style={{ fontWeight: 600, color: t.ink }}>{surgicalCase.supply}</span>
            )}
          </div>
        )}
        {/* Only reached when the kit names something the system does not — a
            loan tray alongside the implant system, say. */}
        {surgicalCase.kit && (
          <div style={{ fontSize: 13, color: t.inkMuted, lineHeight: 1.45 }}>Kit: {surgicalCase.kit}</div>
        )}
        {(surgicalCase.notes || []).map((note, i) => (
          <div key={i} style={{
            fontSize: 12.5, fontStyle: 'italic', lineHeight: 1.5, marginTop: 2,
            fontWeight: note.kind === 'colourCoding' || note.kind === 'clinicalAlert' ? 700 : 400,
            color: note.kind === 'colourCoding' || note.kind === 'clinicalAlert' ? t.alert : t.inkFaint
          }}>
            {note.text}
          </div>
        ))}
      </div>
    </div>
  )
}

// Offsite meetings and admin/logistics entries: same left-bar treatment, but
// neutral grey, and a single bold line.
export function NonSurgeonBlock({ item, dark }) {
  const t = tokens(dark)
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
      <div aria-hidden="true" style={{ width: 4, borderRadius: 2, background: t.neutralBar, flexShrink: 0 }} />
      <div style={{ fontSize: 13.5, fontWeight: 700, color: t.ink, lineHeight: 1.45 }}>{item.text}</div>
    </div>
  )
}

// The recurring staffing flag is the only boxed flag type (§6.4.3).
export function FlagLine({ flag, dark }) {
  const t = tokens(dark)
  const isAlert = flag.kind === 'clinicalAlert'
  const colour = isAlert ? t.alert : t.flagText

  if (flag.boxed) {
    return (
      <div style={{
        background: t.flagBg, border: `1px solid ${t.flagBorder}`, borderRadius: 6,
        padding: '8px 10px', marginBottom: 8, fontSize: 13, fontWeight: 700,
        color: t.flagText, lineHeight: 1.45
      }}>
        <span aria-hidden="true">■ </span>{flag.text}
      </div>
    )
  }
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: colour, marginBottom: 6, lineHeight: 1.45 }}>
      <span aria-hidden="true">■ </span>{flag.text}
    </div>
  )
}

export function HospitalHeading({ hospital, dark }) {
  const t = tokens(dark)
  return (
    <h4 style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase',
      color: t.inkFaint, margin: '10px 0 6px'
    }}>
      {hospital}
    </h4>
  )
}

/**
 * One day of the plan. Used identically by the Weekly and Daily views, which is
 * what keeps the two visually consistent.
 */
export function DayBlock({ day, dark, headingLevel = 3 }) {
  const t = tokens(dark)
  const Heading = `h${headingLevel}`

  return (
    <section style={{ marginBottom: 22, fontFamily: FONT_STACK }} aria-label={formatDayHeading(day.date)}>
      <Heading style={{ fontSize: 15, fontWeight: 700, color: t.ink, margin: '0 0 2px' }}>
        {formatDayHeading(day.date)}
      </Heading>
      <div style={{ fontSize: 12.5, color: t.inkFaint, marginBottom: 10 }}>{day.caseCountLine}</div>

      {/* Flags sit above the hospital subheading and cases (§6.4.4) */}
      {day.flags.map((flag, i) => <FlagLine key={i} flag={flag} dark={dark} />)}

      {/* A booking the parser could not read. Shown before the cases, because
          the risk is a real case being absent from the counts above. */}
      {(day.needsAttention || []).map(item => (
        <div key={item.id} style={{
          background: dark ? 'rgba(220,38,38,0.12)' : '#fef3f2',
          border: `1px solid ${dark ? 'rgba(220,38,38,0.4)' : '#fda29b'}`,
          borderRadius: 6, padding: '8px 10px', marginBottom: 8
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: t.alert, lineHeight: 1.4 }}>
            <span aria-hidden="true">■ </span>NOT COUNTED: {item.text}
          </div>
          <div style={{ fontSize: 11.5, color: t.inkMuted, lineHeight: 1.45, marginTop: 2 }}>
            {item.reason}
          </div>
        </div>
      ))}

      {day.casesByHospital.map(group => (
        <div key={group.hospital}>
          <HospitalHeading hospital={group.hospital} dark={dark} />
          {group.cases.map(c => <CaseBlock key={c.id} surgicalCase={c} dark={dark} />)}
        </div>
      ))}

      {day.nonSurgeonItems.length > 0 && (
        <div style={{ marginTop: day.casesByHospital.length ? 8 : 0 }}>
          {day.nonSurgeonItems.map((item, i) => <NonSurgeonBlock key={i} item={item} dark={dark} />)}
        </div>
      )}

      {day.otherRollup.length > 0 && (
        <div style={{ fontSize: 12.5, fontStyle: 'italic', color: t.inkFaint, lineHeight: 1.55, marginTop: 4 }}>
          Other: {day.otherRollup.map(o => o.text).join(' · ')}
        </div>
      )}
    </section>
  )
}

export function SurgeonLegend({ surgeons, dark }) {
  const t = tokens(dark)
  if (!surgeons.length) return null
  return (
    <div style={{ fontSize: 13, color: t.inkMuted, marginBottom: 14, lineHeight: 1.6 }}>
      <span>Surgeons this week: </span>
      {/* Coloured bold text, no swatch chips (§6.2) */}
      {surgeons.map((s, i) => (
        <React.Fragment key={s}>
          <strong style={{ color: accentTextFor(s, dark) }}>{s}</strong>
          {i < surgeons.length - 1 ? ' ' : ''}
        </React.Fragment>
      ))}
    </div>
  )
}

export function NotesCallout({ notes, dark }) {
  const t = tokens(dark)
  if (!notes) return null
  return (
    <div style={{
      background: t.notesBg, border: `1px solid ${t.notesBorder}`, borderRadius: 8,
      padding: '12px 14px', marginBottom: 18
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: t.ink, marginBottom: 4 }}>Notes</div>
      <div style={{ fontSize: 13, color: t.inkMuted, lineHeight: 1.6 }}>{notes}</div>
    </div>
  )
}

export function KeyFlagsSection({ keyFlags, dark }) {
  const t = tokens(dark)
  if (!keyFlags.length) return null
  return (
    <section style={{ marginTop: 6 }}>
      <h3 style={{ fontSize: 14.5, fontWeight: 700, color: t.ink, margin: '0 0 10px' }}>
        Key flags for the week
      </h3>
      {keyFlags.map(flag => (
        <p key={flag.label} style={{ fontSize: 13, color: t.inkMuted, lineHeight: 1.6, margin: '0 0 9px' }}>
          <strong style={{ color: t.ink }}>{flag.label}:</strong> {flag.text}
        </p>
      ))}
    </section>
  )
}

export function PlanFooter({ generatedAtLabel, dark }) {
  const t = tokens(dark)
  return (
    <footer style={{ marginTop: 20 }}>
      <hr style={{ border: 'none', borderTop: `1px solid ${t.notesBorder}`, margin: '0 0 10px' }} />
      <p style={{ fontSize: 11, fontStyle: 'italic', color: t.inkFaint, textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
        Generated from bookings@technomed.com.au and Staff Leave calendar entries.
        Planning week runs Monday–Sunday: this document shows next week from Friday onward,
        and the current week on the Monday–Thursday syncs. Last generated: {generatedAtLabel}
      </p>
    </footer>
  )
}


/**
 * What the plan made of each booking, beside what was typed.
 *
 * A booking read the wrong way and a booking entered the wrong way look
 * identical on the plan — both just come out odd — so there was no way to tell
 * which had happened, or to notice a case that had been dropped altogether. This
 * shows the interpretation, so a title that reads badly can be retyped or
 * reported rather than puzzled over.
 */
export function BookingReadings({ readings, dark }) {
  const t = tokens(dark)
  if (!readings?.length) return null

  const unread = readings.filter(r => r.status === 'not read as a case')
  const label = { color: t.inkFaint, fontSize: 11.5 }

  return (
    <section style={{ marginTop: 18 }}>
      <h3 style={{ fontSize: 14.5, fontWeight: 700, color: t.ink, margin: '0 0 4px' }}>
        What the plan read from the calendar
      </h3>
      <p style={{ fontSize: 12, color: t.inkMuted, lineHeight: 1.55, margin: '0 0 12px' }}>
        Every booking this week, and what the app made of it. Bookings are free
        text, so this is where to check whether an odd-looking case was entered
        that way or read that way.
        {unread.length > 0 && ` ${unread.length} entr${unread.length === 1 ? 'y is' : 'ies are'} not counted as cases.`}
      </p>

      {readings.map((r, i) => (
        <div key={`${r.date}-${i}`} style={{
          borderTop: `1px solid ${t.notesBorder}`,
          padding: '9px 0',
          display: 'flex', gap: 10, alignItems: 'flex-start'
        }}>
          <span aria-hidden="true" style={{
            width: 6, height: 6, borderRadius: 3, marginTop: 6, flexShrink: 0,
            background: r.read ? 'rgba(24,154,133,0.9)' : t.inkFainter
          }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, color: t.ink, lineHeight: 1.4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {r.title}
            </div>
            {r.note && (
              <div style={{ ...label, lineHeight: 1.45, marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {r.note}
              </div>
            )}
            {r.read ? (
              <div style={{ fontSize: 12, color: t.inkMuted, lineHeight: 1.6, marginTop: 4 }}>
                <Read label="Patient" value={r.read.patient} t={t} />
                <Read label="Surgeon" value={r.read.surgeon
                  + (r.read.surgeonSource === 'colour' ? ' (from the calendar colour)' : '')} t={t} />
                <Read label="Operation" value={r.read.operation} t={t} />
                <Read label="System" value={r.read.system} t={t} />
                <Read label="Supply" value={r.read.supply} t={t} />
                <Read label="Kit" value={r.read.kit} t={t} />
              </div>
            ) : (
              <div style={{ ...label, marginTop: 4 }}>
                {r.allDay ? 'All-day entry — shown as a flag, not a case.' : 'Not read as a case.'}
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

/** One field of a reading. Absent fields are shown as absent, not hidden. */
function Read({ label, value, t }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <span style={{ color: t.inkFainter, minWidth: 66, flexShrink: 0 }}>{label}</span>
      <span style={{ color: value ? t.ink : t.inkFainter }}>{value || '—'}</span>
    </div>
  )
}
