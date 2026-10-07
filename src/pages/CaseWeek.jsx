import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Page, Header, Banner } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { useLiveRefresh } from '../liveRefresh.js'
import {
  fetchWeekPlan, readCachedPlan, readPrefs, writePrefs, planSignature
} from '../clinicalPlan/provider.js'
import {
  resolveDefaultWeek, weekWindowFor, todayStr, parseDateStr, toDateStr,
  addCivilDays, civilWeekday, weekdayName, formatWeekRange, formatWeekRangeShort, formatStamp
} from '../clinicalPlan/week.js'
import {
  accentForCase, accentTextForCase, NAVIGATION_ACCENT, washFor, withAlpha
} from '../clinicalPlan/theme.js'
import { useIsDesktop } from '../design/viewport.js'
import EditBooking from './cases/EditBooking.jsx'
import NewBooking from './cases/NewBooking.jsx'
import BookingQueue from './cases/BookingQueue.jsx'
import ListPlace from './cases/ListPlace.jsx'
import TeamLeaderStrip from './cases/TeamLeaderStrip.jsx'
import { weekOf, withinWeek } from '../clinicalPlan/teamLeader.js'
import { describeListPlace } from '../clinicalPlan/listPlace.js'
import { isOrthopaedic } from '../clinicalPlan/colours.js'
import { suggestSupply } from '../clinicalPlan/inventory.js'
import { preferencesFor } from '../clinicalPlan/preferences.js'
import { GuideView } from './TheatreGuides.jsx'
import { NOT_REQUIRED_LABEL } from '../clinicalPlan/attendance.js'

// ─── The week ─────────────────────────────────────────────────────────────────
// One view of the bookings calendar, replacing the two that overlapped.
//
// There used to be a Calendar and a Case plan, built at different times for
// different reasons, and by the end most of both screens was the same thing
// twice. The Calendar navigated well and showed everything the calendar holds;
// the Case plan read a case properly — operation, system, supply, kit — and knew
// about the week as a whole. Neither was complete on its own, and keeping both
// meant every improvement had to be made in two places or the two would drift,
// which is exactly how the calendar view ended up not refreshing for a month
// while the plan did.
//
// So: the plan's reading of a case, the calendar's day-by-day navigation, and
// the booking notes that neither of them used to show.

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday', 'Sunday']

/** 5 → 5th, 22 → 22nd. The way the date is said out loud. */
function ordinal(n) {
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const dayNum = day => parseDateStr(day).day
const monthOf = day => MONTHS[parseDateStr(day).month - 1]
const shiftDay = (day, by) => toDateStr(addCivilDays(parseDateStr(day), by))

/** The tone a non-case item is drawn in. */
// The small header controls. One definition, so they cannot drift apart.
// 44px, which is Apple's minimum tap target and not a round number chosen for
// looks. These were 2px of padding around a 19px glyph — about 23 by 22 — and
// reported as "the arrows to cycle through the weeks are very small". They are
// also the most-used control on the screen.
const TAP = 44

const arrowStyle = {
  width: TAP,
  height: TAP,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: radius.pill,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.10)',
  color: 'white',
  // Glyphs, but the type scale is closed and a closed scale with exceptions in
  // it is not closed.
  ...text('title'),
  lineHeight: 1,
  cursor: 'pointer',
  padding: 0
}

/**
 * Day or week, as a segmented control rather than a button that changes its own
 * label.
 *
 * The old one read "Day" when you were in week view and "Week" when you were in
 * day view — it named the destination, not the state — so there was no way to
 * tell which you were looking at without reading the list below. Two segments
 * with one lit says where you are and where you can go at the same time, and
 * costs no more room beside the title.
 */
function SpanToggle({ span, onChange }) {
  return (
    <div role="tablist" aria-label="How much of the week to show"
      style={{
        display: 'flex', flexShrink: 0, padding: 3, gap: 2,
        background: 'rgba(0,0,0,0.22)', borderRadius: radius.pill
      }}>
      {['day', 'week'].map(id => {
        const on = span === id
        return (
          <button key={id} role="tab" aria-selected={on}
            onClick={() => onChange(id)}
            style={{
              // Short of 44 because it sits beside the title rather than in the
              // run of controls, and making it that tall would push the week
              // itself further down the screen than the toggle is worth.
              minWidth: 46, height: 34, border: 'none', borderRadius: radius.pill,
              background: on ? 'white' : 'transparent',
              color: on ? colour.navy : 'rgba(255,255,255,0.7)',
              ...text('bodyStrong'), cursor: 'pointer'
            }}>
            {id === 'day' ? 'Day' : 'Week'}
          </button>
        )
      })}
    </div>
  )
}

const KIND_TONE = {
  leave: { bg: colour.warningSoft, ink: colour.warning },
  hours: { bg: colour.accentSoft, ink: colour.accentDeep },
  meeting: { bg: colour.lineSoft, ink: colour.inkMuted },
  reminder: { bg: colour.dangerSoft, ink: colour.danger },
  other: { bg: colour.lineSoft, ink: colour.inkFaint }
}

/**
 * Every system on a case, each with where its kit is coming from.
 *
 * "Pt Bannister for KT Medical doesn't say whether it was consignment or loan.
 * Those labels must be on every booking in every entry in the app."
 *
 * They were missing wherever nobody had typed them, which is most bookings —
 * the field is free text and "Kit: KT Lonestar" is a perfectly natural thing
 * to write. An absent label reads exactly like a decision nobody has made, so
 * the two cases that needed chasing looked identical to the dozen that did
 * not.
 *
 * So where it is not recorded the app works it out, from the inventory it
 * already holds: Lonestar and Dakota are consigned at RHH, Mariner at Calvary
 * is a distributor set, Athlet at Calvary is a tray we move ourselves.
 *
 * A worked-out answer is marked with a question mark and drawn quietly. It is
 * a reading of stock that was dictated once and goes stale — a set gets
 * consigned, a floating kit is reassigned — and a guess dressed as an answer
 * is how a wrong one survives to the morning of the case.
 *
 * Nothing at all for a case we are not attending: there is no kit to bring,
 * and a supply prompt on one is noise standing next to the cases that need it.
 */
function suppliesFor(surgicalCase) {
  if (!surgicalCase || surgicalCase.cancelled || surgicalCase.notRequired) return null
  const entries = (surgicalCase.supplies || []).filter(e => e?.system)
  if (!entries.length) return null

  return entries.map(entry => {
    if (entry.supply) return { ...entry, inferred: false }
    const guess = suggestSupply(entry.system, surgicalCase.hospital)
    return { ...entry, supply: guess, inferred: Boolean(guess) }
  })
}

/**
 * A case, in full.
 *
 * Everything the booking says, in one place: who, what, with which system, how
 * it is supplied, what extra kit, and whatever the team wrote in the notes.
 */
