import { describe, it, expect, vi, beforeEach } from 'vitest'

// "Click on a booking … that has a distributor loan set booked and it
// automatically shows you the information pertaining to the loan set …
// including extracted data from the email trail." Invented people and cases.

const store = new Map()
const mailboxes = {}
const searches = []

vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key, value) => {
    if (cmd === 'set') store.set(key, value)
    if (cmd === 'get') return store.get(key) || null
    return null
  })
}))
vi.mock('./_gmail.js', () => ({
  addressOf: v => String(v || '').replace(/.*</, '').replace(/>.*/, '').trim().toLowerCase(),
  searchMailboxOf: vi.fn(async (mailbox, query) => { searches.push({ mailbox, query }); return Object.keys(mailboxes[mailbox] || {}) }),
  readMessageHeadline: vi.fn(async (mailbox, id) => ({ mailbox, id, ...mailboxes[mailbox][id] })),
  readAttachment: vi.fn(async () => ({ data: 'JVBERi0xLjQK', mediaType: 'application/pdf' }))
}))
vi.mock('./_anthropic.js', () => ({
  AiUnavailable: class extends Error {},
  askClaude: vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({
    status: 'confirmed', summary: 'Requested by Brent on 2 Nov. Device confirmed the next day.',
    facts: [{ label: 'Arriving', value: 'CLV Wed 11 Nov, 9am' }, { label: 'Con note', value: 'TT12345' }]
  }) }] }))
}))

const { trailQuery, freshText, loanTrail, attachmentFor, mailboxesToSearch } = await import('./_loanTrail.js')

const REQUEST = {
  messageId: '<req-1@technomed.com.au>', from: 'Brenton Lovering <brenton@technomed.com.au>',
  subject: 'Loan set request — Mariner MIS — CLV 12/11/2026 — Pt Testa', receivedAt: '2026-11-02T03:00:00Z',
  text: 'Please send the Mariner MIS loan set.', attachments: []
}
const REPLY = {
  messageId: '<re-1@device.com.au>', from: 'DL VIC Loans <DL_VICLoans@device.com.au>',
  subject: 'RE: Loan set request — Mariner MIS', receivedAt: '2026-11-03T01:00:00Z',
  text: 'Confirmed, arriving Wed 9am. Con note TT12345. Tray list attached.\n\nOn Mon, 2 Nov 2026 Brent wrote:\n> Please send the Mariner MIS loan set.',
  attachments: [{ filename: 'Mariner MIS tray list.pdf', mediaType: 'application/pdf', attachmentId: 'att-1', size: 52000 }]
}

beforeEach(() => {
  store.clear(); searches.length = 0
  for (const k of Object.keys(mailboxes)) delete mailboxes[k]
})

describe('the search', () => {
  it('is always the distributor, the surname and a window around the surgery', () => {
    const q = trailQuery({ distributor: 'device', surname: 'Testa', date: '2026-11-12' })
    expect(q).toBe('(from:device.com.au OR to:device.com.au OR cc:device.com.au) "Testa" after:2026/09/13 before:2026/11/27')
  })
  it('is not run at all without a surname or a date', () => {
    expect(trailQuery({ distributor: 'device', surname: '', date: '2026-11-12' })).toBeNull()
    expect(trailQuery({ distributor: 'device', surname: 'Testa', date: '' })).toBeNull()
    expect(trailQuery({ distributor: 'unknown', surname: 'Testa', date: '2026-11-12' })).toBeNull()
  })
  it('covers the bookings inbox and every member of the team', () => {
    const list = mailboxesToSearch()
    expect(list[0]).toBe('bookings@technomed.com.au')
    expect(list).toContain('aimee@technomed.com.au')
  })
})

describe('the trail', () => {
  it('finds both sides, shows a copied email once, summarises, and hands out an attachment link', async () => {
    mailboxes['bookings@technomed.com.au'] = { a: REQUEST, b: REPLY }
    mailboxes['brenton@technomed.com.au'] = { c: REPLY }
    const [set] = await loanTrail({ loans: { device: ['Mariner MIS'] }, patient: 'Testa', date: '2026-11-12' })

    expect(set.name).toBe('Device Technologies')
    expect(set.emails.map(m => m.from)).toEqual(['Brent', 'DL VIC Loans'])
    expect(set.emails[0].outgoing).toBe(true)
    // The quoted request is not repeated under the reply.
    expect(set.emails[1].text).toBe('Confirmed, arriving Wed 9am. Con note TT12345. Tray list attached.')
    expect(set.summary).toMatchObject({ status: 'confirmed' })
    expect(set.summary.facts[1]).toEqual({ label: 'Con note', value: 'TT12345' })

    const att = set.emails[1].attachments[0]
    expect(att.filename).toBe('Mariner MIS tray list.pdf')
    expect(att.token).toMatch(/^[0-9a-f-]{36}$/)
    const opened = await attachmentFor(att.token)
    expect(opened).toMatchObject({ mediaType: 'application/pdf', filename: 'Mariner MIS tray list.pdf' })
  })

  it('searches nothing for a booking with no distributor loan', async () => {
    const sets = await loanTrail({ loans: {}, patient: 'Testa', date: '2026-11-12' })
    expect(sets).toEqual([])
    expect(searches).toEqual([])
  })

  it('never opens anything for a made-up or expired link', async () => {
    expect(await attachmentFor('not-a-token')).toBeNull()
    expect(await attachmentFor('11111111-2222-3333-4444-555555555555')).toBeNull()
  })
})

describe('freshText', () => {
  it('drops the quoted history from a reply', () => {
    expect(freshText('Yes.\n\nOn Tue, 3 Nov 2026 at 9:00 Mat wrote:\n> earlier')).toBe('Yes.')
    expect(freshText('Thanks\n-----Original Message-----\nFrom: x')).toBe('Thanks')
  })
})

describe('calendar invitations from the supplier', () => {
  it('are read into facts, settle the set as confirmed, and are not offered as a link', async () => {
    const { askClaude } = await import('./_anthropic.js')
    askClaude.mockRejectedValueOnce(new Error('unavailable'))
    const gmail = await import('./_gmail.js')
    const ics = 'BEGIN:VEVENT\r\nSUMMARY:BKG TESTA\\, MIS POSTERIOR PEDICLE SCREWS\r\nDTSTART:20261112T200000Z\r\nEND:VEVENT'
    gmail.readAttachment.mockResolvedValueOnce({ data: Buffer.from(ics).toString('base64'), mediaType: '' })
    mailboxes['bookings@technomed.com.au'] = {
      a: REQUEST,
      b: { ...REPLY, messageId: '<inv@device.com.au>', from: 'Hybris Communications <noreply@device.com.au>',
        attachments: [{ filename: 'invite.ics', mediaType: 'text/calendar', attachmentId: 'ics-1', size: 8000 }] }
    }
    const [set] = await loanTrail({ loans: { device: ['Mariner MIS'] }, patient: 'Testa', date: '2026-11-13' })
    expect(set.summary.status).toBe('confirmed')
    expect(set.summary.facts).toEqual(expect.arrayContaining([
      { label: 'Supplier booking', value: 'BKG TESTA, MIS POSTERIOR PEDICLE SCREWS' },
      { label: 'Booked for', value: 'Fri, 13 Nov, 7:00 am' }
    ]))
    expect(set.emails[1].attachments).toEqual([])
  })
})
