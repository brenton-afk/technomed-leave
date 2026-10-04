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

export default function TeamLeaderStrip({ user, week, today, hour }) {
  const monday = weekOf(week) || weekOf(today)
  const [leader, setLeader] = useState(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}

  const load = useCallback(async () => {
    if (!monday) return
    try {
      const res = await fetch(`/api/calendar/today?action=leader&week=${monday}`, { headers: auth })
      if (!res.ok) return
      const data = await res.json()
      setLeader(data.leader || null)
    } catch {
      // A rota that will not load is not worth an error on a week view. The
      // cases underneath it are what somebody came for.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday, user?.token])

  useEffect(() => { load() }, [load])

  async function choose(email) {
    setBusy(true)
    // Shown straight away. A rota set with a tap should feel like a tap.
    setLeader(email ? STAFF.find(s => s.email === email) : null)
    setOpen(false)
    try {
      await fetch(`/api/calendar/today?action=leader&week=${monday}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ email })
      })
      await load()
    } catch {
      await load()
    }
    setBusy(false)
  }

  // Whether the week being looked at is the one running now. On a future week
  // the leader is an arrangement rather than a fact, and saying "Ben is team
  // leader" about next week would be a small lie.
  const thisWeek = monday === weekOf(today)
  const onDuty = thisWeek && withinWeek(today, hour)

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={busy}
        style={{
          display: 'flex', alignItems: 'center', gap: space.sm, width: '100%',
          textAlign: 'left', cursor: 'pointer', marginBottom: space.sm,
          background: 'rgba(255,255,255,0.10)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: radius.pill, padding: `6px ${space.md}px`,
          opacity: busy ? 0.6 : 1
        }}>
        <span style={{
          ...text('micro'), textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)'
        }}>
          {thisWeek ? 'Team leader' : 'Team leader, that week'}
        </span>
        <span style={{ ...text('bodyStrong'), color: 'white', flex: 1, minWidth: 0 }}>
          {leader?.firstName || leader?.name || 'Nobody set'}
        </span>
        {/* Only while they are actually on. Outside Monday seven to Friday
            five the weekend belongs to the on-call rota, which is a different
            job and a different person. */}
        {onDuty && (
          <span style={{
            ...text('micro'), textTransform: 'uppercase', color: colour.accent
          }}>On now</span>
        )}
        <span style={{ ...text('caption'), color: 'rgba(255,255,255,0.5)' }}>Change</span>
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
                </div>
              </div>

              <div style={{ padding: space.md, overflowY: 'auto', flex: 1 }}>
                {STAFF.filter(s => s.isClinicalTeam || s.division === 'Spine').map(person => {
                  const on = leader?.email === person.email
                  return (
                    <button key={person.email} onClick={() => choose(person.email)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: space.md, width: '100%',
                        textAlign: 'left', cursor: 'pointer', marginBottom: space.sm,
                        minHeight: 52, padding: `0 ${space.md}px`, borderRadius: radius.card,
                        border: `1.5px solid ${on ? colour.accent : colour.line}`,
                        background: on ? colour.accentSoft : colour.surface
                      }}>
                      <span style={{ flex: 1, ...text('bodyStrong'), color: colour.ink }}>
                        {person.firstName}
                        <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}>
                          {' · '}{person.role}
                        </span>
                      </span>
                      {on && <span style={{ ...text('bodyStrong'), color: colour.accentDeep }}>✓</span>}
                    </button>
                  )
                })}

                <button onClick={() => choose(null)}
                  style={{
                    width: '100%', minHeight: 44, marginTop: space.sm, cursor: 'pointer',
                    borderRadius: radius.control, border: `1px solid ${colour.line}`,
                    background: 'transparent', ...text('caption'), color: colour.inkMuted
                  }}>
                  Nobody this week
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
    </>
  )
}
