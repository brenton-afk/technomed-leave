import { describe, it, expect, beforeEach, vi } from 'vitest'
import { queueBookingSave, pendingChanges, flushQueue, dismissChange } from './offlineQueue.js'

// ─── Changes made with no signal are sent when it comes back ────────────────

const USER = { email: 'toni@technomed.com.au', token: 'tok' }
const reply = (status, body = {}) => ({ ok: status < 300, status, json: async () => body })

beforeEach(() => localStorage.clear())

describe('holding a change', () => {
  it('keeps it on the phone, newest change per booking only', () => {
    queueBookingSave({ eventId: 'e1', body: { eventId: 'e1', fields: { procedure: 'A' } }, label: 'Testa / Ibbett', email: USER.email })
    queueBookingSave({ eventId: 'e1', body: { eventId: 'e1', fields: { procedure: 'B' } }, label: 'Testa / Ibbett', email: USER.email })
    expect(pendingChanges()).toHaveLength(1)
    expect(pendingChanges()[0].body.fields.procedure).toBe('B')
  })
})

describe('sending it', () => {
  beforeEach(() => {
    queueBookingSave({ eventId: 'e1', body: { eventId: 'e1', etag: '"v1"', fields: {} }, label: 'Testa / Ibbett', email: USER.email })
  })

  it('sends it as the person who made it, and clears it once the calendar has it', async () => {
    const fetcher = vi.fn(async () => reply(200, { ok: true }))
    await flushQueue(USER, fetcher)
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(fetcher.mock.calls[0][1].body).etag).toBe('"v1"')
    expect(pendingChanges()).toEqual([])
  })

  it('keeps waiting while there is still no signal', async () => {
    await flushQueue(USER, vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(pendingChanges()[0].status).toBe('waiting')
  })

  it('never forces it over somebody else\'s change', async () => {
    await flushQueue(USER, vi.fn(async () => reply(409, { code: 'conflict' })))
    expect(pendingChanges()[0]).toMatchObject({ status: 'conflict' })
    expect(pendingChanges()[0].error).toMatch(/make the change again/)
  })

  it('is not sent by a different person signed in on the same phone', async () => {
    const fetcher = vi.fn()
    await flushQueue({ email: 'mat@technomed.com.au', token: 'other' }, fetcher)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('can be dismissed once read', async () => {
    await flushQueue(USER, vi.fn(async () => reply(409)))
    dismissChange(pendingChanges()[0].id)
    expect(pendingChanges()).toEqual([])
  })
})
