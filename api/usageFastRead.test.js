import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reading a usage form faster (Brent, 6 Nov 2026: "15-20 seconds?"): pages at
// once, medium effort first, full effort only for a page that needs it.

const calls = []
let answer
vi.mock('./_anthropic.js', () => ({
  streamClaude: vi.fn(async ({ request }) => {
    calls.push({ effort: request.output_config.effort, pages: request.messages[0].content.length - 1 })
    return answer(request, calls.length)
  })
}))
vi.mock('./_auth.js', () => ({ requireSession: vi.fn(async () => ({ email: 'rep@example.test', name: 'Rep Example' })) }))
vi.mock('./_redis.js', () => ({}))
vi.mock('./_email.js', () => ({ sendUsageEmail: vi.fn() }))
vi.mock('./_googleCalendar.js', () => ({ markAttendance: vi.fn() }))
vi.mock('./_dropbox.js', () => ({ dropboxConfigured: () => false }))

process.env.ANTHROPIC_API_KEY = 'test'
const { default: handler, mergeExtractions } = await import('./usage/agent.js')

const page = { mediaType: 'image/jpeg', data: 'A'.repeat(40) }
const reply = obj => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] })
const scan = pages => new Promise(resolve => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(d) { resolve({ status: this.statusCode, data: d }) }, setHeader() {} }
  handler({ method: 'POST', query: { action: 'scan' }, body: { pages, scanDate: '2026-11-06' }, headers: {} }, res)
})

beforeEach(() => { calls.length = 0 })

describe('reading a usage form', () => {
  it('reads each page in its own request at medium effort, and joins them', async () => {
    answer = (req, n) => reply(n === 1
      ? { patientSurname: 'Testa', surgeonName: 'Sample', hospital: 'CLV', date: '2026-11-06', items: [{ productName: 'Cage', referenceCode: 'C1', quantity: 'x1' }] }
      : { items: [{ productName: 'Boost allograft', referenceCode: 'B1', quantity: 'x1' }] })
    const r = await scan([page, page])
    expect(r.status).toBe(200)
    expect(calls).toEqual([{ effort: 'medium', pages: 1 }, { effort: 'medium', pages: 1 }])
    expect(r.data.case.patientSurname).toBe('Testa')
    expect(r.data.case.items.length).toBe(2)
  })

  it('reads a page again at full effort when its answer cannot be used', async () => {
    answer = (req, n) => (n === 1
      ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }
      : reply({ patientSurname: 'Testa', items: [] }))
    const r = await scan([page])
    expect(r.status).toBe(200)
    expect(calls.map(c => c.effort)).toEqual(['medium', 'high'])
  })

  it('takes the header from the first page that has each field', () => {
    const m = mergeExtractions([{ patientSurname: '', surgeonName: 'Sample', items: [1] }, { patientSurname: 'Testa', surgeonName: 'Other', items: [2] }])
    expect(m).toMatchObject({ patientSurname: 'Testa', surgeonName: 'Sample', items: [1, 2] })
  })
})
