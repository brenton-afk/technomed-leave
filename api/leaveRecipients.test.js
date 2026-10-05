import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { adminRecipients } from './_email.js'
import { STAFF } from '../src/staffConfig.js'

// ─── Who sees a leave application ───────────────────────────────────────────
// "When leave applications are submitted they should be emailed to erin@ as
// well as brenton@."
//
// The code already said so. Production did not: EMAIL_TO_1..3 override these
// defaults, they are marked sensitive so nobody can read them back, and
// whatever was typed into Vercel months ago had quietly drifted from what the
// source claimed. An application can be submitted, recorded, acknowledged on
// screen, and never reach the person who approves it.
//
// So the roster decides, and the environment can only add.

const kept = {}
beforeEach(() => {
  for (const k of ['EMAIL_TO_1', 'EMAIL_TO_2', 'EMAIL_TO_3']) {
    kept[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const [k, v] of Object.entries(kept)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const lower = list => list.map(a => a.toLowerCase())

describe('adminRecipients', () => {
  it('always includes Erin and Brenton', () => {
    expect(lower(adminRecipients())).toEqual(
      expect.arrayContaining(['erin@technomed.com.au', 'brenton@technomed.com.au']))
  })

  it('includes them even when the environment names somebody else entirely', () => {
    // The actual failure: an env var pointing somewhere that is not Erin.
    process.env.EMAIL_TO_1 = 'someone-else@example.com'
    process.env.EMAIL_TO_2 = 'another@example.com'
    const to = lower(adminRecipients())
    expect(to).toContain('erin@technomed.com.au')
    expect(to).toContain('brenton@technomed.com.au')
    expect(to).toContain('someone-else@example.com')
  })

  it('is everyone the roster marks as admin, and nobody else', () => {
    // The same flag that gates the admin portal where leave is approved —
    // so the mail and the screen cannot disagree about who approves.
    const admins = lower(STAFF.filter(s => s.isAdmin).map(s => s.email))
    expect(lower(adminRecipients()).sort()).toEqual(admins.sort())
  })

  it('does not send the same person two copies', () => {
    process.env.EMAIL_TO_1 = 'ERIN@technomed.com.au'
    const to = lower(adminRecipients())
    expect(to.filter(a => a === 'erin@technomed.com.au')).toHaveLength(1)
  })

  it('still lets the environment add a shared inbox', () => {
    process.env.EMAIL_TO_3 = 'bookings@technomed.com.au'
    expect(lower(adminRecipients())).toContain('bookings@technomed.com.au')
  })

  it('ignores an empty or unset variable rather than mailing nowhere', () => {
    process.env.EMAIL_TO_1 = ''
    expect(adminRecipients().every(Boolean)).toBe(true)
  })
})
