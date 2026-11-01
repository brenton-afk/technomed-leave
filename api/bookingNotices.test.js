import { describe, it, expect } from 'vitest'
import { noticesFor, describeBooking, DEFAULT_CONTACTS, DEFAULT_RULES } from './_bookingNotices.js'

// ─── Task 9: booking notices to Signus and KT Medical (RHH) ─────────────────
// Fake patients. Nothing here sends anything.

const settings = { contacts: DEFAULT_CONTACTS, rules: DEFAULT_RULES }
const event = (over = {}) => ({
  id: 'evt-abc123', summary: 'Testa ASCOT - Ibbett',
  description: 'Surg - Dr Ibbett\nPt - Testa (Jo)\nProcedure - C5/6 ACDF\nKit - Ascot (Consignment)\nHospital - CLV',
  start: { dateTime: '2026-11-06T09:00:00+11:00' }, ...over
})
const read = e => describeBooking(e)

describe('a Signus booking', () => {
  it('a new one is a notice to Signus, to jhanson cc apolites', () => {
    const [notice, ...rest] = noticesFor({ kind: 'new', after: read(event()), eventId: 'evt-abc123', settings })
    expect(rest).toEqual([])
    expect(notice.to).toEqual(['jhanson@signus.com.au'])
    expect(notice.cc).toEqual(['apolites@signus.com.au'])
    expect(notice.subject).toBe('New booking — Testa 6/11/2026 CLV — Ref TM-ABC123')
  })

  it('names the surname and never the first name', () => {
    const [notice] = noticesFor({ kind: 'new', after: read(event()), eventId: 'evt-abc123', settings })
    expect(notice.text).toMatch(/Patient: Testa/)
    expect(notice.text + notice.html).not.toMatch(/\bJo\b/)
  })

  it('a move says old and new date, with the same reference so it threads', () => {
    const before = read(event())
    const after = read(event({ start: { dateTime: '2026-11-09T09:00:00+11:00' } }))
    const [notice] = noticesFor({ kind: 'moved', before, after, eventId: 'evt-abc123', settings })
    expect(notice.text).toMatch(/Date: 6\/11\/2026 → 9\/11\/2026/)
    expect(notice.subject).toMatch(/Ref TM-ABC123$/)
  })

  it('a cancellation is a notice too', () => {
    const [notice] = noticesFor({ kind: 'cancelled', before: read(event()), eventId: 'evt-abc123', settings })
    expect(notice.subject).toMatch(/^Booking cancelled/)
  })

  it('an edit to the notes or rep alone tells them nothing', () => {
    const before = read(event())
    const after = read(event({ summary: 'Testa ASCOT - Ibbett (Mat)' }))
    expect(noticesFor({ kind: 'changed', before, after, eventId: 'x', settings })).toEqual([])
  })
})

describe('KT Medical', () => {
  const kt = (hospital) => event({ summary: 'Testa LONESTAR - Thani',
    description: `Surg - Thani\nPt - Testa\nProcedure - ALIF\nKit - Lonestar\nHospital - ${hospital}` })

  it('is told about an RHH booking', () => {
    const notices = noticesFor({ kind: 'new', after: read(kt('RHH')), eventId: 'k1', settings })
    expect(notices.map(n => n.contactId)).toEqual(['kt'])
  })

  it('is not told about a Calvary one', () => {
    expect(noticesFor({ kind: 'new', after: read(kt('CLV')), eventId: 'k1', settings })).toEqual([])
  })

  it('is told when a booking moves from RHH to Calvary', () => {
    const notices = noticesFor({ kind: 'changed', before: read(kt('RHH')), after: read(kt('CLV')), eventId: 'k1', settings })
    expect(notices).toHaveLength(1)
    expect(notices[0].text).toMatch(/Hospital: RHH → CLV/)
  })
})

describe('everyone else', () => {
  it('Device is never sent a booking notice — they asked not to', () => {
    const mariner = event({ summary: 'Testa MARINER - Gupta', description: 'Pt - Testa\nKit - Mariner\nHospital - RHH' })
    expect(noticesFor({ kind: 'new', after: read(mariner), eventId: 'd1', settings })).toEqual([])
  })

  it('nothing is sent without being shown first, unless a rule says so', () => {
    expect(DEFAULT_RULES.every(r => r.autoSend === false)).toBe(true)
  })
})
