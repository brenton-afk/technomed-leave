import { describe, it, expect } from 'vitest'
import { buildFolderName, parseFolderName } from './_usageCase.js'

// ─── Reading a case folder back ──────────────────────────────────────────────
// The folder name is the only record of what a filed case was — Dropbox holds
// no metadata of ours — so a patient's history is only as good as this.

describe('parseFolderName', () => {
  it('round-trips what buildFolderName wrote', () => {
    const name = buildFolderName({
      patientSurname: 'Barr', date: '2026-10-04',
      surgeonSurname: 'Thani', procedure: 'ACDF', hospital: 'RHH'
    })
    expect(parseFolderName(name)).toMatchObject({
      recognised: true, patientSurname: 'Barr', date: '2026-10-04',
      surgeonSurname: 'Thani', procedure: 'ACDF', hospital: 'RHH'
    })
  })

  it('reads a case out of the file inside it, not just the folder', () => {
    // A search returns the folder and both files in it, and all three have to
    // resolve to the same case or a patient has every operation listed thrice.
    const folder = 'Barr_04102026_Thani_ACDF_RHH'
    for (const suffix of ['', '_Usage_Sheet.xlsx', '_Scan.pdf']) {
      expect(parseFolderName(folder + suffix).date).toBe('2026-10-04')
      expect(parseFolderName(folder + suffix).patientSurname).toBe('Barr')
    }
  })

  it('finds the date rather than counting to it', () => {
    // A procedure with an underscore in it would otherwise shift every field
    // after it along by one and file the case under the wrong hospital.
    const odd = parseFolderName('Barr_04102026_Thani_L4_5-PLIF_Calvary-Lenah-Valley')
    expect(odd.surgeonSurname).toBe('Thani')
    expect(odd.procedure).toBe('L4 5-PLIF')
    expect(odd.hospital).toBe('Calvary Lenah Valley')
  })

  it('keeps a procedure exactly as it was filed', () => {
    // "C5/6" is already "C5-6" on disk: safeSegment flattened the slash at
    // filing time. Rendering it "C5 6" would read as a different operation.
    expect(parseFolderName('Barr_04102026_Thani_C5-6-ACDF_RHH').procedure)
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
    expect(parseFolderName('Barr_31022026_Thani_ACDF_RHH').date).toBe('')
    expect(parseFolderName('Barr_99999999_Thani_ACDF_RHH').date).toBe('')
  })

  it('still surfaces a folder it cannot parse', () => {
    // Years of folders predate the app. A case the parser does not understand
    // still has to be findable, or the history quietly omits it.
    const old = parseFolderName('Barr old notes')
    expect(old.recognised).toBe(false)
    expect(old.raw).toBe('Barr old notes')
  })

  it('survives nothing at all', () => {
    for (const bad of [undefined, null, '', 123]) {
      expect(() => parseFolderName(bad)).not.toThrow()
    }
  })
})
