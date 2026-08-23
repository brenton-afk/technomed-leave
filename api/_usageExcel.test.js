import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildUsageWorkbook } from './_usageExcel.js'

// The sheet was twenty columns with all seven case details repeated on every
// row, so that a row would stand alone when pasted into a pricing workbook. On
// the device it is actually opened on — a phone, in theatre or in a distributor's
// office — that is several screens of sideways scrolling, most of it the same
// case detail over and over.
//
// It is a header block and a narrow table now. These hold the shape, and the two
// facts that were columns and had to survive losing them.

const CASE = {
  date: '2026-08-24',
  hospital: 'CLV',
  surgeonSurname: 'Ibbett',
  surgeonName: 'Mr J Ibett',   // the misread the rep corrected
  patientSurname: 'McQueen',
  patientFirstName: 'Lincoln',
  patientUrNumber: '200645910',
  procedure: 'C4/5 ACDF',
  repName: 'Brenton Lovering'
}

const ITEM = {
  productName: 'SeaSpine Mariner MIS',
  referenceCode: 'RM-45',
  lotNumber: 'HA260415',
  description: 'Screw fenestrated',
  size: '5.5 x 45mm',
  quantity: 2,
  rebateCode: 'CQ01',
  distributorKey: 'SEASPINE',
  distributor: 'SeaSpine',
  manualReview: false
}

/**
 * Reads a sheet back the way Excel would.
 *
 * By position, not by column key: keys do not survive an xlsx round-trip, which
 * is how an earlier check wrongly reported the Rep Name column empty when the
 * product was fine.
 */
async function open(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.getWorksheet('Usage')

  const rows = []
  sheet.eachRow({ includeEmpty: true }, row => {
    rows.push((row.values || []).slice(1).map(v => (v == null ? '' : v)))
  })

  // The header block is label/value pairs above the item table.
  const headIndex = rows.findIndex(r => r[0] === 'System / Product')
  const details = {}
  for (const row of rows.slice(0, headIndex)) {
    if (row[0] && row[1] !== '' && row[1] !== undefined) details[row[0]] = row[1]
  }

  return {
    sheet,
    rows,
    details,
    headers: rows[headIndex] || [],
    items: rows.slice(headIndex + 1),
    /** Everything on the sheet as one string, for "is this anywhere" questions. */
    text: rows.flat().join(' | ')
  }
}

describe('the shape', () => {
  it('puts the case details above the table, once', async () => {
    const s = await open(await buildUsageWorkbook(CASE, [ITEM, { ...ITEM, referenceCode: 'RM-50' }]))
    expect(s.details['Surgery date']).toBe('24/08/2026')
    expect(s.details.Hospital).toBe('CLV')
    expect(s.details.Procedure).toBe('C4/5 ACDF')
    // Two items, and the hospital appears nowhere among them — it is stated
    // once, above. That repetition was most of the old width.
    expect(s.items).toHaveLength(2)
    expect(s.items.flat().join(' ')).not.toMatch(/CLV/)
    // Once in the header block too. (Merging a detail's value across the item
    // columns repeats it into each covered cell on read-back, so this counts
    // rows rather than cells.)
    expect(s.rows.filter(r => r.includes('CLV'))).toHaveLength(1)
  })

  it('is narrow enough to read on a phone', async () => {
    const s = await open(await buildUsageWorkbook(CASE, [ITEM]))
    // Was twenty. The remaining columns are the ones that differ per item.
    expect(s.headers).toEqual(
      ['System / Product', 'Reference', 'Lot', 'Description', 'Size', 'Qty', 'Rebate'])
  })

  it('is taller than it is wide', async () => {
    const s = await open(await buildUsageWorkbook(CASE, [ITEM]))
    expect(s.rows.length).toBeGreaterThan(s.headers.length)
  })

  it('keeps the item headings in view while the list scrolls', async () => {
    const s = await open(await buildUsageWorkbook(CASE, [ITEM]))
    const frozen = s.sheet.views?.[0]
    // Freezing row 1 would pin the title and let the headings scroll away, which
    // is what a fixed ySplit of 1 did once the details moved above them.
    expect(frozen?.state).toBe('frozen')
    expect(frozen?.ySplit).toBe(s.rows.findIndex(r => r[0] === 'System / Product') + 1)
  })

  it('carries every item field through', async () => {
    const s = await open(await buildUsageWorkbook(CASE, [ITEM]))
    expect(s.items[0].slice(0, 7)).toEqual(
      ['SeaSpine Mariner MIS', 'RM-45', 'HA260415', 'Screw fenestrated', '5.5 x 45mm', 2, 'CQ01'])
  })
})

