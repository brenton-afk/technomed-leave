import { describe, it, expect } from 'vitest'
import { repairEmail, repairRecipients, PROJECTS_MAILBOX } from './_kitRepairs.js'
import { DEFAULT_CONTACTS } from './_bookingNotices.js'

const line = { code: 'TM-123', description: 'Rod bender', qty: 1, kind: 'instrument' }

describe('an instrument off a kit for repair (Brent, 20 Nov 2026)', () => {
  it('goes to Kirsty, Chris, the RHH loans coordinator and Toby at RHH', () => {
    const { to } = repairRecipients('RHH', DEFAULT_CONTACTS)
    expect(to).toEqual(['kirsty.patmore@ths.tas.gov.au', 'christopher.calverle@ths.tas.gov.au',
      'rhhcsdloancoordinator@ths.tas.gov.au', 'tobias.long@ths.tas.gov.au'])
  })
  it('goes to Gerardo, Brett and Julie at Calvary', () => {
    const { to } = repairRecipients('CLV', DEFAULT_CONTACTS)
    expect(to).toEqual(['Gerardo.Lacapra@calvarycare.org.au', 'Brett.Battersby@calvarycare.org.au', 'Julie.Robinson@calvarycare.org.au'])
  })
  it('copies our clinical team and projects@ on both', () => {
    for (const h of ['RHH', 'CLV']) {
      const { cc } = repairRecipients(h, DEFAULT_CONTACTS, { email: 'aimee@technomed.com.au' })
      expect(cc).toContain(PROJECTS_MAILBOX)
      expect(cc).toContain('brenton@technomed.com.au')
      expect(cc).toContain('aimee@technomed.com.au')
    }
  })
  it('says the kit, tray, instrument and fault', () => {
    const e = repairEmail({ hospital: 'RHH', kitName: 'Testkit', tray: 'Tray 2', line, fault: 'tip bent', by: 'Test Person' }, DEFAULT_CONTACTS)
    expect(e.subject).toBe('Instrument for repair – Testkit · Tray 2 · Rod bender')
    for (const bit of ['Kit: Testkit', 'Tray: Tray 2', 'Instrument: Rod bender (TM-123)', 'Fault: tip bent', 'Taken off by: Test Person', 'Royal Hobart Hospital']) {
      expect(e.text).toContain(bit)
    }
  })
})

describe('projects@ is not on tray transfers', async () => {
  it('kit moves do not copy projects@', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    expect(readFileSync(join(__dirname, '_kits.js'), 'utf8')).not.toContain('projects@')
  })
})
