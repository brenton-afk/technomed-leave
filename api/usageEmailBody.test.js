import { describe, it, expect } from 'vitest'
import { usageEmailContent, greetingFor, caseFacts, cleanNote, surgeryDay } from './_usageEmailBody.js'
import { usageGreetingsFrom } from './_bookingNotices.js'

// The usage email, personal from both ends (Brent, 17 Nov 2026, option B of the
// mock-ups). Invented patient only.

const RECORD = {
  patientSurname: 'Testa', surgeonSurname: 'Ibbett', hospital: 'CLV', date: '2026-11-17',
  folderName: 'Testa_17112026_Ibbett_ACDF_CLV'
}
const ITEMS = [
  { productName: 'E4 Surgical Dakota self-drilling screw', referenceCode: '71-DV-4012', quantity: 2, stock: 'Consignment' },
  { productName: 'E4 Surgical Dakota plate', referenceCode: '71-DP-1', quantity: 1, stock: 'Consignment' }
]
const AIMEE = { name: 'Aimee Vulinovich', email: 'aimee@technomed.com.au' }

describe('the usage email', () => {
  const { html, text } = usageEmailContent({
    greeting: 'Roy and the E4 team', record: RECORD, items: ITEMS, sender: AIMEE, scanAttached: true,
    note: 'Two screws opened and not used — back in the set.'
  })

  it('greets the distributor by name', () => {
    expect(text).toMatch(/^Hi Roy and the E4 team,/)
    expect(html).toContain('Hi Roy and the E4 team,')
  })

  it('opens with the TechnoMed logo, inline', () => {
    expect(html).toContain('src="cid:technomed-logo"')
  })

  it('lists the case facts, never the patient', () => {
    expect(text).toContain('Surgeon: Ibbett')
    expect(text).toContain('Hospital: Calvary')
    expect(text).toContain('Date of surgery: Tue 17 Nov 2026')
    expect(text).toContain('Your systems: Dakota')
    expect(text).not.toContain('E4 Cages')
    expect(text).toContain('Items: 2 lines · consignment')
    expect(text).not.toMatch(/Testa/)
    expect(html).not.toMatch(/Testa/)
  })

  it("carries the rep's note and signs off as them", () => {
    expect(text).toContain('Two screws opened and not used — back in the set.')
    expect(text).toMatch(/Thanks,\nAimee Vulinovich\nClinical Support Specialist\n0477 334 561 · aimee@technomed.com.au/)
    expect(html).toContain('Aimee Vulinovich')
  })

  it('escapes what the rep types', () => {
    const { html: h } = usageEmailContent({ greeting: 'Team', note: '<script>x</script>', sender: AIMEE })
    expect(h).not.toContain('<script>')
    expect(h).toContain('&lt;script&gt;')
  })

  it('leaves the note out when there is none', () => {
    const { text: t } = usageEmailContent({ greeting: 'Team', record: RECORD, items: ITEMS, sender: AIMEE })
    expect(t).not.toContain('undefined')
  })

  it('puts a correction first, after the greeting', () => {
    const { text: t } = usageEmailContent({ greeting: 'Jasper and Amanda', correctionText: 'Correction — this replaces the usage sent on 4 Nov 2026.', sender: AIMEE })
    expect(t).toMatch(/^Hi Jasper and Amanda,\n\nCorrection — this replaces/)
  })

  it('says TEST at the very top of a test', () => {
    const { text: t, html: h } = usageEmailContent({ greeting: 'Team', sender: AIMEE, banner: { tone: 'warning', title: 'TEST — not sent to the distributor.', detail: 'Would have gone to: x@y.z' } })
    expect(t).toMatch(/^TEST — not sent to the distributor\./)
    expect(h).toContain('TEST — not sent to the distributor.')
  })
})

describe('greetings', () => {
  it('Signus is Jasper and Amanda', () => {
    expect(greetingFor('signus')).toBe('Jasper and Amanda')
  })
  it('a saved greeting wins; "Hi" and a trailing comma typed in are dropped', () => {
    const g = usageGreetingsFrom({ e4: 'Hi Roy,', unknown: 'x' })
    expect(g.e4).toBe('Roy')
    expect(g.unknown).toBeUndefined()
    expect(g.signus).toBe('Jasper and Amanda')
  })
  it('a blank saved greeting falls back to the default', () => {
    expect(usageGreetingsFrom({ kt: '  ' }).kt).toBe('Ben and the KT team')
  })
})

describe('small parts', () => {
  it('reads the date without the device timezone', () => {
    expect(surgeryDay('2026-11-17')).toBe('Tue 17 Nov 2026')
    expect(surgeryDay('')).toBe('')
  })
  it('caps and tidies a note', () => {
    expect(cleanNote('  a\r\n\n\n\nb  ')).toBe('a\n\nb')
    expect(cleanNote('x'.repeat(900))).toHaveLength(600)
  })
  it('says loan when every line is loan', () => {
    const facts = Object.fromEntries(caseFacts(RECORD, [{ productName: 'Mariner screw', stock: 'Loan' }]))
    expect(facts.Items).toBe('1 line · loan')
  })
})