function CaseCard({ surgicalCase, onOpen, busy, onSetPlace, onPreferences, hasPreferences }) {
  const off = Boolean(surgicalCase.cancelled)
  // Told about, not attending. Drawn back like a cancelled case rather than
  // struck through — it is still going ahead, just without us.
  const spare = Boolean(surgicalCase.notRequired) && !off
  const bar = off ? colour.inkFainter : accentForCase(surgicalCase)
  // The whole card carries the surgeon's colour, washed out, the way a
  // calendar entry does. A 5px strip reads on a phone and disappears in a
  // week column; a wash reads at any size. See washFor.
  //
  // No second argument. It used to be the alpha, and when washFor stopped
  // taking an alpha the leftover 0.1 became a truthy `dark` — so every card
  // quietly rendered the dark-mode accents, which are lighter and sit closer
  // together, undoing half the work done to separate Sage from Basil.
  const wash = off ? 'transparent' : washFor(surgicalCase)
  const edge = off ? colour.line : withAlpha(bar, 0.35)
  const nameInk = off ? colour.inkFaint : accentTextForCase(surgicalCase)
  const place = describeListPlace(surgicalCase.listPlace)

  return (
    <div
      style={{
        display: 'flex', width: '100%', gap: 0, padding: 0, alignItems: 'stretch',
        background: wash, border: `1px solid ${edge}`,
        borderRadius: radius.card, marginBottom: space.sm, overflow: 'hidden',
        opacity: busy ? 0.55 : spare ? 0.72 : 1, transition: 'opacity 120ms'
      }}>
      <span aria-hidden="true" style={{ width: 5, background: bar, flexShrink: 0 }} />


      {/* The case, and the one control that is not the case. They are siblings
          rather than nested: a button inside a button is invalid, and a browser
          is entitled not to deliver the tap to the inner one — which is exactly
          what happened. The chip did nothing on a phone while doing the right
          thing in the tests, because jsdom dispatches straight to the element
          and a real browser hit-tests first. */}
      <span style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', padding: `${space.sm}px ${space.md}px`
      }}>
      <button type="button" onClick={() => onOpen?.(surgicalCase)}
        style={{
          padding: 0, width: '100%', minWidth: 0,
          textAlign: 'left', background: 'none', border: 'none', font: 'inherit',
          cursor: onOpen ? 'pointer' : 'default'
        }}>
        <span style={{
          ...text('bodyStrong'), display: 'block', color: off ? colour.inkFaint : colour.ink,
          ...(off ? { textDecoration: 'line-through' } : {})
        }}>
          {surgicalCase.patient}
          <span style={{ color: colour.inkFainter, fontWeight: 400 }}> / </span>
          <span style={{ color: nameInk }}>{surgicalCase.surgeon}</span>
        </span>

        {(off || spare || surgicalCase.navigation || surgicalCase.selfFunding
          || isOrthopaedic(surgicalCase.surgeon)) && (
          <span style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
            {off && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                border: `1px solid ${colour.inkFainter}`, color: colour.inkFaint,
                ...text('micro'), textTransform: 'uppercase'
              }}>Cancelled</span>
            )}
            {/* First, and the only strong colour on the card when it applies.
                One of these used to read as an ordinary case with a BRAINLAB
                badge — which everywhere else means we are there with
                navigation — and the fact that nobody needs to go was a line of
                grey text under the kit. The most important thing on the card
                was the quietest thing on it. */}
            {spare && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                background: colour.inkMuted, color: 'white',
                ...text('micro'), textTransform: 'uppercase'
              }}>{NOT_REQUIRED_LABEL}</span>
            )}
            {/* Written at the front of the title, where it used to be swallowed
                into whatever parsed next — the card showed "FUNDING" sitting in
                front of the surname. It is a badge now, said in full. */}
            {surgicalCase.selfFunding && !off && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                background: colour.warningSoft, color: colour.ink,
                border: `1px solid ${colour.warningLine}`,
                ...text('micro'), textTransform: 'uppercase'
              }}>Self funding</span>
            )}
            {/* Navigation has its own marker rather than the bar's colour. It
                used to take the bar, which meant an Ibbett case using the AIRO
                scanner was not drawn as an Ibbett case at all — two facts
                fighting over one colour, and the surgeon losing. Both are
                readable at once now. */}
            {/* A different service, said in a word as well as in a colour.
                The week is read by somebody carrying spine trays, and an
                orthopaedic case is different kit, a different theatre and a
                different set of people. */}
            {isOrthopaedic(surgicalCase.surgeon) && !off && (
              <span style={{
                ...text('micro'), textTransform: 'uppercase', letterSpacing: '0.4px',
                borderRadius: radius.pill, padding: '1px 7px', fontWeight: 700,
                background: withAlpha(accentForCase(surgicalCase), 0.22),
                color: accentTextForCase(surgicalCase)
              }}>Orthopaedic</span>
            )}

            {surgicalCase.navigation && !off && (
              <span style={{
                padding: '1px 7px', borderRadius: radius.pill,
                // Outlined rather than filled when we are not attending. A
                // solid navigation badge is how the card says "we are there
                // with the AIRO", which is the opposite of what this case is.
                background: spare ? 'transparent' : NAVIGATION_ACCENT,
                color: spare ? colour.inkFaint : 'white',
                border: spare ? `1px solid ${colour.line}` : 'none',
                ...text('micro'), textTransform: 'uppercase'
              }}>{surgicalCase.navigation}</span>
            )}
          </span>
        )}

        {/* Before the operation, because it is the part that decides what time
            somebody sets an alarm for. A case can be routine and still have the
            team on the road at half six because it is first up. */}
        {place && !off && (
          <span style={{ display: 'block', marginTop: 3 }}>
            <span style={{
              ...text('bodyStrong'),
              color: place.headline.includes('1st') ? colour.warning : colour.accentDeep
            }}>{place.headline}</span>
            {place.ahead && (
              <span style={{ ...text('caption'), display: 'block', color: colour.inkMuted }}>
                {place.ahead}
              </span>
            )}
          </span>
        )}

        {/* The operation leads: "C5/6 ACDF" says more about a case than the
            implant system does. */}
        {surgicalCase.operation && (
          <span style={{ ...text('bodyStrong'), display: 'block', color: colour.ink }}>
            {surgicalCase.operation}
          </span>
        )}

        {/* Each system, and where its kit is coming from.
            
            On every booking, including the ones nobody has labelled — those
            carry a worked-out answer with a question mark after it. One line
            per system, because a case is often two systems with different
            answers and one line for both said the wrong thing about one. */}
        {suppliesFor(surgicalCase) && (
          <span style={{ ...text('caption'), display: 'block', color: colour.inkMuted }}>
            {suppliesFor(surgicalCase).map((entry, i) => (
              <React.Fragment key={entry.system}>
                {i > 0 && ' · '}
                {entry.system}
                {entry.supply ? (
                  <span style={{
                    fontWeight: entry.inferred ? 400 : 700,
                    color: entry.inferred ? colour.inkFaint : colour.ink
                  }}>
                    {' '}({entry.supply}{entry.inferred ? '?' : ''})
                  </span>
                ) : (
                  <span style={{ color: colour.warning, fontWeight: 700 }}> (supply?)</span>
                )}
              </React.Fragment>
            ))}
          </span>
        )}

        {surgicalCase.kit && (
          <span style={{ ...text('caption'), display: 'block', color: colour.inkMuted }}>
            Kit: {surgicalCase.kit}
          </span>
        )}

        {surgicalCase.rep && (
          <span style={{ ...text('caption'), display: 'block', color: colour.accentDeep }}>
            Rep: <strong style={{ fontWeight: 700 }}>{surgicalCase.rep}</strong>
          </span>
        )}

        {surgicalCase.unread && (
          <span style={{ ...text('caption'), display: 'block', color: colour.inkMuted }}>
            {surgicalCase.unread}
          </span>
        )}

        {/* What the team wrote that no field has a name for. This is the part
            neither old screen showed, and it is often the reason a case moved. */}
        {(surgicalCase.notes || []).map((note, i) => (
          <span key={i} style={{
            ...text('caption'), display: 'block', marginTop: 2,
            fontStyle: note.kind === 'booking' ? 'normal' : 'italic',
            fontWeight: note.kind === 'clinicalAlert' ? 700 : 400,
            color: note.kind === 'clinicalAlert' ? colour.danger : colour.inkFaint
          }}>
            {note.text}
          </span>
        ))}
      </button>

        {/* Always offered, whether or not anything is recorded — including on a
            day where this is our only case at that hospital, which is exactly
            where the arrows can say nothing and the list order still matters. */}
        {onSetPlace && !off && (
          <button
            type="button"
            aria-label={`Set where ${surgicalCase.patient} is on the list`}
            onClick={() => onSetPlace(surgicalCase)}
            style={{
              // A bordered chip rather than a text link. The first version was
              // caption-sized and the same colour as the rest of the card, and
              // was reported as the option not being there at all.
              display: 'inline-flex', alignItems: 'center', gap: 5,
              marginTop: space.sm, cursor: 'pointer', minHeight: 32,
              padding: `0 ${space.md}px`, borderRadius: radius.pill,
              border: `1px solid ${place ? colour.accent : colour.line}`,
              background: place ? colour.accentSoft : colour.surface,
              ...text('caption'), fontWeight: 700,
              color: place ? colour.accentDeep : colour.ink
            }}>
            {place ? 'Change list order' : '＋ Set list order'}
          </button>
        )}

        {/* Beside the list order, because they are the two things somebody
            wants off a booking at half past seven: where we are on the list,
            and how this surgeon likes the room. The booking already names the
            surgeon and the system, so the card opens rather than being
            searched for. Drawn only where there is something to open. */}
        {onPreferences && !off && hasPreferences?.(surgicalCase) && (
          <button
            type="button"
            aria-label={`Preferences for ${surgicalCase.surgeon || 'this case'}`}
            onClick={() => onPreferences(surgicalCase)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              marginTop: space.sm, marginLeft: space.sm, cursor: 'pointer',
              minHeight: 32, padding: `0 ${space.md}px`, borderRadius: radius.pill,
              border: `1px solid ${colour.line}`, background: colour.surface,
              ...text('caption'), fontWeight: 700, color: colour.ink
            }}>
            ★ Preferences
          </button>
        )}
      </span>

    </div>
  )
}

