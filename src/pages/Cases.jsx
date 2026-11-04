import React from 'react'
import CaseWeek from './CaseWeek.jsx'

// ─── The Cases tab ────────────────────────────────────────────────────────────
// The bookings calendar, by day or week. The "Team lead" switch that sat in the
// header has gone to Kit → Team leader (Brent, 4 Nov 2026: "remove the team
// leader tab and incorporate that information into kits for now") — one less
// control above the cases, which is what the page is for.

export default function Cases({ user, promptBanner, spoken, onSpokenDone }) {
  return <CaseWeek user={user} promptBanner={promptBanner}
    spoken={spoken} onSpokenDone={onSpokenDone} />
}
