import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Task 1: outgoing email ──────────────────────────────────────────────────
// Every outgoing email was failing in production with a Resend 403. Two faults,
// and only one of them was a bug:
//
//   · EMAIL_FROM pointed at Resend's test address, which can only deliver to
//     the Resend account owner. Configuration, fixed in Vercel.
//   · A rejected sender was quietly retried as the fallback and reported as a
//     success. Toni: "distributors must be able to reply directly to a usage
//     email, so a noreply sender is not acceptable."

const stored = []

vi.mock('./_redis.js', () => ({
  saveEmailLogEntry: vi.fn(async e => { stored.push(e) }),
  getEmailLog: vi.fn(async () => [...stored])
}))

const email = await import('./_email.js')
const { recordEmail, scrubDetail, readEmailLog } = await import('./_emailLog.js')

const BEN = { name: 'Ben Cassidy', email: 'ben@technomed.com.au' }

let posted

beforeEach(() => {
  stored.length = 0
  posted = []
  process.env.RESEND_API_KEY = 'test-key'
  process.env.EMAIL_FROM = 'TechnoMed Portal <portal@technomed.com.au>'
  global.fetch = vi.fn(async (url, init) => {
    posted.push(JSON.parse(init.body))
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'msg_123' }) }
  })
})

afterEach(() => vi.restoreAllMocks())

const usage = (over = {}) => email.sendUsageEmail({
  to: ['orders@signus.com.au'],
  subject: 'A case folder name',
  xlsx: Buffer.from('x'),
  xlsxFilename: 'usage.xlsx',
  sender: BEN,
  caseId: 'case-1',
  ...over
})

describe('who an email comes from', () => {
  it('sends a usage as the rep who was in the theatre', async () => {
    // The whole point: a distributor hitting reply reaches Ben, not an inbox.
    expect(email.fromAddress(BEN)).toBe('Ben Cassidy <ben@technomed.com.au>')
  })

  it('sends everything else as the portal', async () => {
    expect(email.fromAddress(null)).toBe('TechnoMed Portal <portal@technomed.com.au>')
  })

  it('will not send as somebody off the verified domain', async () => {
    // A contractor or a mistyped address falls back to the portal rather than
    // producing a send Resend will refuse.
    expect(email.fromAddress({ name: 'Someone', email: 'someone@gmail.com' }))
      .toBe('TechnoMed Portal <portal@technomed.com.au>')
  })

  it('refuses to send at all when EMAIL_FROM is Resend’s test address', async () => {
    // The production fault, caught before Resend sees it — the message Resend
    // gives for this reads like a broken feature rather than a setting.
    process.env.EMAIL_FROM = 'TechnoMed Portal <onboarding@resend.dev>'
    expect(() => email.fromAddress(null)).toThrow(/Email not sent/)
    try {
      email.fromAddress(null)
    } catch (err) {
      expect(err.detail).toMatch(/resend\.dev/)
      expect(err.detail).toMatch(/can only deliver to the Resend account owner/)
    }
  })

  it('says what is wrong when EMAIL_FROM is not set at all', async () => {
    delete process.env.EMAIL_FROM
    try {
      email.fromAddress(null)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.detail).toMatch(/EMAIL_FROM is not set/)
    }
  })

  it('cannot have a display name break out into a second address', async () => {
    expect(email.fromAddress({ name: 'Ben <evil@elsewhere.com>', email: 'ben@technomed.com.au' }))
      .toBe('Ben evilelsewhere.com <ben@technomed.com.au>')
  })
})

describe('what staff are shown when it fails', () => {
  it('never shows raw Resend JSON', async () => {
    // Exactly what the screenshots showed: a 403 body, on a phone.
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => '{"statusCode":403,"message":"The technomed.com.au domain is not verified"}'
    }))
    await expect(usage()).rejects.toThrow('Email not sent — please contact Brenton.')
  })

  it('keeps the real cause, out of sight', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 403, text: async () => 'domain is not verified'
    }))
    try {
      await usage()
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.message).not.toMatch(/403|statusCode|\{/)
      expect(err.detail).toMatch(/Resend 403/)
    }
  })

  it('does not quietly send as somebody else instead', async () => {
    // The removed behaviour. A send that silently becomes something the
    // recipient cannot reply to has not succeeded.
    let attempts = 0
    global.fetch = vi.fn(async () => {
      attempts += 1
      return { ok: false, status: 403, text: async () => 'not verified' }
    })
    await expect(usage()).rejects.toThrow()
    expect(attempts).toBe(1)
  })
})

// ─── No second copy of a usage, anywhere ─────────────────────────────────────
// A silent Bcc to an archive mailbox was built and then removed, by Brent:
//
//   "Don't send an archive copy of usage emails to usage@ or bookings@. The
//    Admin → Email log is the record that a usage was sent; the usage documents
//    themselves stay in Dropbox as the system of record."
//
// Which is the rule that was already written down on 4 October — Dropbox is the
// store of record and the app never keeps a copy — and a mailbox full of
// attachments is exactly the second copy that rule exists to prevent. Two
// copies means "has this been filed?" has two answers that drift apart.
describe('what a usage email copies to', () => {
  it('sends a silent copy to nobody', async () => {
    await usage()
    expect(posted[0].bcc).toBeUndefined()
  })

  it('goes only to the distributor it is for', async () => {
    await usage()
    expect(posted[0].to).toEqual(['orders@signus.com.au'])
    expect(posted[0].cc).toBeUndefined()
  })

  it('still carries the rep as reply-to', async () => {
    await usage()
    expect(posted[0].reply_to).toBe('ben@technomed.com.au')
  })

  it('records that it went without keeping what went', async () => {
    // The log is the proof a usage was sent. The documents live in Dropbox,
    // and nothing about the attachments is stored here.
    await usage()
    const row = JSON.stringify(stored[0])
    expect(stored[0]).toMatchObject({ kind: 'usage', status: 'sent' })
    expect(row).not.toMatch(/xlsx|pdf|attachment|base64/i)
  })
})

