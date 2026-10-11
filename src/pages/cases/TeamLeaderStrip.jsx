import React, { useState, useEffect, useCallback } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { STAFF } from '../../staffConfig.js'
import { weekOf, withinWeek } from '../../clinicalPlan/teamLeader.js'

// ─── Who is team leader this week ────────────────────────────────────────────
// It used to be a calendar entry somebody had to remember to move, so it
// drifted — Mat was showing as team leader through a week he spent on TOIL.
//
// Anyone on the team can change it. Not admin-only on purpose: the person who
// knows the rota has changed is usually the one it changed to, and making them
// ask somebody else is how a rota goes stale in the first place.
//
// It sits on the week, because that is the screen the duty leader lives on and
// the question "who is it this week" is asked while looking at the week.

/** 2026-10-19 → 19 Oct. The week, said the way somebody would say it. */
function shortDate(day) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  return m ? `${Number(m[3])} ${months[Number(m[2]) - 1]}` : ''
}

export default function TeamLeaderStrip({ leader, away = [], onChange, week, today, hour }) {
  const monday = weekOf(week) || weekOf(today)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Set as leader and on leave the same week. Two facts the app held at once
  // and never compared, which is how Mat was Spine Team Leader through a week
  // he spent on TOIL.
  const isAway = email => away.some(p => p.email === email)
  const leaderAway = leader?.email && isAway(leader.email)
  // Somebody other than whoever the standing rota names.
  const covering = leader?.source === 'set'
    && leader?.rostered && leader.rostered.email !== leader.email

  async function choose(email) {
    setBusy(true)
    setOpen(false)
    await Promise.resolve(onChange(email)).catch(() => {})
    setBusy(false)
  }

  // Whether the week being looked at is the one running now. On a future week
  // the leader is an arrangement rather than a fact, and saying "Ben is team
  // leader" about next week would be a small lie.
  const thisWeek = monday === weekOf(today)
  const onDuty = thisWeek && withinWeek(today, hour)

  // "It shouldn't say 'Team leader, that week'. That doesn't make sense."
  //
  // It was trying to say "the leader of the week you are looking at, which is
  // not the week you are in" — a distinction worth drawing and not worth that
  // sentence. The week says which week instead, which is the thing a reader
  // actually wanted to know.
  const label = thisWeek ? 'Team leader' : `Team leader · w/c ${shortDate(monday)}`

  // "Team leader is listed at the top and gets missed, make it with a green
  // outline or similar to make it clear."
  //
  // It was a grey hairline the same as everything else on the page, which is
  // what made it furniture. Green where somebody is set, amber where they are
  // set and away — the warning still wins, because a leader on leave is the
  // state worth noticing above all the others.
  const tone = leaderAway
    ? { line: colour.warningLine, fill: colour.warningSoft }
    : leader
      ? { line: colour.accent, fill: colour.accentSoft }
      : { line: colour.line, fill: 'transparent' }

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={busy}
        // The word "Change" used to sit at the end of the row and carry this.
        // It became a chevron to match the other cards, so the button has to
        // say what it does somewhere a screen reader can reach.
        aria-label={`Team leader: ${leader?.firstName || leader?.name || 'nobody set'}. Change.`}
        style={{
          display: 'flex', alignItems: 'center', gap: space.sm, width: '100%',
          textAlign: 'left', cursor: 'pointer', marginBottom: space.md,
          // Matched to the bookings inbox below it. This used to be white on
          // navy because it sat in the header; on the page it has to be a
          // card like the other things you can open from here.
          background: tone.fill,
          // Two pixels, not one. A hairline in the accent colour reads as the
          // same grey card from arm's length, which is where this is read.
          border: `2px solid ${tone.line}`,
          borderRadius: radius.card, padding: space.sm,
          opacity: busy ? 0.6 : 1
        }}>
        <span style={{
          ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint
        }}>
          {label}
        </span>
        <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1, minWidth: 0 }}>
          {leader?.firstName || leader?.name || 'Nobody set'}
          {/* Said out loud, because "Brent is covering for Mat" and "it is
              Brent's turn" are different facts and the second is not true. */}
          {covering && (
            <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}>
              {' '}covering for {leader.rostered.firstName}
            </span>
          )}
        </span>
        {/* Only while they are actually on. Outside Monday seven to Friday
            five the weekend belongs to the on-call rota, which is a different
            job and a different person. */}
        {leaderAway && (
          <span style={{
            ...text('micro'), textTransform: 'uppercase', color: colour.warning
          }}>On leave</span>
        )}
        {onDuty && !leaderAway && (
          <span style={{
            ...text('micro'), textTransform: 'uppercase', color: colour.accent
          }}>On now</span>
        )}
        <span style={{ ...text('body'), color: colour.inkFaint }}>›</span>
      </button>

      {open && (
        <Overlay>
          <div onClick={() => setOpen(false)} style={{
            position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
          }}>
            <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Team leader"
              className="tm-sheet"
              style={{
                background: colour.canvas, width: '100%', maxWidth: 460,
                borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
                display: 'flex', flexDirection: 'column'
              }}>
              <div style={{
                padding: `${space.md}px ${space.md}px ${space.sm}px`,
                borderBottom: `1px solid ${colour.line}`
              }}>
                <div style={{ ...text('heading'), color: colour.ink }}>Team leader</div>
                <div style={{ ...text('caption'), color: colour.inkFaint }}>
                  Monday 7am to Friday 5pm · week of {monday}
                  {leader?.rostered && (
                    <> · rostered: <strong>{leader.rostered.firstName}</strong></>
                  )}
                </div>
              </div>

              <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
                {leaderAway && (
                  <div style={{
                    background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
                    borderRadius: radius.control, padding: space.sm, marginBottom: space.sm,
                    ...text('caption'), color: colour.ink, lineHeight: 1.5
                  }}>
                    {leader.firstName} is on leave this week. Somebody else needs it.
                  </div>
                )}

                {STAFF.filter(s => s.isClinicalTeam || s.division === 'Spine').map(person => {
                  const on = leader?.email === person.email
                  const unavailable = isAway(person.email)
                  return (
                    <button key={person.email} onClick={() => choose(person.email)}
                      // Not disabled. Somebody taking a day of their leave back
                      // to cover is a real thing, and an app that refuses it
                      // outright is an app people work around. It says so
                      // instead, which is what was missing.
                      style={{
                        display: 'flex', alignItems: 'center', gap: space.md, width: '100%',
                        textAlign: 'left', cursor: 'pointer', marginBottom: space.sm,
                        minHeight: 52, padding: `0 ${space.md}px`, borderRadius: radius.card,
                        border: `1.5px solid ${on ? colour.accent : colour.line}`,
                        background: on ? colour.accentSoft : colour.surface,
                        opacity: unavailable && !on ? 0.55 : 1
                      }}>
                      <span style={{ flex: 1, ...text('bodyStrong'), color: colour.ink }}>
                        {person.firstName}
                        <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}>
                          {' · '}{unavailable ? 'on leave this week' : person.role}
                        </span>
                      </span>
                      {on && <span style={{ ...text('bodyStrong'), color: colour.accentDeep }}>✓</span>}
                    </button>
                  )
                })}

                {/* Clearing a cover puts the rota back, rather than leaving
                    the week with nobody on it. A standing rota means there is
                    always an answer unless somebody says otherwise. */}
                <button onClick={() => choose(null)}
                  style={{
                    width: '100%', minHeight: 44, marginTop: space.sm, cursor: 'pointer',
                    borderRadius: radius.control, border: `1px solid ${colour.line}`,
                    background: 'transparent', ...text('caption'), color: colour.inkMuted
                  }}>
                  {leader?.rostered
                    ? `Back to the roster — ${leader.rostered.firstName}`
                    : 'Nobody this week'}
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
    </>
  )
}
