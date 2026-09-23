import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.hoisted(() => { process.env.ANTHROPIC_API_KEY = 'test-key' })

// The model call is stubbed. What is tested is everything around it: what gets
// sent, and — far more importantly — what is allowed back out.
const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { constructor() { this.messages = { create } } }
}))

const { readBookingDocument, ACCEPTED_MEDIA } = await import('./_readBookingDocument.js')

const reply = cases => ({
  content: [{ type: 'text', text: JSON.stringify({ cases }) }]
})

beforeEach(() => create.mockReset())
afterEach(() => vi.restoreAllMocks())

describe('what it can be given', () => {
  it('sends a PDF as a document and a photo as an image', async () => {
    create.mockResolvedValue(reply([]))
    await readBookingDocument({
      attachments: [
        { mediaType: 'application/pdf', data: 'AAA' },
        { mediaType: 'image/jpeg', data: 'BBB' }
      ]
    })
    const sent = create.mock.calls[0][0].messages[0].content
    expect(sent[0].type).toBe('document')
    expect(sent[1].type).toBe('image')
  })

  it('accepts the formats a booking actually arrives in', () => {
    expect(ACCEPTED_MEDIA).toEqual(
      expect.arrayContaining(['application/pdf', 'image/jpeg', 'image/png']))
  })

  it('reads the email itself when there is no attachment', async () => {
    create.mockResolvedValue(reply([]))
    await readBookingDocument({ subject: 'Theatre list', text: 'Surg: Gupta\nPt: Marsh' })
    const sent = create.mock.calls[0][0].messages[0].content
    expect(sent.some(b => b.type === 'text' && b.text.includes('Surg: Gupta'))).toBe(true)
  })

  it('does not call the model for an empty email', async () => {
    expect(await readBookingDocument({})).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })

  it('ignores an attachment it cannot read', async () => {
    create.mockResolvedValue(reply([]))
    await readBookingDocument({
      text: 'see attached',
      attachments: [{ mediaType: 'application/vnd.ms-excel', data: 'XXX' }]
    })
    const sent = create.mock.calls[0][0].messages[0].content
    expect(sent.some(b => b.type === 'document' || b.type === 'image')).toBe(false)
  })
})

describe('what is allowed back out', () => {
  it('keeps the surname and nothing else of the patient', async () => {
    // Theatre lists carry given names and dates of birth. The prompt says not to
    // return them; this is the second lock, because "the model usually complies"
    // is not a basis for handling health information.
    create.mockResolvedValue(reply([
      { surname: 'MARSH John', surgeon: 'Gupta', date: '2026-10-09', procedure: 'L4/5 PLIF' }
    ]))
    const [booking] = await readBookingDocument({ text: 'x' })
    expect(booking.patient).toBe('Marsh')
    expect(JSON.stringify(booking)).not.toContain('John')
  })

  it('strips a date of birth wherever the model puts it', async () => {
    create.mockResolvedValue(reply([
      { surname: 'Marsh', surgeon: 'Gupta', date: '2026-10-09',
        procedure: 'L4/5 PLIF, DOB 12/3/1958', note: 'UR 200645910' }
    ]))
    const [booking] = await readBookingDocument({ text: 'x' })
    const everything = JSON.stringify(booking)
    expect(everything).not.toContain('12/3/1958')
    expect(everything).not.toContain('200645910')
  })

  it('normalises the surgeon to the name the app uses', async () => {
    create.mockResolvedValue(reply([
      { surname: 'Marsh', surgeon: 'PETERS-WILLKE', date: '2026-10-09' }
    ]))
    expect((await readBookingDocument({ text: 'x' }))[0].surgeon).toBe('JPW')
  })

  it('works out the systems from the kit line', async () => {
    create.mockResolvedValue(reply([
      { surname: 'Marsh', surgeon: 'Gupta', date: '2026-10-09', kit: 'Diplomat + E4' }
    ]))
    const [booking] = await readBookingDocument({ text: 'x' })
    expect(booking.systems).toEqual(['Diplomat', 'Global BMD PLIF'])
  })

  it('reads either hospital however it is written', async () => {
    create.mockResolvedValue(reply([
      { surname: 'A', surgeon: 'Gupta', hospital: 'Calvary Lenah Valley' },
      { surname: 'B', surgeon: 'Gupta', hospital: 'Royal Hobart Hospital' },
      { surname: 'C', surgeon: 'Gupta', hospital: 'somewhere else' }
    ]))
    expect((await readBookingDocument({ text: 'x' })).map(b => b.hospital))
      .toEqual(['CLV', 'RHH', ''])
  })

  it('refuses a date it cannot be sure of', async () => {
    create.mockResolvedValue(reply([
      { surname: 'Marsh', surgeon: 'Gupta', date: 'next Tuesday' }
    ]))
    expect((await readBookingDocument({ text: 'x' }))[0].date).toBeNull()
  })
})

describe('when the model is no help', () => {
  it('returns nothing rather than half a list', async () => {
    // A reply that is not JSON cannot be trusted to be complete, and half a
    // theatre list is worse than none: the missing half looks like it was never
    // booked.
    create.mockResolvedValue({ content: [{ type: 'text', text: 'I could not read this.' }] })
    expect(await readBookingDocument({ text: 'x' })).toEqual([])
  })

  it('drops an entry with neither a patient nor a surgeon', async () => {
    create.mockResolvedValue(reply([
      { surname: '', surgeon: '', procedure: 'something' },
      { surname: 'Marsh', surgeon: 'Gupta', date: '2026-10-09' }
    ]))
    expect(await readBookingDocument({ text: 'x' })).toHaveLength(1)
  })

  it('marks an incomplete case as needing a person', async () => {
    create.mockResolvedValue(reply([
      { surname: 'Marsh', surgeon: 'Gupta', date: '' }
    ]))
    const [booking] = await readBookingDocument({ text: 'x' })
    expect(booking.confident).toBe(false)
    // Still returned. Dropping it would lose a real booking silently.
    expect(booking.patient).toBe('Marsh')
  })
})