describe('the columns that were removed', () => {
  it('has no pricing', async () => {
    const s = await open(await buildUsageWorkbook(CASE, [ITEM], { internal: true }))
    expect(s.headers).not.toContain('Unit Price')
    expect(s.headers).not.toContain('Extended Price')
    // The live formula went with them — it was the reason each row had to stand
    // alone, and it was never filled in.
    const formulas = s.items.flat().filter(v => v && typeof v === 'object' && 'formula' in v)
    expect(formulas).toEqual([])
  })

  it('has no rep name, review flag or notes column', async () => {
    const s = await open(await buildUsageWorkbook(CASE, [ITEM], { internal: true }))
    for (const gone of ['Rep Name', 'Manual Review Flag', 'Notes']) {
      expect(s.headers).not.toContain(gone)
    }
  })
})

describe('the surgeon', () => {
  it('is the surname the rep confirmed', async () => {
    // Also what the folder name, the Dropbox tree and the email subject are built
    // from, so preferring the extracted full name here named a different surgeon
    // on the sheet than on the subject line of the email carrying it.
    const s = await open(await buildUsageWorkbook(CASE, [ITEM]))
    expect(s.details.Surgeon).toBe('Ibbett')
    expect(s.text).not.toMatch(/Ibett/)
  })

  it('falls back to the extracted name when there is no surname', async () => {
    const s = await open(await buildUsageWorkbook({ ...CASE, surgeonSurname: '' }, [ITEM]))
    expect(s.details.Surgeon).toBe('Mr J Ibett')
  })
})

describe('the distributor', () => {
  it('sits in the header when the whole sheet is one distributor', async () => {
    // Which is every email attachment. A column repeating one name down the page
    // is the same waste of width the case details were.
    const s = await open(await buildUsageWorkbook(CASE, [ITEM, { ...ITEM, size: '6.5 x 45mm' }]))
    expect(s.details.Distributor).toBe('SeaSpine')
    expect(s.headers).not.toContain('Distributor')
  })

  it('becomes a column when the sheet spans several', async () => {
    // The Dropbox copy holds every distributor's items, so there it has to be
    // per row or the sheet cannot say which item belongs to whom.
    const mixed = [ITEM, { ...ITEM, distributor: 'Device Technologies', distributorKey: 'DEVICE' }]
    const s = await open(await buildUsageWorkbook(CASE, mixed, { internal: true }))
    expect(s.headers).toContain('Distributor')
    expect(s.items.map(r => r[7])).toEqual(['SeaSpine', 'Device Technologies'])
    expect(s.details.Distributor).toBeUndefined()
  })
})

describe('what only the internal copy carries', () => {
  it('records who scanned the form', async () => {
    // One of the three places the rep is recorded — the others being the sender
    // of the email and the note appended to the calendar booking. It was a column
    // repeated on every row; it is a line in the header now, but it is still here.
    const s = await open(await buildUsageWorkbook(CASE, [ITEM], { internal: true }))
    expect(s.details['Scanned by']).toBe('Brenton Lovering')
  })

  it('says which rows were held back, and shades them', async () => {
    const items = [ITEM, { ...ITEM, referenceCode: 'RM-99', manualReview: true }]
    const buffer = await buildUsageWorkbook(CASE, items, { internal: true })
    const s = await open(buffer)

    // The Manual Review Flag column is gone, so this line and the shading are
    // the whole record that these did not leave the building.
    expect(s.details['Held back from email']).toMatch(/1 of 2/)

    const headRow = s.rows.findIndex(r => r[0] === 'System / Product') + 1
    const shaded = s.sheet.getRow(headRow + 2).getCell(1).fill
    expect(shaded?.fgColor?.argb).toBe('FFFFF3CD')
  })

  it('tells a distributor none of it', async () => {
    // Their sheet is built from items that already passed the hold-back filter,
    // so there is nothing to shade — and naming the rep or flagging a row as
    // uncertain is not theirs to see.
    const s = await open(await buildUsageWorkbook(CASE, [ITEM]))
    expect(s.details['Scanned by']).toBeUndefined()
    expect(s.details['Held back from email']).toBeUndefined()
    expect(s.text).not.toMatch(/Brenton/)
  })

  it('does not shade a flagged row on a distributor sheet', async () => {
    // Belt and braces: if a flagged row ever reached this path, amber shading
    // would be telling them the transcription was uncertain.
    const buffer = await buildUsageWorkbook(CASE, [{ ...ITEM, manualReview: true }])
    const s = await open(buffer)
    const headRow = s.rows.findIndex(r => r[0] === 'System / Product') + 1
    // exceljs gives an unfilled cell `pattern: 'none'` rather than no fill.
    expect(s.sheet.getRow(headRow + 1).getCell(1).fill?.fgColor).toBeUndefined()
  })
})