describe('the sent-email log', () => {
  it('records a successful send with Resend’s id', async () => {
    await usage()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      kind: 'usage',
      status: 'sent',
      messageId: 'msg_123',
      sentByEmail: 'ben@technomed.com.au',
      caseId: 'case-1'
    })
  })

  it('records a failure too, which is the one people ask about', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 403, text: async () => 'not verified'
    }))
    await expect(usage()).rejects.toThrow()
    expect(stored[0]).toMatchObject({ kind: 'usage', status: 'failed' })
    expect(stored[0].detail).toMatch(/Resend 403/)
  })

  it('never stores the subject, because it is a patient surname', async () => {
    // The subject of a usage email is the case folder name, and that is built
    // from the patient's surname. It is the one field that looks obviously
    // useful and cannot be kept.
    await usage({ subject: 'Mardon_21-09-26_Fowler_PLIF_RHH' })
    const row = JSON.stringify(stored[0])
    expect(row).not.toMatch(/Mardon/)
    expect(stored[0].subject).toBeUndefined()
  })

  it('does not let a quoted surname through in an error either', async () => {
    // Resend quotes the request back in some errors.
    expect(scrubDetail('rejected: "Mardon_21-09-26_Fowler" is invalid'))
      .toBe('rejected: "…" is invalid')
  })

  it('keeps the link back to the case, rather than the patient', async () => {
    await usage()
    expect(stored[0].caseId).toBe('case-1')
  })

  it('never fails a send', async () => {
    // A log that can fail a send is worse than no log — the exception would be
    // raised after Resend had already accepted the message.
    const redis = await import('./_redis.js')
    redis.saveEmailLogEntry.mockRejectedValueOnce(new Error('Upstash down'))
    await expect(usage()).resolves.toMatchObject({ sent: true })
  })

  it('reads back newest first', async () => {
    await recordEmail({ kind: 'leave', status: 'sent', at: '2026-11-01T01:00:00.000Z' })
    await recordEmail({ kind: 'usage', status: 'sent', at: '2026-11-01T03:00:00.000Z' })
    const log = await readEmailLog()
    expect(log[0].kind).toBe('usage')
  })
})

describe('every kind of email goes through one sender', () => {
  it('sends meeting minutes as the portal, not Resend’s test address', async () => {
    // This one built its own Resend request with onboarding@resend.dev
    // hard-coded, so it was refused for eight of nine staff whatever
    // EMAIL_FROM said.
    await email.sendMeetingSummaryEmail(
      { name: 'Toni Hoppitt', email: 'toni@technomed.com.au' },
      { title: 'Spine weekly', date: '2026-11-02', summary: 'We met.' },
      [])
    expect(posted[0].from).toBe('TechnoMed Portal <portal@technomed.com.au>')
    expect(posted[0].from).not.toMatch(/resend\.dev/)
  })

  it('logs the meeting email like any other', async () => {
    await email.sendMeetingSummaryEmail(
      { name: 'Toni Hoppitt', email: 'toni@technomed.com.au' },
      { title: 'Spine weekly', date: '2026-11-02', summary: 'We met.' },
      [])
    expect(stored[0]).toMatchObject({ kind: 'meeting', status: 'sent' })
  })

  it('tags a leave email as leave', async () => {
    await email.sendApprovalEmail({
      name: 'Ben Cassidy', email: 'ben@technomed.com.au', leaveType: 'annual',
      division: 'Spine', startDate: '2026-12-01', endDate: '2026-12-05',
      returnDate: '2026-12-08', reason: 'Holiday', hours: 38
    })
    expect(stored[0].kind).toBe('leave')
  })
})

describe('a leave application being lodged (Task 13)', () => {
  const APP = {
    name: 'Toni Hoppitt', email: 'toni@technomed.com.au', division: 'Operations',
    startDate: '2026-11-04', endDate: '2026-11-05', returnDate: '2026-11-09',
    leaveType: 'ANNUAL_LEAVE', reason: 'Family'
  }

  it('goes to Erin, the one approver, and nobody else', async () => {
    await email.sendNotificationEmail(APP)
    expect(posted[0].to).toEqual(['erin@technomed.com.au'])
  })

  it('carries a working link straight to the approvals screen', async () => {
    await email.sendNotificationEmail(APP)
    expect(posted[0].html).toContain('href="https://leave.technomed.com.au/?go=approvals"')
    expect(posted[0].html).toMatch(/Approve or decline/)
    expect(posted[0].text).toContain('https://leave.technomed.com.au/?go=approvals')
  })

  it('names the dates and the type in what she reads', async () => {
    await email.sendNotificationEmail(APP)
    expect(posted[0].subject).toBe('Leave to approve — Toni Hoppitt (Annual Leave)')
    expect(posted[0].html).toMatch(/Wed(nesday)?,? 4 Nov/)
  })
})
