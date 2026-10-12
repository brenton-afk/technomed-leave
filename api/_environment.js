// ─── Which deployment this is ────────────────────────────────────────────────
// The brief asked this to "respect the api/_environment.js guard so preview
// deployments don't write to the real calendar". There was no such file — the
// repo has had no need to tell a preview from production until now, because
// nothing ran on a schedule against a shared resource. So here it is, and this
// is its first caller.
//
// The problem it exists for: every push opens a preview deployment, and a
// preview shares the production environment variables. A cron is not invoked on
// a preview, but the admin portal's "Sync now" button is reachable there, and a
// preview writing public holidays into the real bookings calendar is a mess
// somebody has to clean out of Google by hand.
//
// Reading rather than writing is fine from anywhere, so the guard is placed at
// the point of writing and not at the door.

/**
 * Vercel's own answer: 'production', 'preview' or 'development'.
 *
 * Absent when running locally outside the Vercel CLI, and in the test suite.
 */
export function deployment() {
  return process.env.VERCEL_ENV || 'development'
}

/**
 * Whether this deployment may write to the shared Google calendar.
 *
 * Production only. Not "anything that is not a preview": an unset VERCEL_ENV
 * means somebody is running it on a laptop, which is exactly when a mistake is
 * least expected and least noticed.
 *
 * `ALLOW_CALENDAR_WRITES=1` overrides it, for deliberately testing a write from
 * a preview. Named so that it reads as a decision in the Vercel settings rather
 * than as a flag somebody flipped and forgot — and it has to be removed again,
 * which a comment cannot enforce but a name can at least ask for.
 */
export function mayWriteToSharedCalendar() {
  if (process.env.ALLOW_CALENDAR_WRITES === '1') return true
  return deployment() === 'production'
}

/**
 * Why not, in words the admin portal can show.
 *
 * Null where it may. A refusal that does not say what it was is the kind that
 * gets reported as "the button does nothing".
 */
export function whyNoCalendarWrites() {
  if (mayWriteToSharedCalendar()) return null
  return `This is the ${deployment()} deployment, so nothing was written to the `
    + 'bookings calendar. Set ALLOW_CALENDAR_WRITES=1 on this deployment to '
    + 'let it write, or run the sync from production.'
}
