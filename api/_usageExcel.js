// ─── Usage sheet generation ───────────────────────────────────────────────────
// The case's details as a block at the top, then one row per item underneath.
//
// It used to be twenty columns with every case detail repeated on every row, so
// that a row would stand alone when pasted into a pricing workbook. That reads
// badly on the device it is actually opened on: a rep or a distributor's rep
// opening the attachment on a phone met a sheet several screens wide, and the
// seven repeated columns were most of that width while carrying one case's worth
// of information.
//
// So the repetition is gone. Details appear once, vertically, where they can be
// read without scrolling sideways, and the table below is only the columns that
// differ between items. The sheet is now taller than it is wide.
//
// Pricing went with it. Unit Price and a live Extended Price formula were the
// reason each row had to stand alone, and nobody was filling them in.
import ExcelJS from 'exceljs'
import { distributorName } from './_distributors.js'

// Only what varies between items. Distributor is added to the end when the sheet
// spans more than one — see below.
//
// Widths are chosen to fit rather than to avoid wrapping: item rows wrap, so a
// long product name costs a second line instead of a screen of sideways
// scrolling. Together they come to about 105 characters against the old
// layout's 380.
const ITEM_COLUMNS = [
  { header: 'System / Product', width: 26 },
  { header: 'Reference', width: 14 },
  { header: 'Lot', width: 14 },
  { header: 'Description', width: 24 },
  { header: 'Size', width: 12 },
  { header: 'Qty', width: 5 },
  { header: 'Rebate', width: 10 }
]

const NAVY = 'FF042746'
const AMBER = 'FFFFF3CD'
const LABEL = 'FF6B7A8D'

/** Australian order, for a sheet read by Australians. */
function auDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '')
}

function distributorOf(item) {
  return item.distributor || (item.distributorKey ? distributorName(item.distributorKey) : '')
}

/**
 * Returns an xlsx Buffer.
 *
 * `items` is already filtered by the caller — a single distributor's items for an
 * email attachment, or all of them for the copy that goes to Dropbox.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.internal]  the Dropbox copy rather than a distributor's.
 *        It carries two things a distributor has no use for and which are the
 *        only record of them anywhere: who scanned the form, and which rows were
 *        held back from the emails. Both were columns; both are now lines in the
 *        header block, which is what removing them as columns has to mean if the
 *        audit trail is to survive.
 */
export async function buildUsageWorkbook(caseRecord, items, opts = {}) {
  const { internal = false } = opts
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'TechnoMed Staff Portal'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Usage')

  // One distributor across every row belongs in the header, not repeated down a
  // column. More than one — the Dropbox copy — and it has to be per row.
  const distributors = [...new Set(items.map(distributorOf).filter(Boolean))]
  const perItemDistributor = distributors.length > 1
  const columns = perItemDistributor
    ? [...ITEM_COLUMNS, { header: 'Distributor', width: 22 }]
    : ITEM_COLUMNS

  // Widths only. Assigning headers here would put them in row 1, and row 1 is
  // the title.
  sheet.columns = columns.map(c => ({ width: c.width }))

  const title = sheet.addRow(['Record of implantable / rebatable items used'])
  sheet.mergeCells(title.number, 1, title.number, columns.length)
  title.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  title.height = 24
  title.alignment = { vertical: 'middle' }

  sheet.addRow([])

  const detail = (label, value) => {
    if (value === '' || value === null || value === undefined) return
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { size: 10, color: { argb: LABEL } }
    row.getCell(2).font = { bold: true, size: 11 }
    // The value gets the room the item columns beside it would have taken.
    if (columns.length >= 4) sheet.mergeCells(row.number, 2, row.number, 4)
  }

  detail('Surgery date', auDate(caseRecord.date))
  detail('Hospital', caseRecord.hospital)
  // The surname, because that is the field the review screen shows and the rep
  // corrects — and the one the folder name and the email subject are built from.
  // Preferring the extracted full name meant a corrected surname reached the
  // subject line while the sheet still carried the misread one.
  detail('Surgeon', caseRecord.surgeonSurname || caseRecord.surgeonName)
  detail('Patient surname', caseRecord.patientSurname)
  detail('Patient first name', caseRecord.patientFirstName)
  detail('UR number', caseRecord.patientUrNumber)
  detail('Procedure', caseRecord.procedure)
  if (!perItemDistributor) detail('Distributor', distributors[0] || '')

  const heldBack = items.filter(it => it.manualReview)
  if (internal) {
    detail('Scanned by', caseRecord.repName)
    if (heldBack.length > 0) {
      // The Manual Review Flag column is gone, so this and the amber rows below
      // are what is left of the record that these did not leave the building.
      detail('Held back from email', `${heldBack.length} of ${items.length} rows, shaded below`)
    }
  }

  sheet.addRow([])

  const head = sheet.addRow(columns.map(c => c.header))
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  head.alignment = { vertical: 'middle' }
  head.height = 20

  for (const item of items) {
    const values = [
      item.productName,
      item.referenceCode,
      item.lotNumber,
      item.description,
      item.size,
      item.quantity,
      item.rebateCode
    ]
    if (perItemDistributor) values.push(distributorOf(item))
    const row = sheet.addRow(values)
    row.alignment = { vertical: 'top', wrapText: true }

    // Shaded on the internal copy only. On a distributor's sheet there are no
    // held-back rows to shade — they are filtered out before it is built — and
    // shading one would be telling them a row was uncertain.
    if (internal && item.manualReview) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } }
      })
    }
  }

  // Frozen and filtered from the item header, wherever the details pushed it to.
  sheet.views = [{ state: 'frozen', ySplit: head.number }]
  sheet.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: columns.length } }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
