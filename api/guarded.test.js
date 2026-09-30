import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// ─── Every route says who may reach it ───────────────────────────────────────
// Two endpoints ran for months with no session check at all: the meeting agent,
// which holds recordings, their transcripts and the shared worklist, and the
// leave submission, which would file an application in a staff member's name
// for anybody who knew the URL. Neither was noticed because nothing looks wrong
// about a working endpoint — it answers, and it answers everybody.
//
// So the list is explicit. A route is either guarded or named below with the
// reason, and adding a new one without either fails here rather than sitting
// open until somebody thinks to audit it again.

const ROOT = join(__dirname, '..')

// Routes that legitimately cannot use a session, each with what protects it.
//
// `wholly: true` means nothing in the file is behind a session, so finding a
// session check there means the exemption has gone stale and should be deleted.
// The sign-in routes are mixed on purpose — signing in cannot require being
// signed in, while changing a PIN must — so they are not held to that.
const EXEMPT = {
  // The PIN screen itself. Guarding sign-in with a sign-in is a closed loop.
  'api/auth/pin.js': { why: 'is the sign-in' },
  'api/auth/passkey.js': { why: 'is the sign-in' },
  // Vercel invokes this on a schedule with no user attached. It checks the
  // CRON_SECRET signature instead, and refuses outright when none is set.
  'api/cron/timesheet-reminder.js': { why: 'signed with CRON_SECRET, fails closed', wholly: true },
  // Xero redirects the browser here after consent, so there is no header of
  // ours on the request. Protected by the OAuth `state` — which is currently a
  // fixed string rather than a nonce, and is the next thing to fix here.
  'api/xero/callback.js': { why: 'OAuth redirect target; see the note about `state`', wholly: true },
  'api/xero/connect.js': { why: 'starts the OAuth redirect; see the note about `state`', wholly: true }
}

function routes(dir = 'api') {
  const found = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...routes(path))
    // Files starting with _ are shared helpers, not routes.
    else if (entry.name.endsWith('.js') && !entry.name.startsWith('_')
      && !entry.name.includes('.test.')) found.push(path)
  }
  return found
}

describe('every API route', () => {
  const all = routes()

  it('finds the routes, so this test is testing something', () => {
    expect(all.length).toBeGreaterThan(8)
  })

  for (const path of all) {
    const exempt = EXEMPT[path]
    it(exempt ? `${path} is exempt — ${exempt.why}` : `${path} checks the session`, () => {
      const source = readFileSync(join(ROOT, path), 'utf8')
      if (exempt) {
        // An exemption is a claim about the file. Where the claim is that none
        // of it is guarded, finding a guard means the claim has gone stale.
        if (exempt.wholly) {
          expect(source, `${path} is listed as wholly exempt but now checks a `
            + 'session — remove it from EXEMPT').not.toMatch(/requireSession|requireAdmin/)
        }
        return
      }
      expect(source, `${path} is reachable by anyone who knows the URL. `
        + 'Guard it with requireSession/requireAdmin, or add it to EXEMPT with the reason.')
        .toMatch(/requireSession|requireAdmin|getSession/)
    })
  }
})
