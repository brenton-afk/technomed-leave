import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { normaliseCase } from './_usageCase.js'

// ─── The surname is the only patient identifier this system holds ───────────
// It used to hold three. The extraction prompt asked Claude to read the
// hospital ID label for the patient's first name and UR number as well, and
// both were then kept in Redis, shown on the review screen, and written into
// the usage sheet emailed to the distributors — so a hospital MRN left the
// company by design, on every scan.
//
// Three layers, because one is not enough: do not ask for it, do not keep it
// if it arrives anyway, and do not print it. A model that volunteers a UR
// number on a form where the label was not fully covered must still hit a
// wall here.

const prompt = readFileSync(join(__dirname, 'usage', 'agent.js'), 'utf8')
const workbook = readFileSync(join(__dirname, '_usageExcel.js'), 'utf8')

describe('what we ask the model for', () => {
  it('asks for a surname and says not to read the rest', () => {
    expect(prompt).toContain('patient surname')
    expect(prompt).toMatch(/Do NOT extract the patient's first name, UR number/)
  })

  it('does not put the other identifiers in the response shape', () => {
    // A field in the requested JSON is an instruction to fill it in.
    expect(prompt).not.toContain('"patientFirstName"')
    expect(prompt).not.toContain('"patientUrNumber"')
  })
})

describe('what we keep when it arrives anyway', () => {
  const extracted = {
    patientSurname: 'Hollis',
    patientFirstName: 'David',
    patientUrNumber: 'UR4417829',
    urNumber: 'UR4417829',
    patientDob: '1954-02-11',
    surgeonName: 'Thani',
    hospital: 'RHH',
    procedure: 'ACDF',
    items: [{ productName: 'Cage', referenceCode: 'X1', quantity: 'x1' }]
  }

  it('keeps the surname', () => {
    expect(normaliseCase(extracted, {}).patientSurname).toBe('Hollis')
  })

  it('drops every other identifier the model volunteered', () => {
    // The label may not have been fully covered, or the model may read it
    // regardless. Storage is the last place to stop it.
    const record = JSON.stringify(normaliseCase(extracted, {}))
    for (const leaked of ['David', 'UR4417829', '1954-02-11']) {
      expect(record, `${leaked} should not survive normalisation`).not.toContain(leaked)
    }
  })
})

describe('what leaves the building', () => {
  it('does not print a first name or a UR number on any sheet', () => {
    // This workbook is the distributor's email attachment. They need to know
    // which implants went in, to whose list and on what date.
    expect(workbook).not.toMatch(/detail\('Patient first name'/)
    expect(workbook).not.toMatch(/detail\('UR number'/)
    expect(workbook).toMatch(/detail\('Patient surname'/)
  })
})
