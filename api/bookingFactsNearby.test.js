import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { withStock } from '../src/usageLoanCheck.js'

// Brent, 19 Nov 2026: "The portal should have known that stock was
// consignment because that's what was booked." The form was dated the day
// after the booking, so the booking was not found and the kit said nothing;
// the hospital's ticked "Loan instruments/implants" box was then read as LOAN.
// Invented patient.

const BOOKING = {
  id: 'evt1',
  summary: 'Testa MARINER OPEN - Thani (Mat/Aimee)',
  description: 'Surgeon: Thani\nPatient: Testa\nDate: 18/11/2026\nHospital: RHH\nProcedure: L3-L5 Pedicle Screw Fixation\nKit: BRAINLAB AIRO & CURVE / Mariner Open (Consignment)',
  start: { dateTime: '2026-11-18T09:00:00+11:00' }
}

async function withCalendar(events) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_JSON', JSON.stringify({
    client_email: 'sa@test.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }))
  vi.stubEnv('GOOGLE_CALENDAR_ID', 'bookings@example.com')
  const asked = []
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (String(url).includes('oauth2.googleapis.com')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 3599 }) }
    asked.push(String(url))
    return { ok: true, json: async () => ({ items: events }) }
  }))
  vi.resetModules()
  const mod = await import('./_googleCalendar.js')
  return { ...mod, asked }
}

describe('the booking behind a usage is found when the form is a day out', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('finds the booking the day before, and its consignment wins over an unstamped form', async () => {
    const { findBookingFacts, asked } = await withCalendar([BOOKING])
    const facts = await findBookingFacts({ date: '2026-11-19', patientSurname: 'Testa' })
    expect(asked[0]).toMatch(/timeMin=2026-11-17/)
    expect(facts.supplyKit).toMatch(/Mariner.*Consignment/)
    // No red LOAN / blue CONSIGNMENT stamp read (a ticked box is ignored).
    const items = [{ id: 'a', productName: 'Mariner pedicle screw', distributorKey: 'device', stockMarking: '' }]
    expect(withStock(items, facts.supplyKit)[0].stock).toBe('Consignment')
  })

  it('prefers the booking on the form’s own day, and gives up on two others', async () => {
    const sameDay = { ...BOOKING, id: 'evt2', start: { dateTime: '2026-11-19T09:00:00+11:00' }, description: BOOKING.description.replace('Consignment', 'Distributor Loan') }
    let cal = await withCalendar([BOOKING, sameDay])
    expect((await cal.findBookingFacts({ date: '2026-11-19', patientSurname: 'Testa' })).supplyKit).toMatch(/Distributor Loan/)
    const another = { ...BOOKING, id: 'evt3', start: { dateTime: '2026-11-20T09:00:00+11:00' } }
    cal = await withCalendar([BOOKING, another])
    expect(await cal.findBookingFacts({ date: '2026-11-19', patientSurname: 'Testa' })).toBeNull()
  })
})
