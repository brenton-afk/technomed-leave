import React, { useState, useCallback } from 'react'
import CaseWeek from './CaseWeek.jsx'
import TeamLeader from './TeamLeader.jsx'
import { readPrefs, writePrefs } from '../clinicalPlan/provider.js'
import { colour, text, radius } from '../design/tokens.js'

// ─── The Cases tab ────────────────────────────────────────────────────────────
// Two ways of reading the same bookings calendar, and the choice between them.
//
// The calendar view lived in the Kit tab, which was wrong twice over: it is not
// kit, and it meant the two views of the week were two tabs apart with no way to
// tell they were the same data. Both are here now.
//
//   Cases      the whole week from the bookings calendar, day or week at a time
//   Team lead  the duty leader's playbook, and the day's shared run-sheet
//
// There were three. Calendar and Case plan were built at different times and by
// the end most of each was the other one: two readings of the same bookings, so
// every improvement had to be made twice or they drifted — which is how the
// calendar view went a month without refreshing while the plan polled fine.
// They are one view now.
//
// Each keeps its own period control, and that is deliberate rather than untidy:
// the two answer different questions and are read at different moments. The
// switch chooses *how* to read the week; the control inside chooses *which* part
// of it. Collapsing them into one three-way toggle would put "Week" and "Plan"
// side by side as if they were alternatives of the same kind, which they are not.

const MODES = [
  { id: 'cases', label: 'Cases' },
  { id: 'lead', label: 'Team lead' }
]

/**
 * Rendered inside each screen's own navy header, so the switch sits in the same
 * place whichever view is showing and moving between them does not move it.
 */
function ModeSwitch({ mode, onChange }) {
  return (
    <div role="tablist" aria-label="How to view the week" style={{
      display: 'flex', gap: 4, padding: 3, marginBottom: 12,
      background: 'rgba(255,255,255,0.12)', borderRadius: radius.pill
    }}>
      {MODES.map(({ id, label }) => {
        const on = mode === id
        return (
          <button key={id} role="tab" aria-selected={on} onClick={() => onChange(id)}
            style={{
              flex: 1, padding: '7px 12px', border: 'none', borderRadius: radius.pill,
              background: on ? 'white' : 'transparent',
              color: on ? colour.navy : 'rgba(255,255,255,0.75)',
              ...text('bodyStrong'), cursor: 'pointer'
            }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

export default function Cases({ user, promptBanner }) {
  // Remembered, because which view someone reads the week in is a habit rather
  // than a decision. Stored with the plan's other preferences.
  const [mode, setMode] = useState(() => {
    const saved = readPrefs().casesMode
    // 'calendar' and 'plan' are the two that merged; anyone whose saved
    // preference is either lands on the view that replaced them.
    return MODES.some(m => m.id === saved) ? saved : 'cases'
  })

  const change = useCallback(next => {
    setMode(next)
    writePrefs({ ...readPrefs(), casesMode: next })
  }, [])

  const switcher = <ModeSwitch mode={mode} onChange={change} />

  if (mode === 'lead') return <TeamLeader user={user} switcher={switcher} />
  return <CaseWeek user={user} switcher={switcher} promptBanner={promptBanner} />
}
