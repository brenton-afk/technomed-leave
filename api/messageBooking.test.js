import { describe, it, expect, vi } from 'vitest'

// Brent, 16 Nov 2026: a registrar's WhatsApp read into a booking. "Don't need
// the UR number to be included." Invented patient and number.
const asked = []
vi.mock('./_anthropic.js', () => ({
  askClaude: vi.fn(async ({ request }) => {
    asked.push(request.messages[0].content)
    return { content: [{ type: 'text', text: JSON.stringify({
      surname: 'Alex TESTA 100000001', surgeon: 'gupta', date: '2026-11-16', hospital: '',
      procedure: 'L1-L3 percutaneous pedicle screw fixation for L2 three-column fracture',
      kit: '', note: 'Motorbike vs car at 100 km/h. Intubated in ICU. UR 100000001', unclear: ''
    }) }] }
  })
}))
const { readMessageBooking } = await import('./_readDictatedBooking.js')

describe('reading a pasted message', () => {
  it('returns the surname only, the surgeon as the portal spells them, and no UR number', async () => {
    const msg = 'New case for today\nAlex TESTA\n100000001\nFor L1-L3 perc screws.\nBoss Gupta'
    const { fields } = await readMessageBooking(msg)
    expect(fields.patient).toBe('Testa')
    expect(fields.surgeon).toBe('Gupta')
    expect(fields.hospital).toBe('')
    expect(JSON.stringify(fields)).not.toMatch(/100000001/)
    expect(asked[0]).toMatch(/pasted a message/)
    expect(asked[0]).toContain(msg)
  })
  it('refuses an empty paste without asking anyone', async () => {
    await expect(readMessageBooking('  ')).rejects.toThrow(/Paste the message/)
  })
})
