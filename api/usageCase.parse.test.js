import { describe, it, expect } from 'vitest'
import { buildFolderName, parseFolderName } from './_usageCase.js'

// ─── Reading a case folder back ──────────────────────────────────────────────
// The folder name is the only record of what a filed case was — Dropbox holds
// no metadata of ours — so a patient's history is only as good as this.

describe('parseFolderName', () => {
  it('round-trips what buildFolderName wrote', () => {
    const name = buildFolderName({
      patientSurname: 'Hollis', date: '2026-10-04',
      surgeonSurname: 'Thani', procedure: 'ACDF', hospital: 'RHH'
    })
    expect(parseFolderName(name)).toMatchObject({
      recognised: true, patientSurname: 'Hollis', date: '2026-10-04',
      surgeonSurname: 'Thani', procedure: 'ACDF', hospital: 'RHH'
    })
  })

  it('reads a case out of the file inside it, not just the folder', () => {
    // A search returns the folder and both files in it, and all three have to
    // resolve to the same case or a patient has every operation listed thrice.
    const folder = 'Hollis_04102026_Thani_ACDF_RHH'
    for (const suffix of ['', '_Usage_Sheet.xlsx', '_Scan.pdf']) {
      expect(parseFolderName(folder + suffix).date).toBe('2026-10-04')
      expect(parseFolderName(folder + suffix).patientSurname).toBe('Hollis')
    }
  })

  it('finds the date rather than counting to it', () => {
    // A procedure with an underscore in it would otherwise shift every field
    // after it along by one and file the case under the wrong hospital.
    const odd = parseFolderName('Hollis_04102026_Thani_L4_5-PLIF_Calvary-Lenah-Valley')
    expect(odd.surgeonSurname).toBe('Thani')
    expect(odd.procedure).toBe('L4 5-PLIF')
    expect(odd.hospital).toBe('Calvary Lenah Valley')
  })

  it('keeps a procedure exactly as it was filed', () => {
    // "C5/6" is already "C5-6" on disk: safeSegment flattened the slash at
    // filing time. Rendering it "C5 6" would read as a different operation.
    expect(parseFolderName('Hollis_04102026_Thani_C5-6-ACDF_RHH').procedure)
      .toBe('C5-6-ACDF')
  })

  it('handles a two-word surname', () => {
    const name = parseFolderName('Van_Diemen_04102026_Garg_ACDF_RHH')
    expect(name.patientSurname).toBe('Van Diemen')
    expect(name.surgeonSurname).toBe('Garg')
  })

  it('refuses to place a case in time on a date that is not one', () => {
    // 31 February is not a day. Showing "31 Feb" would be worse than showing
    // nothing, and sorting by it would put the case anywhere at all.
    expect(parseFolderName('Hollis_31022026_Thani_ACDF_RHH').date).toBe('')
    expect(parseFolderName('Hollis_99999999_Thani_ACDF_RHH').date).toBe('')
  })

  it('still surfaces a folder it cannot parse', () => {
    // Years of folders predate the app. A case the parser does not understand
    // still has to be findable, or the history quietly omits it.
    const old = parseFolderName('Hollis old notes')
    expect(old.recognised).toBe(false)
    expect(old.raw).toBe('Hollis old notes')
  })

  it('survives nothing at all', () => {
    for (const bad of [undefined, null, '', 123]) {
      expect(() => parseFolderName(bad)).not.toThrow()
    }
  })
})

import { procedureLabel } from './_usageCase.js'

describe('the procedure in a folder name is a label, not a description', () => {
  it('keeps only the keywords Brent uses', () => {
    expect(procedureLabel('C5/6 Anterior Cervical Discectomy and Fusion')).toBe('ACDF')
    expect(procedureLabel('L4/5 PLIF')).toBe('PLIF')
    expect(procedureLabel('L5/S1 anterior lumbar interbody fusion')).toBe('ALIF')
    expect(procedureLabel('Right L4/5 transforaminal lumbar interbody fusion')).toBe('TLIF')
    expect(procedureLabel('T8/9 discectomy + single level posterior fixation')).toBe('Fixation')
    expect(procedureLabel('T12-L2 PSF')).toBe('Fixation')
    expect(procedureLabel('L4/5 PLIF and pedicle screw fixation')).toBe('PLIF+Fixation')
  })
  it('adds Boost UF when Boost was used', () => {
    expect(procedureLabel('C5/6 ACDF', [{ productName: '2.5g BOOST Ultrafibres', referenceCode: 'ABT-AB-DT401' }])).toBe('ACDF+Boost UF')
  })
  it('falls back to something short, never the whole description', () => {
    expect(procedureLabel('L3/4 XLIF lateral approach')).toBe('XLIF')
    expect(procedureLabel('removal of hardware from previous surgery')).toBe('removal of')
  })
  it('makes a short folder name', () => {
    const name = buildFolderName({ patientSurname: 'Hollis', date: '2026-11-05', surgeonSurname: 'Thani', procedure: 'C5/6 Anterior Cervical Discectomy and Fusion', hospital: 'CLV' })
    expect(name).toBe('Hollis_05112026_Thani_ACDF_CLV')
  })
})

import { normaliseCase } from './_usageCase.js'
import { isExcludedProduct } from './_distributors.js'

describe('products that are not TechnoMed are left off a scan', () => {
  it('drops Floseal, TachoSil and Gelfoam however they are written', () => {
    for (const name of ['FLOSEAL Hemostatic Matrix', 'Flo-Seal 10ml', 'TachoSil patch', 'Tacho sil', 'Gelfoam', 'Gel Foam sponge', 'gel-foam']) {
      expect(isExcludedProduct(name)).toBe(true)
    }
    expect(isExcludedProduct('DIPLOMAT Tulip')).toBe(false)
  })
  it('does not list them on the scan at all', () => {
    const c = normaliseCase({
      patientSurname: 'Testcase', surgeonName: 'Dr A Thani', date: '05/11/2026', hospital: 'Calvary', procedure: 'ACDF',
      items: [
        { productName: 'Floseal', quantity: '1' },
        { productName: 'TachoSil', quantity: '1' },
        { productName: 'Gel Foam', quantity: '2' },
        { productName: 'CYLOX cage', distributor: 'Signus', referenceCode: 'CY08041512', quantity: '1' }
      ]
    }, { repName: 'Test Rep', repEmail: 'rep@example.com', scanDate: '2026-11-05' })
    expect(c.items.map(i => i.productName)).toEqual(['CYLOX cage'])
  })
})
