import React from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { bySession, casesAhead } from '../../clinicalPlan/listPlace.js'
import { accentForCase } from '../../clinicalPlan/theme.js'
import { weekdayName } from '../../clinicalPlan/week.js'

// ─── The theatre lists, as the hospitals run them ────────────────────────────
// "Having a list order tab that just brings up a list of cases at both
// hospitals in a simple 1,2,3 list. Just so it's easy to glance at what is on
// the list for each surgeon. It gives an idea of timing and is a bit clearer
// than having to read through each booking entry."
//
// The want is right and the shape needed changing, for a reason Brent gave
// himself when the numbers came off the cards: "the number becomes obsolete
// when competitor cases are on the list." A flat 1,2,3 across both hospitals
// is *our* ordering, not the hospital's. If Device Technologies have a case
// between two of ours, our second is the hospital's third, and a number that is
// confidently wrong is worse than no number at all.
//
// The other half: ordinal position is a poor stand-in for timing. Cases at two
// hospitals are not a sequence — they run at the same time, in two buildings.
// What actually says when something happens is the session, the start time
// where somebody has rung, and the order within one surgeon's list.
//
// So this groups by the thing that genuinely runs in sequence: one surgeon's
// list, in one theatre, in one session. Within that a number means something.
// Between those, nothing is implied.
//
// ── Gaps are shown, not closed ──
//
// Where the positions we know are not consecutive — we are 1st and 3rd — the
// case in between is somebody else's, and the list says so. That is the fact
// the numbers were removed for, put back as information rather than hidden by
// renumbering our cases 1, 2.

/** The session a list runs in, from the cases on it. */
function sessionOf(cases) {
  const named = cases.map(c => c.listPlace?.session).find(Boolean)
  return named === 'afternoon' ? 'PM' : named === 'morning' ? 'AM' : null
}

/** The earliest start anybody has recorded for this list. */
function startsAt(cases) {
  const told = cases.map(c => c.listPlace?.from).find(Boolean)
  if (told) return told
  const times = cases.map(c => c.start).filter(Boolean).sort()
  // The calendar hour is where the app put it when the day was laid out, not
  // something a hospital said, so it is offered as the weaker answer.
  return times.length ? times[0].slice(11, 16) : null
}

/**
 * The rows of one list: ours, and what the team was told is in front of us.
 *
 * "It should be able to deduce from the information in the bookings what the
 * cases are in front of it. For example within patient Whiteley the
 * information says 'After two cranis and a discectomy' — that means you can
 * put 1. Craniotomy, 2. Craniotomy, 3. Discectomy, and then our cases, rather
 * than '3 cases that aren't ours'."
 *
 * The team already writes it down when they ring for the running order. It was
 * being kept as prose and shown as prose, which is accurate and not much use:
 * a theatre list is a sequence, and "two cranis and a discectomy" is three
 * places in it.
 *
 * Where the words name exactly as many cases as the gap, they fill it. Where
 * they do not — unrecognised prose, or a count that disagrees with the
 * position the hospital gave — it falls back to saying how many. A list with a
 * name invented onto it is worse than one that admits what it does not know.
 *
 * It also works the other way round. A case with no position whose notes say
 * what is ahead of it has a position: three cases in front makes us fourth.
 * That is not a guess — it is what the hospital said, read properly.
 *
 * A case nobody has rung about at all keeps its order and gets no number.
 */
function rowsFor(cases) {
  const ordered = bySession(cases)
  const rows = []
  let last = 0

  for (const surgicalCase of ordered) {
    const named = casesAhead(surgicalCase.listPlace?.ahead)
    // The hospital's number where there is one; otherwise what the words imply,
    // and only for the first of ours — after that the count is relative to a
    // place already established.
    const at = surgicalCase.listPlace?.position
      || (named.length && last === 0 ? named.length + 1 : null)

    const gap = at ? at - last - 1 : 0
    if (gap > 0) {
      if (named.length === gap) {
        named.forEach((what, i) => rows.push({
          ahead: true, at: last + 1 + i, what, key: `ahead-${at}-${i}`
        }))
      } else {
        rows.push({ gap: true, count: gap, key: `gap-${at}` })
      }
    }

    if (at) last = at
    rows.push({ surgicalCase, at, key: surgicalCase.id })
  }
  return rows
}

/** What is going in, short enough for a line. */
function kitLine(surgicalCase) {
  const named = (surgicalCase.supplies || []).filter(e => e?.system)
  if (named.length) {
    return named.map(e => e.system + (e.supply ? ` (${e.supply})` : '')).join(' · ')
  }
  return surgicalCase.system || null
}