/** One arrow. Disabled at the ends, so the list cannot be pushed off itself. */

/** Leave, hours, a meeting, a reminder — quieter than a case, and labelled. */
function ItemRow({ item }) {
  const tone = KIND_TONE[item.kind] || KIND_TONE.other
  // Washed in its own calendar colour, like the cases above it, so leave and
  // kit jobs and on-call read as the same kind of object seen at a glance.
  const hex = item.colourHex
  return (
    <div style={{
      display: 'flex', gap: 0, marginBottom: 6, overflow: 'hidden',
      background: hex ? withAlpha(hex, 0.09) : 'transparent',
      border: `1px solid ${hex ? withAlpha(hex, 0.3) : colour.lineSoft}`,
      borderRadius: radius.control
    }}>
      <span aria-hidden="true"
        style={{ width: 3, background: hex || colour.line, flexShrink: 0 }} />
      <span style={{ padding: `${space.xs}px ${space.sm}px`, flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
          <span style={{ ...text('body'), color: colour.ink }}>{item.title || item.text}</span>
          <span style={{
            ...text('micro'), textTransform: 'uppercase', flexShrink: 0,
            background: tone.bg, color: tone.ink,
            borderRadius: radius.pill, padding: '2px 7px'
          }}>{item.kindLabel || 'Other'}</span>
        </span>
        {item.time && (
          <span style={{ ...text('caption'), display: 'block', color: colour.inkFaint }}>{item.time}</span>
        )}
      </span>
    </div>
  )
}

/**
 * Adding a booking, as a row rather than a floating button.
 *
 * It was a circle pinned to the bottom corner, and it got lost: it was
 * positioned against a container that scrolls, so it drifted off with the
 * content. Fixing it to the viewport would have worked and would have left it
 * floating over the last case of a long list, which is the usual complaint with
 * that pattern.
 *
 * A row cannot drift and cannot cover anything. It also knows which day it sits
 * under, so the sheet opens already set to that date — one fewer thing to choose
 * for the booking somebody is most likely making.
 */
function AddBookingRow({ day, onAdd }) {
  return (
    <button type="button" onClick={() => onAdd(day)}
      style={{
        display: 'flex', alignItems: 'center', gap: space.sm, width: '100%',
        padding: `${space.sm}px ${space.md}px`, marginBottom: space.sm,
        borderRadius: radius.card, cursor: 'pointer',
        background: colour.accentSoft,
        border: '1px dashed rgba(24,154,133,0.45)',
        color: colour.accentDeep, ...text('bodyStrong')
      }}>
      <span aria-hidden="true" style={{ ...text('heading'), lineHeight: 1 }}>+</span>
      <span>Add a booking{day ? ` to ${weekdayName(day)} ${dayNum(day)} ${monthOf(day)}` : ''}</span>
    </button>
  )
}

function Heading({ children }) {
  return (
    <div style={{
      ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
      margin: `${space.lg}px 0 ${space.sm}px`
    }}>{children}</div>
  )
}

/**
 * A supply, short enough for a 200px column.
 *
 * "Distributor Loan" is three times the width of a week column's worth of
 * patience. The full words stay on the phone card, where there is room for
 * them; here the distinction that has to survive is which of the three it is,
 * and "Dist" against "RHH" carries that in a quarter of the space.
 */
function shortSupply(supply) {
  if (!supply) return null
  if (/^consign/i.test(supply)) return 'cons'
  if (/^rhh/i.test(supply)) return 'RHH loan'
  if (/^distributor/i.test(supply)) return 'dist loan'
  return supply.toLowerCase()
}

/**
 * One case in a week column.
 *
 * Not the full card. A week column is about 200px wide and the phone's card
 * is built for 360 — dropped into one it wrapped to a word a line, and a
 * fortnight of "Re do transphenoidal Rathkes/pituitary abscess with drain"
 * came out as a vertical stack of single words.
 *
 * So: who, what, and the one thing that changes your morning. The rest is a
 * click away in the booking itself.
 *
 * The arrows and the list-order chip are here because the desktop has no day
 * view to send anybody to any more. They are the controls the week is actually
 * worked with, so they have to live on the view that is on the screen.
 */
function WeekCase({ surgicalCase, onOpen, onSetPlace, onPreferences, hasPreferences }) {
  const off = Boolean(surgicalCase.cancelled)
  const spare = Boolean(surgicalCase.notRequired) && !off
  const place = describeListPlace(surgicalCase.listPlace)

  return (
    // A div, not a button. The arrows and the chip are buttons in their own
    // right, and a button inside a button is invalid HTML that browsers
    // resolve by dropping one — which is how a control looks perfectly fine
    // and does nothing at all.
    <div style={{
      marginBottom: 4, borderRadius: radius.control, overflow: 'hidden',
      // Same wash as the day card, so a surgeon looks the same in both.
      border: `1px solid ${off ? colour.line : withAlpha(accentForCase(surgicalCase), 0.35)}`,
      background: off ? 'transparent' : washFor(surgicalCase),
      opacity: off ? 0.55 : spare ? 0.72 : 1
    }}>
    <div style={{ display: 'flex', gap: 7, alignItems: 'stretch' }}>
      {/* Six, not three. The wash behind it has to stay pale enough to carry
          dark text, and two close accents — Sage against Basil — survive best
          at full strength, so the full-strength part of the card has to be
          wide enough to actually read. */}
      <span aria-hidden="true" style={{
        width: 6, flexShrink: 0,
        background: off ? colour.inkFainter : accentForCase(surgicalCase)
      }} />
      <button type="button" onClick={() => onOpen?.(surgicalCase)}
        style={{
          minWidth: 0, flex: 1, textAlign: 'left', cursor: 'pointer',
          border: 'none', background: 'none', padding: '6px 0'
        }}>
        <span style={{
          ...text('caption'), fontWeight: 700, display: 'block', color: colour.ink,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          ...(off ? { textDecoration: 'line-through' } : {})
        }}>
          {surgicalCase.patient}
          <span style={{ color: colour.inkFaint, fontWeight: 400 }}> · </span>
          <span style={{ color: off ? colour.inkFaint : accentTextForCase(surgicalCase) }}>
            {surgicalCase.surgeon}
          </span>
        </span>

        {place?.headline && (
          <span style={{
            ...text('micro'), display: 'block', textTransform: 'none',
            color: place.headline.includes('1st') ? colour.warning : colour.accentDeep
          }}>{place.headline}</span>
        )}

        {/* Two lines at most. A week is read by scanning down a column, and a
            case that takes nine lines stops the column being scannable. */}
        {surgicalCase.operation && (
          <span style={{
            ...text('micro'), display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden', textTransform: 'none',
            fontWeight: 400, letterSpacing: 0, color: colour.inkMuted, lineHeight: 1.35
          }}>{surgicalCase.operation}</span>
        )}

        {/* What is going in, and where it is coming from.
            
            The column had the patient, the surgeon and the operation and not
            the system — so the one view that shows a whole week at once could
            not answer "what am I packing for Thursday", which is most of why
            somebody opens a week the day before.
            
            Above the rep on purpose: the kit decides what goes in the car,
            and who is taking it is the next question after that. */}
        {!off && suppliesFor(surgicalCase)?.map(entry => (
          <span key={entry.system} style={{
            ...text('micro'), display: 'block', textTransform: 'none',
            letterSpacing: 0, lineHeight: 1.35, color: colour.ink,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
            <strong style={{ fontWeight: 700 }}>{entry.system}</strong>
            {entry.supply ? (
              <span style={{ color: entry.inferred ? colour.inkFainter : colour.inkMuted }}>
                {' '}{shortSupply(entry.supply)}{entry.inferred ? '?' : ''}
              </span>
            ) : (
              <span style={{ color: colour.warning, fontWeight: 700 }}> supply?</span>
            )}
          </span>
        ))}

        {/* Who is on it. The phone card has carried this all along and the
            column did not, so the one view that shows the whole week at once
            was the one that could not answer "who has got Thursday". It goes
            last and in the accent colour, which is where the eye lands after
            the patient and the operation.

            Not clamped and not truncated: a rep's name is one short word, and
            an ellipsis through "Aimee" would save nothing. */}
        {surgicalCase.rep && !off && (
          <span style={{
            ...text('micro'), display: 'block', textTransform: 'none',
            letterSpacing: 0, color: colour.accentDeep
          }}>
            {/* Labelled, like the phone card. A bare first name in a column of
                surnames and operations is easy to read straight past — it was
                reported as not being there at all — and "Rep:" is the word
                somebody is scanning for. */}
            Rep: <strong style={{ fontWeight: 700 }}>{surgicalCase.rep}</strong>
          </span>
        )}

        {(off || spare) && (
          <span style={{
            ...text('micro'), display: 'block', color: colour.inkFaint
          }}>{off ? 'Cancelled' : 'Not needed'}</span>
        )}
      </button>

      {/* Narrow on purpose. The phone card's 40px thumb target would be a
          fifth of a week column, and this one is driven with a mouse. */}
    </div>

      {/* Offered whether or not anything is recorded — including where this is
          our only case at that hospital, which is exactly where the arrows can
          say nothing and the list order still matters. */}
      {onPreferences && !off && hasPreferences?.(surgicalCase) && (
        <button type="button"
          aria-label={`Preferences for ${surgicalCase.surgeon || 'this case'}`}
          onClick={() => onPreferences(surgicalCase)}
          style={{
            display: 'block', width: '100%', cursor: 'pointer', textAlign: 'left',
            padding: '3px 7px 4px', border: 'none',
            borderTop: `1px solid ${withAlpha(accentForCase(surgicalCase), 0.25)}`,
            background: 'none', ...text('micro'), textTransform: 'none',
            color: colour.inkFaint
          }}>
          ★ Preferences
        </button>
      )}

      {onSetPlace && !off && (
        <button type="button"
          aria-label={`Set where ${surgicalCase.patient} is on the list`}
          onClick={() => onSetPlace(surgicalCase)}
          style={{
            display: 'block', width: '100%', cursor: 'pointer', textAlign: 'left',
            padding: '3px 7px 4px', border: 'none',
            borderTop: `1px solid ${withAlpha(accentForCase(surgicalCase), 0.25)}`,
            background: 'none', ...text('micro'), textTransform: 'none',
            color: place ? colour.accentDeep : colour.inkFaint,
            fontWeight: place ? 700 : 400
          }}>
          {place ? 'Change list order' : '＋ List order'}
        </button>
      )}
    </div>
  )
}

/**
 * The week as seven columns, for a desktop.
 *
 * A phone can only read a week as a list, so that is what this was everywhere
 * — including on a 27in screen, where the same week became a very long scroll
 * of phone-width cards with most of the glass empty beside them.
 *
 * Side by side, a week reads the way a calendar reads: Thursday being heavy
 * and Tuesday being empty is visible without scrolling, which is most of what
 * somebody opens the week to find out.
 *
 * What is deliberately *not* in a column: the team leader, which is the same
 * answer seven times and is already on the strip above; the "move a case with
 * the arrows" instruction, which appeared once per hospital per day and was
 * the single noisiest thing on the screen; and the reorder arrows themselves,
 * which belong in the day view where there is room to use them.
 */
function WeekGrid({ plan, today, onOpen, onSetPlace, onPreferences, hasPreferences }) {
  return (
    <div style={{
      display: 'grid',
      // minmax(0, 1fr), not 1fr: without it a long operation name pushes its
      // column wider and the week stops being a grid.
      gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
      gap: space.sm,
      alignItems: 'start'
    }}>
      {(plan.days || []).map(day => (
        <WeekColumn key={day.date} day={day} today={today} onOpen={onOpen}
          onSetPlace={onSetPlace} onPreferences={onPreferences}
          hasPreferences={hasPreferences} />
      ))}
    </div>
  )
}

/**
 * One day of the week grid.
 *
 * Its own component because each column keeps its own running order while the
 * calendar catches up, and a hook cannot be called inside a map.
 */
function WeekColumn({ day, today, onOpen, onSetPlace, onPreferences, hasPreferences }) {
  const isToday = day.date === today
        const weekend = [0, 6].includes(new Date(`${day.date}T00:00:00Z`).getUTCDay())
        const groups = day.casesByHospital || []
        const everythingElse = [...(day.nonSurgeonItems || []), ...(day.otherRollup || [])]
        const away = everythingElse.filter(i => i.kind === 'leave')
        const alerts = (day.flags || []).filter(f =>
          ['clinicalAlert', 'kitTask'].includes(f.kind))

  return (
          // Named so a test can count seven of them. The grid is a grid by its
          // CSS, and jsdom has no layout to ask.
          <div data-week-column={day.date} style={{
            background: weekend ? 'transparent' : colour.surface,
            border: `1px solid ${isToday ? colour.accent : colour.line}`,
            borderRadius: radius.card, overflow: 'hidden'
          }}>
            <div style={{
              padding: '7px 9px',
              borderBottom: `1px solid ${colour.line}`,
              background: isToday ? colour.accentSoft : 'transparent'
            }}>
              <span style={{
                ...text('micro'), display: 'block',
                color: isToday ? colour.accentDeep : colour.inkFaint
              }}>{weekdayName(day.date)}</span>
              <span style={{
                ...text('bodyStrong'), display: 'block',
                color: isToday ? colour.accentDeep : colour.ink
              }}>{dayNum(day.date)} {monthOf(day.date).slice(0, 3)}</span>
            </div>

            <div style={{ padding: 7 }}>
              {/* The things that change the day, first and briefly. */}
              {alerts.map((flag, i) => (
                <div key={i} style={{
                  ...text('micro'), textTransform: 'none', fontWeight: 600,
                  lineHeight: 1.35, color: colour.danger, background: colour.dangerSoft,
                  border: `1px solid ${colour.dangerLine}`, borderRadius: radius.control,
                  padding: '5px 7px', marginBottom: 4
                }}>{flag.text}</div>
              ))}

              {away.map((item, i) => (
                <div key={i} style={{
                  ...text('micro'), textTransform: 'none', lineHeight: 1.35,
                  color: colour.ink, background: colour.warningSoft,
                  border: `1px solid ${colour.warningLine}`, borderRadius: radius.control,
                  padding: '4px 7px', marginBottom: 4
                }}>{item.title || item.text}</div>
              ))}

              {groups.map(group => {
                // The order the list will run in, and whether it is worth
                // numbering: one case at a hospital has no running order.
                return (
                <div key={group.hospital} style={{ marginBottom: 6 }}>
                  <div style={{
                    ...text('micro'), color: colour.inkFaint, margin: '6px 0 3px'
                  }}>
                    {group.hospital === 'CALVARY LENAH VALLEY' ? 'CALVARY' : group.hospital}
                    {' · '}{group.cases.length}
                  </div>
                  {group.cases.map(c => (
                    <WeekCase key={c.id} surgicalCase={c} onOpen={onOpen}
                      onSetPlace={onSetPlace}
                      onPreferences={onPreferences}
                      hasPreferences={hasPreferences} />
                  ))}
                </div>
                )
              })}

              {!groups.length && !away.length && !alerts.length && (
                <div style={{
                  ...text('micro'), textTransform: 'none', color: colour.inkFainter,
                  padding: '10px 0', textAlign: 'center'
                }}>—</div>
              )}
            </div>
          </div>
  )
}

/**
 * One day, whole: cases by hospital, then everything else.
 *
 * When `onReorder` is given, the cases in each hospital can be moved up and down
 * into the order that hospital's list will actually run in. That order is the
 * calendar's order — moving a case here moves the calendar entry — so there is
 * one running order and everybody is reading it.
 */

function DayPanel({ day, onOpen, onSetPlace, leader, onPreferences, hasPreferences }) {
  const groups = day.casesByHospital || []
  const everythingElse = [...(day.nonSurgeonItems || []), ...(day.otherRollup || [])]
  // Who is away is read before the list, not after it. It changes who covers
  // what, and it was sitting under the cases where you had to scroll past a
  // whole day's theatre list to find it.
  const away = everythingElse.filter(item => item.kind === 'leave')
  const others = everythingElse.filter(item => item.kind !== 'leave')
  const attention = day.needsAttention || []
  // Only on the weekdays they actually hold it. Saturday and Sunday belong to
  // the on-call rota, which is a different job and usually a different person.
  const leaderToday = leader?.firstName && withinWeek(day.date, 12) ? leader.firstName : null
  const empty = !groups.length && !others.length && !away.length
    && !attention.length && !(day.flags || []).length

  return (
    <>
      {(away.length > 0 || leaderToday) && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: space.sm
        }}>
          {/* Alongside "Brent on call" and who is away, because it is the same
              kind of fact: who is covering what, on this day. The strip at the
              top of the week answers it for the week; this answers it for the
              day somebody is actually looking at. */}
          {leaderToday && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: colour.accentSoft, border: `1px solid ${colour.accent}`,
              borderRadius: radius.pill, padding: `4px ${space.md}px`,
              ...text('bodyStrong'), color: colour.accentDeep
            }}>
              {leaderToday} — team leader
            </span>
          )}
          {away.map((item, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
              borderRadius: radius.pill, padding: `4px ${space.md}px`,
              ...text('bodyStrong'), color: colour.ink
            }}>
              {/* The title already reads "Ben - ANNUAL LEAVE", so the kind
                  label the row form carries would only say it twice. */}
              {item.title || item.text}
            </span>
          ))}
        </div>
      )}

      {/* Kit on the move is drawn like an alert on purpose. It is a thing
          somebody has to physically do, on that day, and it used to sit at the
          foot of the page under "Also on" — below the cases, which is where a
          task goes to be forgotten. */}
      {(day.flags || []).length > 0 && (
        <div style={{ marginBottom: space.sm }}>
          {day.flags.map((flag, i) => (
            <Banner key={i}
              tone={['clinicalAlert', 'kitTask'].includes(flag.kind) ? 'danger' : 'warning'}>
              {flag.text}
            </Banner>
          ))}
        </div>
      )}

      {groups.map(group => {
        const cases = group.cases
        return (
          <div key={group.hospital}>
            <Heading>{group.hospital} · {cases.length} case{cases.length === 1 ? '' : 's'}</Heading>
            {cases.map(c => (
              <CaseCard key={c.id} surgicalCase={c} onOpen={onOpen}
                onSetPlace={onSetPlace}
                onPreferences={onPreferences}
                hasPreferences={hasPreferences} />
            ))}
          </div>
        )
      })}

      {attention.length > 0 && (
        <>
          <Heading>Needs a look</Heading>
          {attention.map(item => (
            <Banner key={item.id} tone="warning">
              <strong>{item.text}</strong><br />{item.reason}
            </Banner>
          ))}
        </>
      )}

      {others.length > 0 && (
        <>
          <Heading>{groups.length ? 'Also on' : 'On today'}</Heading>
          {others.map((item, i) => <ItemRow key={i} item={item} />)}
        </>
      )}

      {empty && (
        <div style={{ textAlign: 'center', padding: `${space.xl}px ${space.md}px` }}>
          <div style={{ ...text('bodyStrong'), color: colour.ink }}>Nothing booked</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>
            This day is clear in the calendar.
          </div>
        </div>
      )}
    </>
  )
}

