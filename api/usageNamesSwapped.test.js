import { describe, it, expect } from 'vitest'
import { normaliseCase, looksSwapped } from './_usageCase.js'
import { applyUsageFix, folderHash } from './_usageFixes.js'

// Brent, 9 Nov 2026: a case read as patient "<our surgeon>", surgeon
// "<the patient>", and filed under a new surgeon folder named after the
// patient. Invented names.
describe('patient and surgeon the wrong way round', () => {
  it('is spotted only when one of ours is in the patient box and a stranger in the surgeon box', () => {
    expect(looksSwapped('Thani', 'Sampleton')).toBe(true)
    expect(looksSwapped('Sampleton', 'Thani')).toBe(false)
    // A patient who shares a surgeon's surname, operated on by one of ours.
    expect(looksSwapped('Gupta', 'Thani')).toBe(false)
  })

  it('is put back the right way round when the form is read, and said', () => {
    const c = normaliseCase({ patientSurname: 'Thani', surgeonName: 'Sampleton', date: '09/11/2026', hospital: 'CLV', items: [] }, { scanDate: '' })
    expect(c).toMatchObject({ patientSurname: 'Sampleton', surgeonSurname: 'Thani', namesSwapped: true })
    expect(c.folderName).toMatch(/^Sampleton_09112026_Thani_/)
  })

  it('a record already saved that way is corrected by its folder fingerprint', () => {
    const wrong = {
      id: 'x', patientSurname: 'Thani', surgeonSurname: 'Sampleton', date: '2026-11-09', hospital: 'CLV', procedure: 'ALIF',
      folderName: 'Thani_09112026_Sampleton_ALIF_CLV', items: [],
      dropboxPath: '/ALL SURGEON USAGE/SPINE/Sampleton/November 2026/Thani_09112026_Sampleton_ALIF_CLV',
      filesSaved: ['Thani_09112026_Sampleton_ALIF_CLV_Usage_Sheet.xlsx']
    }
    const { record, changed } = applyUsageFix(wrong, { [folderHash(wrong.folderName)]: 'swapPatientSurgeon' })
    expect(changed).toBe(true)
    expect(record).toMatchObject({
      patientSurname: 'Sampleton', surgeonSurname: 'Thani', folderName: 'Sampleton_09112026_Thani_ALIF_CLV',
      dropboxPath: '/ALL SURGEON USAGE/SPINE/Thani/November 2026/Sampleton_09112026_Thani_ALIF_CLV',
      filesSaved: ['Sampleton_09112026_Thani_ALIF_CLV_Usage_Sheet.xlsx']
    })
    // Once right, it no longer matches.
    expect(applyUsageFix(record, { [folderHash(wrong.folderName)]: 'swapPatientSurgeon' }).changed).toBe(false)
  })
})

// "The portal needs to know that <the patient> is not a surgeon and should be
// able to tell that Thani is a surgeon because he's known to the portal."
describe('the surgeon is one the portal knows', async () => {
  const { knownSurgeon, recomputeCase } = await import('./_usageCase.js')
  it('from the same list the bookings are read with, under any of their names', () => {
    expect(knownSurgeon('Dr Nova Thani')).toBe('Thani')
    expect(knownSurgeon('Nova')).toBe('Thani')
    expect(knownSurgeon('Thanni')).toBe('Thani')
    expect(knownSurgeon('Jens Peters-Willke')).toBe('Peters-Willke')
    expect(knownSurgeon('Sampleton')).toBeNull()
  })
  it('a form naming "Dr Nova Thani" files under Thani', () => {
    const c = normaliseCase({ patientSurname: 'Sampleton', surgeonName: 'Dr Nova Thani', date: '09/11/2026', hospital: 'CLV', items: [] }, { scanDate: '' })
    expect(c).toMatchObject({ surgeonSurname: 'Thani', surgeonUnknown: false, namesSwapped: false })
  })
  it('a stranger in the surgeon box, with no surgeon in the patient box, is asked about', () => {
    const c = normaliseCase({ patientSurname: 'Sampleton', surgeonName: 'Otherby', date: '09/11/2026', hospital: 'CLV', items: [] }, { scanDate: '' })
    expect(c).toMatchObject({ surgeonUnknown: true, namesSwapped: false })
  })
  it('a surgeon typed on review is filed as the portal spells them', () => {
    expect(recomputeCase({ patientSurname: 'Sampleton', surgeonSurname: 'thani', date: '2026-11-09', hospital: 'CLV', items: [] }).folderName)
      .toMatch(/^Sampleton_09112026_Thani_/)
  })
})