function TheatreList({ surgeon, cases }) {
  const session = sessionOf(cases)
  const from = startsAt(cases)
  const accent = accentForCase(cases[0])

  return (
    <div style={{ marginBottom: space.md }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: space.sm,
        paddingBottom: 4, marginBottom: 4,
        borderBottom: `2px solid ${accent}`
      }}>
        <span style={{ ...text('bodyStrong'), color: colour.ink }}>{surgeon}</span>
        <span style={{ ...text('caption'), color: colour.inkMuted }}>
          {[session, from && `from ${from}`].filter(Boolean).join(' · ')}
        </span>
      </div>

      {rowsFor(cases).map(row => row.ahead ? (
        // A case in front of ours, named from what the team was told. Numbered
        // like the rest — it holds a real place on the hospital's list — and
        // set in the faint italic so it reads as somebody else's at a glance.
        <div key={row.key} style={{
          display: 'flex', gap: space.sm, padding: '3px 0',
          ...text('caption'), color: colour.inkFainter, fontStyle: 'italic'
        }}>
          <span style={{ width: 18, flexShrink: 0, textAlign: 'right' }}>{row.at}</span>
          <span>{row.what}</span>
        </div>
      ) : row.gap ? (
        <div key={row.key} style={{
          display: 'flex', gap: space.sm, padding: '3px 0',
          ...text('caption'), color: colour.inkFainter, fontStyle: 'italic'
        }}>
          <span style={{ width: 18, flexShrink: 0, textAlign: 'right' }}>·</span>
          <span>
            {row.count === 1 ? 'one case' : `${row.count} cases`} not ours
          </span>
        </div>
      ) : (
        <div key={row.key} style={{
          display: 'flex', gap: space.sm, padding: '3px 0',
          opacity: row.surgicalCase.cancelled ? 0.45 : 1
        }}>
          {/* The number only where a hospital has given us one. A sequence
              number would be ours, and ours is the thing that goes stale. */}
          <span style={{
            width: 18, flexShrink: 0, textAlign: 'right',
            ...text('caption'), fontWeight: 700,
            color: row.at ? colour.ink : colour.inkFainter
          }}>{row.at || '–'}</span>

          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{
              ...text('caption'), fontWeight: 700, color: colour.ink,
              ...(row.surgicalCase.cancelled ? { textDecoration: 'line-through' } : {})
            }}>
              {row.surgicalCase.patient
                || (row.surgicalCase.awaitingName ? 'Name to come' : '')}
            </span>
            {row.surgicalCase.operation && (
              <span style={{ ...text('caption'), color: colour.inkMuted }}>
                {' '}{row.surgicalCase.operation}
              </span>
            )}
            {kitLine(row.surgicalCase) && (
              <span style={{
                ...text('micro'), textTransform: 'none', letterSpacing: 0,
                display: 'block', color: colour.inkFaint, lineHeight: 1.35
              }}>{kitLine(row.surgicalCase)}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * The hospital, short enough for a column head.
 *
 * The week grid already does this — "CALVARY LENAH VALLEY" is the name on the
 * booking and nobody says it out loud.
 */
function shortHospital(name) {
  return name === 'CALVARY LENAH VALLEY' ? 'CALVARY' : name
}

/** One hospital's lists for one day. */
function HospitalLists({ hospital, cases }) {
  const bySurgeon = new Map()
  for (const surgicalCase of cases) {
    const who = surgicalCase.surgeon || 'Unnamed surgeon'
    if (!bySurgeon.has(who)) bySurgeon.set(who, [])
    bySurgeon.get(who).push(surgicalCase)
  }

  return (
    <div style={{ minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: '280px' }}>
      <div style={{
        ...text('micro'), textTransform: 'uppercase', letterSpacing: '0.6px',
        color: colour.inkFaint, marginBottom: 6
      }}>{shortHospital(hospital)}</div>
      {[...bySurgeon.entries()].map(([surgeon, theirs]) => (
        <TheatreList key={surgeon} surgeon={surgeon} cases={theirs} />
      ))}
    </div>
  )
}

/**
 * Every list this week, a day at a time, both hospitals side by side.
 *
 * Side by side because that is what they are: two theatres running at once,
 * not one queue. Stacked on a phone, where there is no room for two columns
 * and the wrap does it without a breakpoint.
 */
export default function ListOrder({ plan, today, day }) {
  // ── The day you tapped, and only that day ──
  //
  // "The list view isn't refreshing automatically when you select the day...
  // the list order view needs to correspond immediately and refresh
  // immediately to whatever day you click on. It's really laggy."
  //
  // It was drawing the whole week at once and ignoring the date strip
  // entirely, so tapping Wednesday changed nothing that could be seen. Seven
  // days of theatre lists is also seven times the work on every render, which
  // is most of where the lag was.
  //
  // One day, with the strip above it to move between them. Falls back to the
  // whole week when no day is named — which is the desktop, where all seven
  // days are on the glass anyway and there is no day view to correspond to.
  const all = (plan?.days || []).filter(dayPlan =>
    (dayPlan.casesByHospital || []).some(g => (g.cases || []).length))
  const days = day ? all.filter(dayPlan => dayPlan.date === day) : all

  if (!days.length) {
    return (
      <div style={{ ...text('caption'), color: colour.inkFaint, padding: space.md }}>
        {day ? 'Nothing booked on this day.' : 'Nothing booked this week.'}
      </div>
    )
  }

  return (
    <div>
      {days.map(day => (
        <div key={day.date} style={{
          marginBottom: space.lg, padding: space.md,
          background: colour.surface,
          border: `1px solid ${day.date === today ? colour.accent : colour.line}`,
          borderRadius: radius.card
        }}>
          <div style={{
            ...text('bodyStrong'),
            color: day.date === today ? colour.accentDeep : colour.ink,
            marginBottom: space.sm
          }}>
            {weekdayName(day.date)}
            <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}>
              {' '}{day.date.slice(8, 10)}/{day.date.slice(5, 7)}
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.lg }}>
            {(day.casesByHospital || [])
              .filter(group => (group.cases || []).length)
              .map(group => (
                <HospitalLists key={group.hospital}
                  hospital={group.hospital} cases={group.cases} />
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}
