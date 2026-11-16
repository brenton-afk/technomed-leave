import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Brent, 16 Nov 2026: a registrar's WhatsApp pasted into Add booking, read and
// put straight on the calendar. Invented patient.
vi.mock('../../notices.js', () => ({ offerNotices: vi.fn() }))
import PasteMessage from './PasteMessage.jsx'
import { offerNotices } from '../../notices.js'

const MSG = 'Morning team,\n\nNew case for today\n\nAlex TESTA\n100000001\n\nL2 3 column fracture\n\nFor L1-L3 perc screws.\n\nBoss Gupta'
const reply = body => ({ ok: true, json: async () => body })

beforeEach(() => { vi.clearAllMocks() })

describe('a pasted message', () => {
  it('asks only for the hospital when the message does not say, then books it', async () => {
    const sent = []
    global.fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body); sent.push(body)
      if (!body.hospital) return reply({ ok: false, needs: ['hospital'], fields: { patient: 'Testa', surgeon: 'Gupta', date: '2026-11-16' } })
      return reply({ ok: true, booked: { patient: 'Testa', surgeon: 'Gupta', hospital: 'RHH', date: '2026-11-16',
        procedure: 'L1-L3 percutaneous pedicle screw fixation', kit: 'Mariner MIS (Consignment) / BRAINLAB AIRO & CURVE', note: 'Intubated in ICU' },
        event: { id: 'e1' }, notices: [] })
    })
    const booked = vi.fn()
    render(<PasteMessage user={{ token: 't' }} onBooked={booked} />)
    fireEvent.change(screen.getByLabelText('The message'), { target: { value: MSG } })
    fireEvent.click(screen.getByRole('button', { name: 'Book it' }))
    await screen.findByText(/Which hospital\?/)
    fireEvent.click(screen.getByRole('button', { name: 'RHH' }))
    fireEvent.click(screen.getByRole('button', { name: 'Book it' }))
    await screen.findByText('Booked')
    expect(sent[1]).toMatchObject({ text: MSG, hospital: 'RHH' })
    expect(screen.getByText(/Mariner MIS \(Consignment\)/)).toBeInTheDocument()
    expect(booked).toHaveBeenCalled()
    expect(offerNotices).toHaveBeenCalled()
  })

  it('sends a message without a patient or surgeon to the form, with what was read', async () => {
    global.fetch = vi.fn(async () => reply({ ok: false, needs: ['surgeon'], fields: { patient: 'Testa', procedure: 'ACDF' } }))
    const useForm = vi.fn()
    render(<PasteMessage user={{ token: 't' }} onUseForm={useForm} />)
    fireEvent.change(screen.getByLabelText('The message'), { target: { value: 'Testa ACDF Friday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fill in the form' }))
    expect(useForm).toHaveBeenCalledWith({ patient: 'Testa', procedure: 'ACDF' })
  })

  it('says so when the case is already booked', async () => {
    global.fetch = vi.fn(async () => reply({ error: 'Testa is already booked with Gupta that day' }))
    render(<PasteMessage user={{ token: 't' }} />)
    fireEvent.change(screen.getByLabelText('The message'), { target: { value: MSG } })
    fireEvent.click(screen.getByRole('button', { name: 'Book it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/already booked/)
  })
})