export default function CaseWeek({ user, switcher, promptBanner }) {
  // A week in columns on a desktop, a list on a phone — different shapes of
  // screen, different right answer.
  const desktop = useIsDesktop()
  // The booking being edited, if any. Tapping a case opens the sheet; the sheet
  // loads it fresh from the calendar rather than editing what is on screen.
  const [editing, setEditing] = useState(null)
  // The day the sheet should open on, or null when it is closed.
  const [adding, setAdding] = useState(null)
  const prefs = useMemo(() => readPrefs(), [])
  const [chosenSpan, setSpan] = useState(prefs.caseSpan === 'week' ? 'week' : 'day')
  // A desktop has one view: the week, laid out in columns. The day view was
  // built for a phone, where a week cannot fit across the glass — on a laptop
  // it is the same information in a narrower strip with six-sevenths of the
  // screen empty beside it, and nobody chose it twice.
  //
  // Forced rather than defaulted, so a phone preference carried over in
  // localStorage cannot land somebody on a view the desktop no longer offers.
  const span = desktop ? 'week' : chosenSpan
  // Always this week, never where you were last time. The app is opened to find
  // out what is on now; restoring a week somebody scrolled to yesterday means
  // the first thing it shows is wrong, and quietly so.
  const [window_, setWindow] = useState(() => resolveDefaultWeek())
  const [selectedDay, setSelectedDay] = useState(() => todayStr())
  const [plan, setPlan] = useState(() => readCachedPlan(
    (prefs.weekStart ? weekWindowFor(prefs.weekStart) : resolveDefaultWeek()).startDate)?.plan || null)
  const [status, setStatus] = useState('loading')
  const [stale, setStale] = useState(false)
  const [checkedAt, setCheckedAt] = useState(null)
  const [notice, setNotice] = useState('')
  // The case whose place on the hospital's list is being recorded.
  const [placing, setPlacing] = useState(null)
  // The guides, so a booking can be matched to one. Fetched once: it is a
  // short static list and the match happens on every card.
  const [guides, setGuides] = useState([])
  // What the preferences button opened, if anything.
  const [reading, setReading] = useState(null)
  // Who is team leader for the week on screen. Held here rather than inside
  // the strip, because the days below need it too — it belongs in the list
  // alongside "Brent on call", which is the same kind of fact.
  const [leader, setLeader] = useState(null)
  // Sub-calendars the week could not read. Leave lives on one of them, and an
  // unreadable leave calendar is indistinguishable from an empty one.
  const [sourceErrors, setSourceErrors] = useState([])
  const signature = useRef('')

  const token = user?.token

  const load = useCallback(async (win, { quiet = false } = {}) => {
    if (!quiet) setStatus('loading')
    try {
      const result = await fetchWeekPlan(win, { token, force: quiet })
      setCheckedAt(Date.now())
      setSourceErrors(result.sourceErrors || [])
      setStale(Boolean(result.error))
      // Replaced only when something visible changed, so a poll does not rebuild
      // the page every minute and lose the reader's place.
      const next = planSignature(result.plan)
      if (next !== signature.current) {
        signature.current = next
        setPlan(result.plan)
      }
      setStatus('ready')
    } catch {
      if (!quiet) setStatus('error')
      setStale(true)
    }
  }, [token])

  useEffect(() => { load(window_) }, [window_, load])
  useLiveRefresh(useCallback(() => load(window_, { quiet: true }), [window_, load]), [window_, load])

  /**
   * Writes the day's running order to the calendar.
   *
   * The hospital rings about four o'clock the afternoon before with the order
   * the list will run in. This is where that goes: the team leader moves the
   * cases into it, the calendar entries follow into one-hour blocks in the same
   * sequence, and everyone with the app open can see whether we are first up.
   */
  useEffect(() => {
    let live = true
    fetch('/api/guides', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(data => { if (live) setGuides(data.guides || []) })
      // A booking without a matching guide still offers the surgeon's card,
      // and a failure here is not worth saying anything about.
      .catch(() => {})
    return () => { live = false }
  }, [token])

  /**
   * Opens the preference card for a booking.
   *
   * One tap where there is one answer. Where the booking names both a surgeon
   * with a card and a system with a guide, the surgeon's card wins and the
   * guide is offered from inside it — the question at the bench is nearly
   * always "how does this one like it set up".
   */
  const hasPreferences = useCallback(
    surgicalCase => preferencesFor(surgicalCase, guides).any, [guides])

  const openPreferences = useCallback(surgicalCase => {
    const found = preferencesFor(surgicalCase, guides)
    if (!found.any) return
    if (found.surgeon) {
      const card = guides.find(g => g.slug === 'surgeon-preferences')
      if (card) { setReading({ guide: card, focus: found.surgeon.anchor }); return }
    }
    if (found.guide) setReading({ guide: found.guide, focus: null })
  }, [guides])

  /**
   * Records where one case sits on the hospital's list.
   *
   * Written onto the booking, so it reads the same in Google as it does here.
   * The day re-packs around it afterwards, which is why the plan is reloaded
   * rather than patched in place.
   */
  const setListPlace = useCallback(async (eventId, place) => {
    const res = await fetch('/api/calendar/today?action=listplace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ eventId, place })
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That did not save')
    await load(window_, { quiet: true })
  }, [token, load, window_])

  const leaderWeek = weekOf(window_.startDate)

  const loadLeader = useCallback(async () => {
    if (!leaderWeek) return
    try {
      const res = await fetch(`/api/calendar/today?action=leader&week=${leaderWeek}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      if (!res.ok) return
      const data = await res.json()
      // Both halves: who is on, and whether that is the rota or a cover.
      setLeader(data.leader ? { ...data.leader, source: data.source, rostered: data.rostered } : null)
    } catch {
      // A rota that will not load is not worth an error on the week view. The
      // cases underneath are what somebody came for.
    }
  }, [leaderWeek, token])

  useEffect(() => { loadLeader() }, [loadLeader])

  const setTeamLeader = useCallback(async email => {
    await fetch(`/api/calendar/today?action=leader&week=${leaderWeek}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ email })
    })
    await loadLeader()
  }, [leaderWeek, token, loadLeader])

  const remember = next => writePrefs({ ...readPrefs(), ...next })

  // The week as the Word document that gets emailed round. Loaded on demand —
  // the builder is large and most visits never export.
  async function downloadDocx() {
    setNotice('')
    try {
      const [{ buildPlanDocx }, { DOCX_FILENAME }] = await Promise.all([
        import('../clinicalPlan/exportDocx.js'),
        import('../clinicalPlan/exportMeta.js')
      ])
      const url = URL.createObjectURL(await buildPlanDocx(plan))
      const a = document.createElement('a')
      a.href = url
      a.download = DOCX_FILENAME
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setNotice(`Word export failed (${err.message}).`)
    }
  }

  const days = window_.days
  const today = todayStr()
  // The selected day has to be inside the week on screen, or stepping back a
  // week would leave the day view showing a day that is not in it.
  const activeDay = days.includes(selectedDay) ? selectedDay : days[0]
  const dayPlan = (plan?.days || []).find(d => d.date === activeDay)

  function goWeek(by) {
    const next = weekWindowFor(shiftDay(window_.startDate, by * 7))
    setWindow(next)
    setSelectedDay(next.days.includes(today) ? today : next.days[0])
  }

  function pickDay(day) {
    setSelectedDay(day)
    if (desktop) return
    setSpan('day')
    remember({ caseSpan: 'day' })
  }

  /**
   * The week containing today, and today selected in it.
   *
   * Not resolveDefaultWeek(). That answers a different question — "which week
   * should the app open on" — and from Friday onwards it answers next week, on
   * purpose, because that is the one being planned. Using it here meant that
   * from Friday to Sunday the button labelled "Back to today" set the window to
   * the week it was already showing, failed to find today in it, and fell back
   * to the first day: next Monday. It had done that every weekend since the
   * roll-forward was added.
   */
  function goToday() {
    setWindow(weekWindowFor(today))
    setSelectedDay(today)
  }

  /**
   * Whether you are already looking at today — which is a different question
   * in each view, and asking the week's one in both is the other half of why
   * this button did nothing.
   *
   * In the week view, today is on screen if the week contains it. In the day
   * view only one day is on screen, so being in the right week is not being on
   * the right day: standing on Monday of this week, the app decided you were
   * already here, hid the label, and did nothing when the button was pressed.
   */
  const atToday = span === 'day' ? activeDay === today : window_.days.includes(today)

  // How many bookings are waiting to be confirmed. Only the count is fetched
  // here — the cards themselves are read when the queue is opened, so the week
  // view does not carry patient detail it never shows.
  const [queueCount, setQueueCount] = useState(0)
  const [showQueue, setShowQueue] = useState(false)

  const countQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/today?action=queue', {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      if (!res.ok) return
      const data = await res.json()
      setQueueCount(data.count || 0)
    } catch {
      // A queue that cannot be counted is not worth interrupting the week for.
    }
  }, [user])

  useEffect(() => { countQueue() }, [countQueue])

  const caseCount = day => (day?.casesByHospital || []).reduce(
    (n, g) => n + g.cases.filter(c => !c.cancelled).length, 0)

  return (
    <Page
      // tm-wide turns off the reading measure. A measure is right for a screen
      // of prose and wrong for a week in columns — capping it is exactly what
      // leaves the gaps either side of the content.
      // Only the week. A single day stretched across a 27in screen is a row
      // of 2000px-wide cards, which is a worse answer than the bands.
      className={desktop && span === 'week' ? 'tm-wide' : ''}
      style={{ display: 'flex', flexDirection: 'column' }}>
      {/* No "This week" eyebrow any more: it said the same thing as the week
          range two rows below it, and the top of the screen had four things
          competing before the week itself appeared. */}
      <Header title="Cases" compact
        // The standing line goes on a desktop. "Every booking, as the calendar
        // has it" is true on the first open and furniture on every one after,
        // and it was costing a row of the screen the week could have had. A
        // real summary — how many cases, how many days — still earns its line.
        subtitle={plan?.summaryLine || (desktop ? undefined : 'Every booking, as the calendar has it')}
        right={!desktop && (
          <SpanToggle span={span}
            onChange={next => { setSpan(next); remember({ caseSpan: next }) }} />
        )}>
        {switcher}

        {/* Moving between weeks is the most-used control here and was the
            smallest thing on the screen. Three items now, not four — the
            Day/Week pair moved up beside the title — so the range has room to
            be read and the arrows have room to be hit. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
          <button onClick={() => goWeek(-1)} aria-label="Previous week" style={arrowStyle}>‹</button>
          <button onClick={goToday}
            aria-label={atToday ? 'Showing today' : 'Back to today'}
            style={{
              flex: 1, minWidth: 0, height: TAP, padding: `0 ${space.sm}px`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              borderRadius: radius.pill, cursor: 'pointer',
              ...text('heading'), color: 'white',
              // Nothing to go back to when you are already here, so it stops
              // looking like a button.
              border: `1px solid ${atToday ? 'transparent' : 'rgba(255,255,255,0.28)'}`,
              background: atToday ? 'transparent' : 'rgba(255,255,255,0.10)'
            }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {formatWeekRangeShort(window_.startDate, window_.endDate, today)}
            </span>
            {/* Tapping the range to come back was an affordance nobody could
                see. It only appears when there is somewhere to go back to. */}
            {!atToday && (
              <span style={{ ...text('micro'), color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>
                Back to today
              </span>
            )}
          </button>
          <button onClick={() => goWeek(1)} aria-label="Next week" style={arrowStyle}>›</button>
        </div>

        {/* Just the days. The count badges under each date went with the
            "Cases each day" label that had to explain them — the week below
            says how busy a day is by being long, and a number in a circle was
            a second, smaller way of saying the same thing. */}
        <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: '12px 12px 0 0', padding: '4px 8px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {days.map(day => {
              const on = day === activeDay
              const isToday = day === today
              const at = parseDateStr(day)
              const weekday = civilWeekday(at) - 1
              return (
                <button key={day} onClick={() => pickDay(day)}
                  aria-label={`${weekdayName(day)} ${dayNum(day)} ${monthOf(day)}`}
                  aria-current={on ? 'date' : undefined}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '5px 2px 7px', border: 'none', cursor: 'pointer',
                    borderRadius: '8px 8px 0 0',
                    background: on ? 'rgba(24,154,133,0.25)' : 'transparent',
                    borderBottom: on ? `3px solid ${colour.accent}` : '3px solid transparent'
                  }}>
                  {/* The whole name where there is room for it. Seven columns
                      of "Wednesday" do not fit across a phone. */}
                  <span style={{
                    ...text('micro'), textTransform: 'none',
                    whiteSpace: 'nowrap', overflow: 'hidden',
                    color: isToday ? colour.accent : 'rgba(255,255,255,0.55)'
                  }}>{desktop ? DAY_NAMES[weekday] : DAY_LABELS[weekday]}</span>
                  <span style={{
                    ...text('bodyStrong'), marginTop: 1,
                    color: isToday ? colour.accent : 'white'
                  }}>{ordinal(dayNum(day))}</span>
                </button>
              )
            })}
          </div>
        </div>
      </Header>

      {/* tm-measure keeps the week in one column on a wide screen while the
          page and the header behind it reach both edges — see index.css. */}
      <div className="tm-measure"
        style={{
          flex: 1, overflowY: 'auto',
          // Wider gutters on a big screen so the week is not glued to the
          // glass, and the phone's 16px where 16px is most of the width.
          padding: desktop ? `${space.md}px ${space.xl}px 100px` : `${space.md}px ${space.md}px 100px`
        }}>
        {promptBanner}
        {notice && <Banner tone="danger">{notice}</Banner>}
        {stale && (
          <Banner tone="warning">
            Not updating — showing the last plan that loaded
            {checkedAt ? ` · checked ${formatStamp(new Date(checkedAt).toISOString())}` : ''}
          </Banner>
        )}
        {status === 'loading' && !plan && (
          <div style={{ textAlign: 'center', padding: space.xl, color: colour.inkFaint }}>Loading…</div>
        )}

        {sourceErrors.map(({ source, error, shareWith }) => (
          <Banner key={source} tone="warning">
            <strong>
              {source === 'leave'
                ? 'Leave is not showing this week.'
                : `The ${source} calendar could not be read.`}
            </strong>
            <br />
            {source === 'leave'
              ? 'Nobody will appear as on leave even if they are.'
              : error}
            {shareWith && (
              <>
                <br /><br />
                In Google Calendar, open{' '}
                {source === 'leave' ? 'Staff Leave' : 'the calendar'} → Settings and sharing →
                Share with specific people, and add:
                {/* Selectable, because this is meant to be copied on a phone. */}
                <span style={{
                  display: 'block', marginTop: 4, wordBreak: 'break-all',
                  userSelect: 'text', WebkitUserSelect: 'text', fontWeight: 600
                }}>{shareWith}</span>
                with “See all event details”.
              </>
            )}
          </Banner>
        ))}

        {/* Who is on this week. It was up in the navy header with the week
            arrows, which made it look like part of the navigation rather than
            a thing you can change. Down here it sits with the other entry
            points — the inbox, adding a booking — which is what it is. */}
        <TeamLeaderStrip
          leader={leader}
          away={plan?.away || []}
          onChange={setTeamLeader}
          week={window_.startDate}
          today={today}
          hour={new Date().getHours()} />

        {/* The bookings inbox. Always in the same place, whether or not anything
            is waiting — an entry point that only appears when there is something
            behind it cannot be checked, and "did that booking come through?" is
            a question asked most often when the answer is no. */}
        <button onClick={() => setShowQueue(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: space.sm, width: '100%',
            textAlign: 'left', cursor: 'pointer', marginBottom: space.md,
            background: queueCount > 0 ? colour.warningSoft : 'transparent',
            border: `1px solid ${queueCount > 0 ? colour.warningLine : colour.line}`,
            borderRadius: radius.card, padding: queueCount > 0 ? space.md : space.sm
          }}>
          <span style={{
            ...text(queueCount > 0 ? 'bodyStrong' : 'caption'),
            color: queueCount > 0 ? colour.ink : colour.inkFaint, flex: 1
          }}>
            {queueCount > 0
              ? `${queueCount} booking${queueCount === 1 ? '' : 's'} to confirm`
              : 'Bookings inbox — nothing waiting'}
          </span>
          <span style={{ ...text('body'), color: colour.inkFaint }}>›</span>
        </button>

        {plan && span === 'day' && (
          <>
            <div style={{ marginBottom: space.md }}>
              <div style={{ ...text('title'), color: colour.ink }}>
                {activeDay === today ? 'Today' : weekdayName(activeDay)}
              </div>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>
                {dayNum(activeDay)} {monthOf(activeDay)} {parseDateStr(activeDay).year}
                {dayPlan?.caseCountLine ? ` · ${dayPlan.caseCountLine}` : ''}
              </div>
            </div>
            <AddBookingRow day={activeDay} onAdd={setAdding} />
            {dayPlan
              ? <DayPanel day={dayPlan} onOpen={setEditing}
                  onSetPlace={setPlacing} leader={leader}
                  onPreferences={openPreferences}
                  hasPreferences={hasPreferences} />
              : <div style={{ ...text('caption'), color: colour.inkFaint }}>Nothing booked.</div>}
          </>
        )}

        {plan && span === 'week' && <AddBookingRow day={activeDay} onAdd={setAdding} />}

        {/* Seven columns on a desktop, the familiar list on a phone. A week
            read side by side shows which day is heavy without scrolling, which
            is most of what somebody opens the week for. */}
        {plan && span === 'week' && desktop && (
          <WeekGrid
            plan={plan}
            today={today}
            onOpen={setEditing}
            onSetPlace={setPlacing}
            onPreferences={openPreferences}
            hasPreferences={hasPreferences} />
        )}

        {plan && span === 'week' && !desktop && (plan.days || []).map(day => (
          <div key={day.date} style={{ marginBottom: space.xl }}>
            <button onClick={() => pickDay(day.date)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'none',
                border: 'none', padding: 0, cursor: 'pointer', marginBottom: space.xs
              }}>
              <span style={{
                ...text('heading'),
                color: day.date === today ? colour.accentDeep : colour.ink
              }}>
                {day.date === today ? 'Today' : weekdayName(day.date)} {dayNum(day.date)} {monthOf(day.date)}
              </span>
              {day.caseCountLine && (
                <span style={{ ...text('caption'), display: 'block', color: colour.inkFaint }}>
                  {day.caseCountLine}
                </span>
              )}
            </button>
            {/* Orderable here too. The running order is always set for a day
                that is not today — the hospital rings about four o'clock about
                tomorrow — and the week is where anybody looks ahead. Having to
                find the day first, in a view that had no arrows, meant the one
                thing this was built for was the awkward one. */}
            <DayPanel day={day} onOpen={setEditing}
              onSetPlace={setPlacing} leader={leader}
              onPreferences={openPreferences}
              hasPreferences={hasPreferences} />
          </div>
        ))}

        {plan && (
          <button onClick={downloadDocx} aria-label="Download the week as Word"
            style={{
              ...text('caption'), color: colour.inkFaint, background: 'none',
              border: `1px solid ${colour.line}`, borderRadius: radius.control,
              padding: `${space.xs}px ${space.md}px`, cursor: 'pointer',
              marginTop: space.lg
            }}>
            Download the week as Word
          </button>
        )}

        {/* The week's own notes and key flags, which only the plan used to
            carry. `notes` is one sentence, not a list — assuming otherwise
            crashed the week view outright. */}
        {plan && span === 'week' && (plan.notes || (plan.keyFlags || []).length > 0) && (
          <>
            <Heading>Notes for the week</Heading>
            {plan.notes && (
              <div style={{ ...text('body'), color: colour.inkMuted, marginBottom: space.sm }}>
                {plan.notes}
              </div>
            )}
            {(plan.keyFlags || []).map((flag, i) => (
              <div key={i} style={{ ...text('body'), color: colour.inkMuted, marginBottom: space.xs }}>
                <strong style={{ color: colour.ink }}>{flag.label}:</strong> {flag.text}
              </div>
            ))}
          </>
        )}
      </div>

      {reading && (
        <GuideView
          guide={reading.guide}
          user={user}
          focus={reading.focus}
          onClose={() => setReading(null)} />
      )}

      {placing && (
        <ListPlace
          surgicalCase={placing}
          onSave={place => setListPlace(placing.id, place)}
          onClose={() => setPlacing(null)} />
      )}

      {adding && (
        <NewBooking
          user={user}
          date={adding}
          // What is already booked that day, so the sheet can tell when a
          // second case wants a kit there is only one of. Passed from the plan
          // already on screen rather than fetched again.
          alreadyBooked={((plan?.days || []).find(d => d.date === adding)?.casesByHospital || [])
            .flatMap(g => g.cases)
            .filter(c => !c.cancelled)}
          onClose={() => setAdding(null)}
          onCreated={() => load(window_, { quiet: true })} />
      )}

      {showQueue && (
        <BookingQueue
          user={user}
          onClose={() => { setShowQueue(false); countQueue() }}
          // A booking accepted here lands on the calendar, so the week has to be
          // read again for it to appear.
          onAccepted={() => { countQueue(); load(window_, { quiet: true }) }} />
      )}

      {editing && (
        <EditBooking
          eventId={editing.id}
          user={user}
          onClose={() => setEditing(null)}
          // Straight back to the calendar for the truth, rather than patching
          // what is on screen from the response: the plan derives a case from
          // the whole week, and a save can change how it groups.
          onSaved={() => load(window_, { quiet: true })} />
      )}
    </Page>
  )
}
