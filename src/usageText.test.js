import { describe, it, expect } from 'vitest'
import { usageMessage, smsLink } from './usageText.js'

// A draft, never a send. The app does not know which registrar was in the
// room and their number is not on the booking, so a usage text that sent
// itself would be a patient's surgery described to whoever was top of a list.

const RECORD = {
  patientSurname: 'Hollis',
  surgeonSurname: 'Ibbett',
  date: '2026-10-06',
  hospital: 'RHH',
  procedure: 'C5/6 ACDF'
}

const ITEMS = [
  { distributor: 'E4 Surgical', productName: 'Dakota cage', size: '7mm', referenceCode: 'DK-07', quantity: 'x1' },
  { distributor: 'E4 Surgical', productName: 'Dakota plate', referenceCode: 'DK-PL', quantity: 'x1' },
  { distributor: 'Signus', productName: 'DIPLOMAT screw', quantity: 'x4' }
]

describe('usageMessage', () => {
  it('leads with who, with whom, when and where', () => {
    const text = usageMessage(RECORD, ITEMS)
    expect(text).toContain('Hollis · Ibbett · 6 Oct 2026 · RHH')
    expect(text).toContain('C5/6 ACDF')
  })

  it('groups the implants under the distributor', () => {
    // How a registrar reads it, and how a query comes back: "whose cage was
    // that" is answered before it is asked.
    const text = usageMessage(RECORD, ITEMS)
    expect(text).toMatch(/E4 Surgical:[\s\S]*Dakota cage[\s\S]*Dakota plate/)
    expect(text).toMatch(/Signus:[\s\S]*DIPLOMAT screw/)
  })

  it('shows a quantity only when it is not one', () => {
    const text = usageMessage(RECORD, ITEMS)
    expect(text).toContain('x4 DIPLOMAT screw')
    expect(text).not.toContain('x1 Dakota cage')
  })

  it('carries no identifier beyond the surname', () => {
    // The same rule as everywhere else, and more obviously right here: a text
    // is forwarded, screenshot, and left open on benches.
    const text = usageMessage(
      { ...RECORD, patientFirstName: 'David', patientUrNumber: 'UR4417829' }, ITEMS)
    expect(text).not.toContain('David')
    expect(text).not.toContain('UR4417829')
    expect(text).toContain('Hollis')
  })

  it('leaves out an item that is still being checked, and says so', () => {
    // A half-read sticker is exactly the wrong thing to put in the copy that
    // gets forwarded and quoted after the sheet has been corrected.
    const text = usageMessage(RECORD, [
      ...ITEMS,
      { distributor: 'Signus', productName: 'Illegible', manualReview: true }
    ])
    expect(text).not.toContain('Illegible')
    expect(text).toContain('1 item still being checked')
  })

  it('leaves out an item somebody excluded', () => {
    const text = usageMessage(RECORD, [
      ...ITEMS, { distributor: 'Signus', productName: 'Floseal', excluded: true }
    ])
    expect(text).not.toContain('Floseal')
  })

  it('says so plainly when nothing went in', () => {
    expect(usageMessage(RECORD, [])).toContain('No implants recorded.')
  })

  it('copes with a record that is missing most of itself', () => {
    expect(() => usageMessage({}, ITEMS)).not.toThrow()
    expect(usageMessage(null, ITEMS)).toBe('')
  })
})

describe('smsLink', () => {
  it('fills the body and leaves the recipient empty', () => {
    // Choosing who it goes to has to be a deliberate act by somebody who
    // knows which registrar was in the room.
    const link = smsLink('Hollis · Ibbett')
    expect(link.startsWith('sms:?&body=')).toBe(true)
    expect(link).not.toMatch(/sms:\+?\d/)
  })

  it('uses the separator iOS needs', () => {
    // With `?body=` instead of `?&body=`, iOS opens an empty message and the
    // draft is silently gone.
    expect(smsLink('x')).toContain('?&body=')
  })

  it('encodes a message with newlines and punctuation', () => {
    const link = smsLink('A · B\n· thing (REF-1)')
    expect(link).not.toContain('\n')
    expect(decodeURIComponent(link.replace('sms:?&body=', ''))).toContain('\n· thing (REF-1)')
  })
})
