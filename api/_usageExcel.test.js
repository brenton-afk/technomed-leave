import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildUsageWorkbook } from './_usageExcel.js'

// The first behavioural test in api/. Everything here was previously checked by
// an esbuild pass that resolves imports, which catches a missing export and
// nothing at all about what a route produces.

const CASE = {
  date: '2026-08-24',
  hospital: 'CLV',
  surgeonSurname: 'Ibbett',
  surgeonName: 'Mr J Ibett',   // the misread the rep corrected
  patientSurname: 'McQueen',
  patientFirstName: '',
  patientUrNumber: '',
  procedure: 'C4/5 ACDF',
  repName: 'Brenton Lovering'
}

const ITEM = {
  productName: 'SeaSpine Mariner MIS',
  distributorKey: 'SEASPINE',
  quantity: 2,
  manualReview: false
}

/** Reads the sheet back the way a distributor's Excel would. */
async function readBack(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Usage')
  const headers = sheet.getRow(1).values.slice(1)
  return sheet.getRow(2).values.slice(1).reduce((row, value, i) => {
    row[headers[i]] = value
    return row
  }, {})
  // Note: column *keys* do not survive an xlsx round-trip, only headers — which
  // is why this maps by header text rather than calling getCell('surgeon').
}

describe('the surgeon column', () => {
  it('carries the surname the rep confirmed', async () => {
    // The review screen has one surgeon field and it is the surname. It is also
    // what the folder name, the Dropbox tree and therefore the email subject are
    // built from — so preferring the extracted full name here put a different
    // surgeon on the sheet than on the subject line of the email carrying it.
    const row = await readBack(await buildUsageWorkbook(CASE, [ITEM]))
    expect(row.Surgeon).toBe('Ibbett')
    expect(row.Surgeon).not.toBe('Mr J Ibett')
  })

  it('falls back to the extracted name when there is no surname', async () => {
    const row = await readBack(await buildUsageWorkbook({ ...CASE, surgeonSurname: '' }, [ITEM]))
    expect(row.Surgeon).toBe('Mr J Ibett')
  })
})

describe('the rest of the row', () => {
  it('records who scanned it', async () => {
    const row = await readBack(await buildUsageWorkbook(CASE, [ITEM]))
    expect(row['Rep Name']).toBe('Brenton Lovering')
  })

  it('marks a held-back row so the sheet says what the email left out', async () => {
    const row = await readBack(await buildUsageWorkbook(CASE, [{ ...ITEM, manualReview: true }]))
    expect(row['Manual Review Flag']).toBe('YES')
  })

  it('leaves Extended Price as a formula, so a typed unit price fills it in', async () => {
    const row = await readBack(await buildUsageWorkbook(CASE, [ITEM]))
    expect(row['Extended Price']).toHaveProperty('formula')
  })
})
