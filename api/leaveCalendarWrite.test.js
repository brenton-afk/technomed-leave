import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'

// Approved leave goes on Staff Leave, written as bookings@ (its owner) through
// domain-wide delegation, because Workspace will not let the service account —
// an outside account — be given edit rights on it. Until delegation is granted
// it falls back exactly as before. Invented names; nothing real is written.

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'svc@example.iam.gserviceaccount.com', client_id: '123',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
})
delete process.env.GOOGLE_LEAVE_CALENDAR_ID

const { addCalendarEvent, STAFF_LEAVE_CALENDAR_ID } = await import('./_googleCalendar.js')

let delegated
let posts
beforeEach(() => {
  posts = []
  global.fetch = vi.fn(async (url, init) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      const jwt = new URLSearchParams(init.body).get('assertion')
      const claim = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
      if (claim.sub && !delegated) return { json: async () => ({ error: 'unauthorized_client' }) }
      return { json: async () => ({ access_token: claim.sub ? 'as-owner' : 'as-service' }) }
    }
    const calendar = decodeURIComponent(String(url).split('/calendars/')[1].split('/')[0])
    const auth = init.headers.Authorization
    posts.push({ calendar, auth })
    // Staff Leave refuses the service account itself, as Workspace does.
    if (calendar === STAFF_LEAVE_CALENDAR_ID && auth !== 'Bearer as-owner') {
      return { status: 403, json: async () => ({ error: { message: 'forbidden' } }) }
    }
    return { status: 200, json: async () => ({ id: 'evt', htmlLink: 'x' }) }
  })
})

const LEAVE = { name: 'Testa Rossa', division: 'Ops', startDate: '2026-11-10', endDate: '2026-11-11', leaveType: 'SICK', reason: '' }

describe('approved leave', () => {
  it('lands on Staff Leave, written as bookings@, once delegation is granted', async () => {
    delegated = true
    const result = await addCalendarEvent(LEAVE)
    expect(result).toMatchObject({ calendarId: STAFF_LEAVE_CALENDAR_ID, fellBack: false })
    expect(posts).toEqual([{ calendar: STAFF_LEAVE_CALENDAR_ID, auth: 'Bearer as-owner' }])
  })

  it('still lands somewhere, and says so, until it is', async () => {
    delegated = false
    const result = await addCalendarEvent(LEAVE)
    expect(result).toMatchObject({ calendarId: 'bookings@technomed.com.au', fellBack: true })
  })
})
